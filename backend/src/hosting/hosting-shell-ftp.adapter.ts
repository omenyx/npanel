import type {
  AdapterContext,
  AdapterOperationResult,
  FtpAdapter,
  FtpAccountSpec,
} from './hosting-adapters';
import { ToolResolver, ToolNotFoundError } from '../system/tool-resolver';
import { execCommand } from '../system/exec-command';

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

export class ShellFtpAdapter implements FtpAdapter {
  constructor(private readonly tools: ToolResolver) {}

  async ensureAccountPresent(
    context: AdapterContext,
    spec: FtpAccountSpec,
  ): Promise<AdapterOperationResult> {
    if (!context.dryRun) {
      const ftpBin = process.env.NPANEL_FTP_CMD;
      if (!ftpBin) {
        await context.log({
          adapter: 'ftp_shell',
          operation: 'create',
          targetKind: 'ftp_account',
          targetKey: spec.username,
          success: false,
          dryRun: false,
          details: {},
          errorMessage: 'ftp_command_not_configured',
        });
        throw new Error('ftp_command_not_configured');
      }
      let command: string;
      try {
        command = await this.tools.resolve(ftpBin);
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
          await context.log({
            adapter: 'ftp_shell',
            operation: 'create',
            targetKind: 'ftp_account',
            targetKey: spec.username,
            success: false,
            dryRun: false,
            details: {
              tool: err.toolName,
              feature: 'ftp_account_management',
              packageHint: err.packageHint ?? null,
              methodsTried: err.methods,
            },
            errorMessage: 'tool_not_found',
          });
        }
        throw err;
      }
      const args = getArgsFromEnv('NPANEL_FTP', []);
      const cliArgs: string[] = [
        ...args,
        'present',
        spec.username,
        spec.homeDirectory,
      ];
      if (spec.password) {
        cliArgs.push('password', spec.password);
      }
      const result = await execCommand(command, cliArgs);
      if (result.code !== 0) {
        await context.log({
          adapter: 'ftp_shell',
          operation: 'create',
          targetKind: 'ftp_account',
          targetKey: spec.username,
          success: false,
          dryRun: false,
          details: {
            command,
            args: cliArgs,
            stdout: result.stdout,
            stderr: result.stderr,
          },
          errorMessage: 'ftp_account_apply_failed',
        });
        throw new Error('ftp_account_apply_failed');
      }
    }
    await context.log({
      adapter: 'ftp_shell',
      operation: 'create',
      targetKind: 'ftp_account',
      targetKey: spec.username,
      success: true,
      dryRun: context.dryRun,
      details: {
        homeDirectory: spec.homeDirectory,
      },
      errorMessage: null,
    });
    return {};
  }

  async ensureAccountAbsent(
    context: AdapterContext,
    username: string,
  ): Promise<AdapterOperationResult> {
    if (!context.dryRun) {
      const ftpBin = process.env.NPANEL_FTP_CMD;
      if (!ftpBin) {
        await context.log({
          adapter: 'ftp_shell',
          operation: 'delete',
          targetKind: 'ftp_account',
          targetKey: username,
          success: false,
          dryRun: false,
          details: {},
          errorMessage: 'ftp_command_not_configured',
        });
        throw new Error('ftp_command_not_configured');
      }
      let command: string;
      try {
        command = await this.tools.resolve(ftpBin);
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
          await context.log({
            adapter: 'ftp_shell',
            operation: 'delete',
            targetKind: 'ftp_account',
            targetKey: username,
            success: false,
            dryRun: false,
            details: {
              tool: err.toolName,
              feature: 'ftp_account_management',
              packageHint: err.packageHint ?? null,
              methodsTried: err.methods,
            },
            errorMessage: 'tool_not_found',
          });
        }
        throw err;
      }
      const args = getArgsFromEnv('NPANEL_FTP', []);
      const cliArgs: string[] = [...args, 'absent', username];
      const result = await execCommand(command, cliArgs);
      if (result.code !== 0) {
        await context.log({
          adapter: 'ftp_shell',
          operation: 'delete',
          targetKind: 'ftp_account',
          targetKey: username,
          success: false,
          dryRun: false,
          details: {
            command,
            args: cliArgs,
            stdout: result.stdout,
            stderr: result.stderr,
          },
          errorMessage: 'ftp_account_delete_failed',
        });
        throw new Error('ftp_account_delete_failed');
      }
    }
    await context.log({
      adapter: 'ftp_shell',
      operation: 'delete',
      targetKind: 'ftp_account',
      targetKey: username,
      success: true,
      dryRun: context.dryRun,
      details: {},
      errorMessage: null,
    });
    return {};
  }

  async resetPassword(
    context: AdapterContext,
    username: string,
    password: string,
  ): Promise<AdapterOperationResult> {
    if (!context.dryRun) {
      const ftpBin = process.env.NPANEL_FTP_CMD;
      if (!ftpBin) {
        throw new Error('ftp_command_not_configured');
      }
      const command = await this.tools.resolve(ftpBin);
      const args = getArgsFromEnv('NPANEL_FTP', []);
      const cliArgs: string[] = [...args, 'password', username, password];

      const result = await execCommand(command, cliArgs);
      if (result.code !== 0) {
        await context.log({
          adapter: 'ftp_shell',
          operation: 'update',
          targetKind: 'ftp_account',
          targetKey: username,
          success: false,
          dryRun: false,
          details: {
            command,
            args: cliArgs,
            stdout: result.stdout,
            stderr: result.stderr,
          },
          errorMessage: 'ftp_password_reset_failed',
        });
        throw new Error('ftp_password_reset_failed');
      }
    }

    await context.log({
      adapter: 'ftp_shell',
      operation: 'update',
      targetKind: 'ftp_account',
      targetKey: username,
      success: true,
      dryRun: context.dryRun,
      details: { action: 'password_reset' },
      errorMessage: null,
    });
    return {};
  }
}
