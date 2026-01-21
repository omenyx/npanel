import type {
  AdapterContext,
  AdapterOperationResult,
  MailAdapter,
  MailboxSpec,
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
        // If quotaMb is 0, it means unlimited for the user, but we should pass it as 0 to the script
        // The script (e.g., exim/dovecot adapter script) should handle 0 as unlimited or max system limit.
        // However, if the intent is "use entire space", typically mailbox quotas are per-mailbox limits.
        // If mailboxQuota is 0 (unlimited), it means this specific mailbox can grow until the disk is full or system limit is reached.
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

  async updatePassword(
    context: AdapterContext,
    address: string,
    password: string,
  ): Promise<AdapterOperationResult> {
    if (!context.dryRun) {
      const mailBin = process.env.NPANEL_MAIL_CMD;
      if (!mailBin) throw new Error('mail_command_not_configured');

      const command = await this.tools.resolve(mailBin);

      const args = getArgsFromEnv('NPANEL_MAIL', []);
      const cliArgs: string[] = [...args, 'passwd', address, password];

      const result = await execCommand(command, cliArgs);
      if (result.code !== 0) {
        await context.log({
          adapter: 'mail_shell',
          operation: 'update',
          targetKind: 'mailbox',
          targetKey: address,
          success: false,
          dryRun: false,
          details: { stderr: result.stderr },
          errorMessage: 'mailbox_passwd_failed',
        });
        throw new Error('mailbox_passwd_failed');
      }
    }
    await context.log({
      adapter: 'mail_shell',
      operation: 'update',
      targetKind: 'mailbox',
      targetKey: address,
      success: true,
      dryRun: context.dryRun,
      details: { action: 'password_change' },
      errorMessage: null,
    });
    return {};
  }

  async listMailboxes(
    context: AdapterContext,
    domain: string,
  ): Promise<string[]> {
    // List operations are read-only and typically don't log to the audit trail unless failed
    const mailBin = process.env.NPANEL_MAIL_CMD;
    if (!mailBin) return []; // Or throw

    let command: string;
    try {
      command = await this.tools.resolve(mailBin);
    } catch {
      return [];
    }

    const args = getArgsFromEnv('NPANEL_MAIL', []);
    const cliArgs: string[] = [...args, 'list', domain];

    // In dry-run, we might just return mock data or empty
    if (context.dryRun) {
      return [`postmaster@${domain}`, `test@${domain}`];
    }

    const result = await execCommand(command, cliArgs);
    if (result.code !== 0) {
      return [];
    }

    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
}
