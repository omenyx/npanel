import { spawn } from 'node:child_process';
import type {
  AdapterContext,
  AdapterOperationResult,
  MailAdapter,
  MailboxSpec,
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

export class ShellMailAdapter implements MailAdapter {
  constructor(private readonly tools: ToolResolver) {}

  async ensureMailboxPresent(
    context: AdapterContext,
    spec: MailboxSpec,
  ): Promise<AdapterOperationResult> {
    if (!context.dryRun) {
      const mailBin = process.env.NPANEL_MAIL_CMD;
      if (!mailBin) {
        await context.log({
          adapter: 'mail_shell',
          operation: 'create',
          targetKind: 'mailbox',
          targetKey: spec.address,
          success: false,
          dryRun: false,
          details: {},
          errorMessage: 'mail_command_not_configured',
        });
        throw new Error('mail_command_not_configured');
      }
      let command: string;
      try {
        command = await this.tools.resolve(mailBin);
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
          await context.log({
            adapter: 'mail_shell',
            operation: 'create',
            targetKind: 'mailbox',
            targetKey: spec.address,
            success: false,
            dryRun: false,
            details: {
              tool: err.toolName,
              feature: 'mailbox_management',
              packageHint: err.packageHint ?? null,
              methodsTried: err.methods,
            },
            errorMessage: 'tool_not_found',
          });
        }
        throw err;
      }
      const args = getArgsFromEnv('NPANEL_MAIL', []);
      const cliArgs: string[] = [...args, 'present', spec.address];
      if (spec.quotaMb != null) {
        cliArgs.push('quotaMb', String(spec.quotaMb));
      }
      if (spec.password) {
        cliArgs.push('password', spec.password);
      }
      const result = await execCommand(command, cliArgs);
      if (result.code !== 0) {
        await context.log({
          adapter: 'mail_shell',
          operation: 'create',
          targetKind: 'mailbox',
          targetKey: spec.address,
          success: false,
          dryRun: false,
          details: {
            command,
            args: cliArgs,
            stdout: result.stdout,
            stderr: result.stderr,
          },
          errorMessage: 'mailbox_apply_failed',
        });
        throw new Error('mailbox_apply_failed');
      }
    }
    await context.log({
      adapter: 'mail_shell',
      operation: 'create',
      targetKind: 'mailbox',
      targetKey: spec.address,
      success: true,
      dryRun: context.dryRun,
      details: {
        quotaMb: spec.quotaMb ?? null,
      },
      errorMessage: null,
    });
    return {};
  }

  async ensureMailboxAbsent(
    context: AdapterContext,
    address: string,
  ): Promise<AdapterOperationResult> {
    if (!context.dryRun) {
      const mailBin = process.env.NPANEL_MAIL_CMD;
      if (!mailBin) {
        await context.log({
          adapter: 'mail_shell',
          operation: 'delete',
          targetKind: 'mailbox',
          targetKey: address,
          success: false,
          dryRun: false,
          details: {},
          errorMessage: 'mail_command_not_configured',
        });
        throw new Error('mail_command_not_configured');
      }
      let command: string;
      try {
        command = await this.tools.resolve(mailBin);
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
          await context.log({
            adapter: 'mail_shell',
            operation: 'delete',
            targetKind: 'mailbox',
            targetKey: address,
            success: false,
            dryRun: false,
            details: {
              tool: err.toolName,
              feature: 'mailbox_management',
              packageHint: err.packageHint ?? null,
              methodsTried: err.methods,
            },
            errorMessage: 'tool_not_found',
          });
        }
        throw err;
      }
      const args = getArgsFromEnv('NPANEL_MAIL', []);
      const cliArgs: string[] = [...args, 'absent', address];
      const result = await execCommand(command, cliArgs);
      if (result.code !== 0) {
        await context.log({
          adapter: 'mail_shell',
          operation: 'delete',
          targetKind: 'mailbox',
          targetKey: address,
          success: false,
          dryRun: false,
          details: {
            command,
            args: cliArgs,
            stdout: result.stdout,
            stderr: result.stderr,
          },
          errorMessage: 'mailbox_delete_failed',
        });
        throw new Error('mailbox_delete_failed');
      }
    }
    await context.log({
      adapter: 'mail_shell',
      operation: 'delete',
      targetKind: 'mailbox',
      targetKey: address,
      success: true,
      dryRun: context.dryRun,
      details: {},
      errorMessage: null,
    });
    return {};
  }
}
