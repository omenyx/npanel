import { spawn } from 'node:child_process';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  AdapterContext,
  AdapterOperationResult,
  PhpFpmAdapter,
  PhpFpmPoolSpec,
} from './hosting-adapters';
import { ToolResolver, ToolNotFoundError } from '../system/tool-resolver';
import { buildSafeExecEnv } from '../system/exec-env';

type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function execCommand(command: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildSafeExecEnv(),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({
        code: code ?? -1,
        stdout,
        stderr,
      });
    });
  });
}

function safePoolName(name: string): string {
  const lowered = name.toLowerCase();
  const filtered = lowered.replace(/[^a-z0-9_-]/g, '');
  return filtered || 'pool';
}

function buildPoolConfig(spec: PhpFpmPoolSpec): string {
  const lines = [
    `[${spec.name}]`,
    `user = ${spec.user}`,
    `group = ${spec.group}`,
    `listen = ${spec.listen}`,
    'pm = ondemand',
    'pm.max_children = 5',
    'pm.process_idle_timeout = 10s',
    'pm.max_requests = 200',
    'chdir = /',
  ];
  return lines.join('\n') + '\n';
}

function getArgsFromEnv(baseEnvName: string, defaultArgs: string[]): string[] {
  const argsValue = process.env[`${baseEnvName}_ARGS`];
  if (!argsValue) {
    return defaultArgs;
  }
  const parts = argsValue
    .split(' ')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts : defaultArgs;
}

export class ShellPhpFpmAdapter implements PhpFpmAdapter {
  private readonly poolRoot =
    process.env.NPANEL_PHP_FPM_POOL_ROOT || '/etc/php-fpm.d';

  constructor(private readonly tools: ToolResolver) {}

  async ensurePoolPresent(
    context: AdapterContext,
    spec: PhpFpmPoolSpec,
  ): Promise<AdapterOperationResult> {
    const safeName = safePoolName(spec.name);
    const poolPath = join(this.poolRoot, `${safeName}.conf`);

    if (!context.dryRun) {
      await mkdir(dirname(poolPath), { recursive: true });
      const config = buildPoolConfig(spec);
      await writeFile(poolPath, config, { mode: 0o640 });
      const testBin = process.env.NPANEL_PHP_FPM_TEST_CMD || 'php-fpm';
      let testPath: string;
      try {
        testPath = await this.tools.resolve(testBin, {
          packageHint: 'php-fpm package',
        });
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
          await context.log({
            adapter: 'php_fpm_shell',
            operation: 'create',
            targetKind: 'php_fpm_pool',
            targetKey: spec.name,
            success: false,
            dryRun: false,
            details: {
              tool: err.toolName,
              feature: 'php_fpm_config_test',
              packageHint: err.packageHint ?? null,
              methodsTried: err.methods,
            },
            errorMessage: 'tool_not_found',
          });
        }
        throw err;
      }
      const testArgs = getArgsFromEnv('NPANEL_PHP_FPM_TEST', ['-t']);
      const testResult = await execCommand(testPath, testArgs);
      if (testResult.code !== 0) {
        await context.log({
          adapter: 'php_fpm_shell',
          operation: 'create',
          targetKind: 'php_fpm_pool',
          targetKey: spec.name,
          success: false,
          dryRun: false,
          details: {
            command: testPath,
            args: testArgs,
            stdout: testResult.stdout,
            stderr: testResult.stderr,
          },
          errorMessage: 'config_test_failed',
        });
        throw new Error('php_fpm_config_test_failed');
      }
      const reloadBin = process.env.NPANEL_PHP_FPM_RELOAD_CMD || 'systemctl';
      let reloadPath: string;
      try {
        reloadPath = await this.tools.resolve(reloadBin);
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
          await context.log({
            adapter: 'php_fpm_shell',
            operation: 'create',
            targetKind: 'php_fpm_pool',
            targetKey: spec.name,
            success: false,
            dryRun: false,
            details: {
              tool: err.toolName,
              feature: 'php_fpm_reload',
              packageHint: err.packageHint ?? null,
              methodsTried: err.methods,
            },
            errorMessage: 'tool_not_found',
          });
        }
        throw err;
      }
      const reloadArgs = getArgsFromEnv('NPANEL_PHP_FPM_RELOAD', [
        'reload',
        'php-fpm',
      ]);
      await execCommand(reloadPath, reloadArgs);
    }

    await context.log({
      adapter: 'php_fpm_shell',
      operation: 'create',
      targetKind: 'php_fpm_pool',
      targetKey: spec.name,
      success: true,
      dryRun: context.dryRun,
      details: {
        user: spec.user,
        group: spec.group,
        listen: spec.listen,
      },
      errorMessage: null,
    });

    const rollback = async () => {
      if (context.dryRun) {
        return;
      }
      const safeName = safePoolName(spec.name);
      const poolPath = join(this.poolRoot, `${safeName}.conf`);
      await unlink(poolPath).catch(() => undefined);
      const reloadBin = process.env.NPANEL_PHP_FPM_RELOAD_CMD || 'systemctl';
      let reloadPath: string;
      try {
        reloadPath = await this.tools.resolve(reloadBin);
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
          await context.log({
            adapter: 'php_fpm_shell',
            operation: 'create',
            targetKind: 'php_fpm_pool',
            targetKey: spec.name,
            success: false,
            dryRun: false,
            details: {
              tool: err.toolName,
              feature: 'php_fpm_reload',
              packageHint: err.packageHint ?? null,
              methodsTried: err.methods,
            },
            errorMessage: 'tool_not_found',
          });
        }
        throw err;
      }
      const reloadArgs = getArgsFromEnv('NPANEL_PHP_FPM_RELOAD', [
        'reload',
        'php-fpm',
      ]);
      await execCommand(reloadPath, reloadArgs);
    };

    return {
      rollback,
      details: {},
    };
  }

  async ensurePoolAbsent(
    context: AdapterContext,
    name: string,
  ): Promise<AdapterOperationResult> {
    const safeName = safePoolName(name);
    const poolPath = join(this.poolRoot, `${safeName}.conf`);

    if (!context.dryRun) {
      await unlink(poolPath).catch(() => undefined);
      const reloadBin = process.env.NPANEL_PHP_FPM_RELOAD_CMD || 'systemctl';
      let reloadPath: string;
      try {
        reloadPath = await this.tools.resolve(reloadBin);
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
          await context.log({
            adapter: 'php_fpm_shell',
            operation: 'delete',
            targetKind: 'php_fpm_pool',
            targetKey: name,
            success: false,
            dryRun: false,
            details: {
              tool: err.toolName,
              feature: 'php_fpm_reload',
              packageHint: err.packageHint ?? null,
              methodsTried: err.methods,
            },
            errorMessage: 'tool_not_found',
          });
        }
        throw err;
      }
      const reloadArgs = getArgsFromEnv('NPANEL_PHP_FPM_RELOAD', [
        'reload',
        'php-fpm',
      ]);
      await execCommand(reloadPath, reloadArgs);
    }

    await context.log({
      adapter: 'php_fpm_shell',
      operation: 'delete',
      targetKind: 'php_fpm_pool',
      targetKey: name,
      success: true,
      dryRun: context.dryRun,
      details: {},
      errorMessage: null,
    });

    return {};
  }
}
