import { ToolResolver } from '../system/tool-resolver';
import { execCommand, type ExecResult } from '../system/exec-command';
import type {
  AdapterContext,
  AdapterOperationResult,
  UserAdapter,
  UserSpec,
} from './hosting-adapters';

async function userExists(
  tools: ToolResolver,
  username: string,
): Promise<boolean> {
  const idPath = await tools.resolve('id');
  const result = await execCommand(idPath, ['-u', username]);
  return result.code === 0;
}

export class ShellUserAdapter implements UserAdapter {
  constructor(private readonly tools: ToolResolver) {}

  async ensurePresent(
    context: AdapterContext,
    spec: UserSpec,
  ): Promise<AdapterOperationResult> {
    const exists = await userExists(this.tools, spec.username);
    if (exists) {
      await context.log({
        adapter: 'user_shell',
        operation: 'update',
        targetKind: 'system_user',
        targetKey: spec.username,
        success: true,
        dryRun: context.dryRun,
        details: {
          message: 'User already exists',
        },
        errorMessage: null,
      });
      return {};
    }
    if (context.dryRun) {
      await context.log({
        adapter: 'user_shell',
        operation: 'create',
        targetKind: 'system_user',
        targetKey: spec.username,
        success: true,
        dryRun: true,
        details: {
          homeDirectory: spec.homeDirectory,
          shell: spec.shell ?? '/bin/bash',
          quotaMb: spec.quotaMb ?? null,
        },
        errorMessage: null,
      });
      return {};
    }
    const useraddPath = await this.tools.resolve('useradd');
    const args: string[] = ['-m', '-d', spec.homeDirectory];
    if (spec.shell) {
      args.push('-s', spec.shell);
    }
    if (spec.primaryGroup) {
      args.push('-g', spec.primaryGroup);
    }
    args.push(spec.username);
    const result = await execCommand(useraddPath, args);
    const success = result.code === 0;
    await context.log({
      adapter: 'user_shell',
      operation: 'create',
      targetKind: 'system_user',
      targetKey: spec.username,
      success,
      dryRun: false,
      details: {
        homeDirectory: spec.homeDirectory,
        quotaMb: spec.quotaMb ?? null,
      },
      errorMessage: success ? null : 'useradd_failed',
    });
    if (!success) {
      throw new Error('useradd_failed');
    }
    const rollback = async () => {
      if (context.dryRun) {
        return;
      }
      const userdelPath = await this.tools.resolve('userdel');
      await execCommand(userdelPath, ['-r', spec.username]);
    };
    return {
      rollback,
      details: {},
    };
  }

  async ensureSuspended(
    context: AdapterContext,
    username: string,
  ): Promise<AdapterOperationResult> {
    const exists = await userExists(this.tools, username);
    if (!exists) {
      await context.log({
        adapter: 'user_shell',
        operation: 'suspend',
        targetKind: 'system_user',
        targetKey: username,
        success: true,
        dryRun: context.dryRun,
        details: {
          message: 'User does not exist',
        },
        errorMessage: null,
      });
      return {};
    }
    if (context.dryRun) {
      await context.log({
        adapter: 'user_shell',
        operation: 'suspend',
        targetKind: 'system_user',
        targetKey: username,
        success: true,
        dryRun: true,
        details: {},
        errorMessage: null,
      });
      return {};
    }
    const usermodPath = await this.tools.resolve('usermod');
    const result = await execCommand(usermodPath, ['-L', username]);
    const success = result.code === 0;
    await context.log({
      adapter: 'user_shell',
      operation: 'suspend',
      targetKind: 'system_user',
      targetKey: username,
      success,
      dryRun: false,
      details: {},
      errorMessage: success ? null : 'usermod_lock_failed',
    });
    if (!success) {
      throw new Error('usermod_lock_failed');
    }
    return {};
  }

  async ensureResumed(
    context: AdapterContext,
    username: string,
  ): Promise<AdapterOperationResult> {
    const exists = await userExists(this.tools, username);
    if (!exists) {
      await context.log({
        adapter: 'user_shell',
        operation: 'resume',
        targetKind: 'system_user',
        targetKey: username,
        success: true,
        dryRun: context.dryRun,
        details: {
          message: 'User does not exist',
        },
        errorMessage: null,
      });
      return {};
    }
    if (context.dryRun) {
      await context.log({
        adapter: 'user_shell',
        operation: 'resume',
        targetKind: 'system_user',
        targetKey: username,
        success: true,
        dryRun: true,
        details: {},
        errorMessage: null,
      });
      return {};
    }
    const usermodPath = await this.tools.resolve('usermod');
    const result = await execCommand(usermodPath, ['-U', username]);
    const success = result.code === 0;
    await context.log({
      adapter: 'user_shell',
      operation: 'resume',
      targetKind: 'system_user',
      targetKey: username,
      success,
      dryRun: false,
      details: {},
      errorMessage: success ? null : 'usermod_unlock_failed',
    });
    if (!success) {
      throw new Error('usermod_unlock_failed');
    }
    return {};
  }

  async ensureAbsent(
    context: AdapterContext,
    username: string,
  ): Promise<AdapterOperationResult> {
    const exists = await userExists(this.tools, username);
    if (!exists) {
      await context.log({
        adapter: 'user_shell',
        operation: 'delete',
        targetKind: 'system_user',
        targetKey: username,
        success: true,
        dryRun: context.dryRun,
        details: {
          message: 'User does not exist',
        },
        errorMessage: null,
      });
      return {};
    }
    if (context.dryRun) {
      await context.log({
        adapter: 'user_shell',
        operation: 'delete',
        targetKind: 'system_user',
        targetKey: username,
        success: true,
        dryRun: true,
        details: {},
        errorMessage: null,
      });
      return {};
    }
    const userdelPath = await this.tools.resolve('userdel');
    const result = await execCommand(userdelPath, ['-r', username]);
    const success = result.code === 0;
    await context.log({
      adapter: 'user_shell',
      operation: 'delete',
      targetKind: 'system_user',
      targetKey: username,
      success,
      dryRun: false,
      details: {},
      errorMessage: success ? null : 'userdel_failed',
    });
    if (!success) {
      throw new Error('userdel_failed');
    }
    return {};
  }
}
