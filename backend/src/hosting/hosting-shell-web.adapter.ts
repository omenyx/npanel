import { spawn } from 'node:child_process';
import {
  access,
  constants,
  mkdir,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  AdapterContext,
  AdapterOperationResult,
  WebServerAdapter,
  WebVhostSpec,
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

function safeDomainName(domain: string): string {
  const lowered = domain.toLowerCase();
  const filtered = lowered.replace(/[^a-z0-9.-]/g, '');
  return filtered || 'invalid-domain';
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function buildNginxConfig(spec: WebVhostSpec): string {
  const root = spec.documentRoot;
  const domain = spec.domain;
  return [
    'server {',
    `    listen 80;`,
    `    server_name ${domain};`,
    `    root ${root};`,
    '',
    '    index index.php index.html index.htm;',
    '',
    '    location / {',
    '        try_files $uri $uri/ /index.php?$args;',
    '    }',
    '',
    '    location ~ \\.php$ {',
    '        include fastcgi_params;',
    '        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;',
    '        fastcgi_param PATH_INFO $fastcgi_path_info;',
    '        fastcgi_index index.php;',
    '        fastcgi_split_path_info ^(.+\\.php)(/.+)$;',
    '        fastcgi_pass unix:/run/php-fpm.sock;',
    '    }',
    '',
    '    client_max_body_size 64m;',
    '}',
    '',
  ].join('\n');
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

export class ShellWebServerAdapter implements WebServerAdapter {
  private readonly availableRoot =
    process.env.NPANEL_WEB_VHOST_ROOT || '/etc/nginx/sites-available';

  private readonly enabledRoot =
    process.env.NPANEL_WEB_VHOST_ENABLED_ROOT || '/etc/nginx/sites-enabled';

  constructor(private readonly tools: ToolResolver) {}

  async ensureVhostPresent(
    context: AdapterContext,
    spec: WebVhostSpec,
  ): Promise<AdapterOperationResult> {
    const safeDomain = safeDomainName(spec.domain);
    const filename = `${safeDomain}.conf`;
    const availablePath = join(this.availableRoot, filename);
    const enabledPath = join(this.enabledRoot, filename);

    if (!context.dryRun) {
      await mkdir(dirname(availablePath), { recursive: true });
      await mkdir(dirname(enabledPath), { recursive: true });
      const config = buildNginxConfig(spec);
      await writeFile(availablePath, config, { mode: 0o640 });
      const exists = await pathExists(enabledPath);
      if (!exists) {
        await symlink(availablePath, enabledPath);
      }
      const testBin = process.env.NPANEL_WEB_SERVER_TEST_CMD || 'nginx';
      let testPath: string;
      try {
        testPath = await this.tools.resolve(testBin, {
          packageHint: 'nginx package',
        });
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
          await context.log({
            adapter: 'web_shell',
            operation: 'create',
            targetKind: 'web_vhost',
            targetKey: spec.domain,
            success: false,
            dryRun: false,
            details: {
              tool: err.toolName,
              feature: 'web_server_config_test',
              packageHint: err.packageHint ?? null,
              methodsTried: err.methods,
            },
            errorMessage: 'tool_not_found',
          });
        }
        throw err;
      }
      const testArgs = getArgsFromEnv('NPANEL_WEB_SERVER_TEST', ['-t']);
      const testResult = await execCommand(testPath, testArgs);
      if (testResult.code !== 0) {
        await context.log({
          adapter: 'web_shell',
          operation: 'create',
          targetKind: 'web_vhost',
          targetKey: spec.domain,
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
        throw new Error('web_server_config_test_failed');
      }
      const reloadBin = process.env.NPANEL_WEB_SERVER_RELOAD_CMD || 'nginx';
      let reloadPath: string;
      try {
        reloadPath = await this.tools.resolve(reloadBin, {
          packageHint: 'nginx package',
        });
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
          await context.log({
            adapter: 'web_shell',
            operation: 'create',
            targetKind: 'web_vhost',
            targetKey: spec.domain,
            success: false,
            dryRun: false,
            details: {
              tool: err.toolName,
              feature: 'web_server_reload',
              packageHint: err.packageHint ?? null,
              methodsTried: err.methods,
            },
            errorMessage: 'tool_not_found',
          });
        }
        throw err;
      }
      const reloadArgs = getArgsFromEnv('NPANEL_WEB_SERVER_RELOAD', [
        '-s',
        'reload',
      ]);
      await execCommand(reloadPath, reloadArgs);
    }

    await context.log({
      adapter: 'web_shell',
      operation: 'create',
      targetKind: 'web_vhost',
      targetKey: spec.domain,
      success: true,
      dryRun: context.dryRun,
      details: {
        documentRoot: spec.documentRoot,
      },
      errorMessage: null,
    });

    return {};
  }

  async ensureVhostSuspended(
    context: AdapterContext,
    domain: string,
  ): Promise<AdapterOperationResult> {
    const safeDomain = safeDomainName(domain);
    const filename = `${safeDomain}.conf`;
    const enabledPath = join(this.enabledRoot, filename);
    if (!context.dryRun) {
      const exists = await pathExists(enabledPath);
      if (exists) {
        await unlink(enabledPath);
        const reloadBin = process.env.NPANEL_WEB_SERVER_RELOAD_CMD || 'nginx';
        let reloadPath: string;
        try {
          reloadPath = await this.tools.resolve(reloadBin, {
            packageHint: 'nginx package',
          });
        } catch (err) {
          if (err instanceof ToolNotFoundError) {
            await context.log({
              adapter: 'web_shell',
              operation: 'suspend',
              targetKind: 'web_vhost',
              targetKey: domain,
              success: false,
              dryRun: false,
              details: {
                tool: err.toolName,
                feature: 'web_server_reload',
                packageHint: err.packageHint ?? null,
                methodsTried: err.methods,
              },
              errorMessage: 'tool_not_found',
            });
          }
          throw err;
        }
        const reloadArgs = getArgsFromEnv('NPANEL_WEB_SERVER_RELOAD', [
          '-s',
          'reload',
        ]);
        await execCommand(reloadPath, reloadArgs);
      }
    }
    await context.log({
      adapter: 'web_shell',
      operation: 'suspend',
      targetKind: 'web_vhost',
      targetKey: domain,
      success: true,
      dryRun: context.dryRun,
      details: {},
      errorMessage: null,
    });
    return {};
  }

  async ensureVhostAbsent(
    context: AdapterContext,
    domain: string,
  ): Promise<AdapterOperationResult> {
    const safeDomain = safeDomainName(domain);
    const filename = `${safeDomain}.conf`;
    const availablePath = join(this.availableRoot, filename);
    const enabledPath = join(this.enabledRoot, filename);
    if (!context.dryRun) {
      const enabledExists = await pathExists(enabledPath);
      if (enabledExists) {
        await unlink(enabledPath);
      }
      const availableExists = await pathExists(availablePath);
      if (availableExists) {
        await unlink(availablePath);
      }
      const reloadBin = process.env.NPANEL_WEB_SERVER_RELOAD_CMD || 'nginx';
      let reloadPath: string;
      try {
        reloadPath = await this.tools.resolve(reloadBin, {
          packageHint: 'nginx package',
        });
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
          await context.log({
            adapter: 'web_shell',
            operation: 'delete',
            targetKind: 'web_vhost',
            targetKey: domain,
            success: false,
            dryRun: false,
            details: {
              tool: err.toolName,
              feature: 'web_server_reload',
              packageHint: err.packageHint ?? null,
              methodsTried: err.methods,
            },
            errorMessage: 'tool_not_found',
          });
        }
        throw err;
      }
      const reloadArgs = getArgsFromEnv('NPANEL_WEB_SERVER_RELOAD', [
        '-s',
        'reload',
      ]);
      await execCommand(reloadPath, reloadArgs);
    }
    await context.log({
      adapter: 'web_shell',
      operation: 'delete',
      targetKind: 'web_vhost',
      targetKey: domain,
      success: true,
      dryRun: context.dryRun,
      details: {},
      errorMessage: null,
    });
    return {};
  }
}
