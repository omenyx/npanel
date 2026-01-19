"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShellUserAdapter = void 0;
const node_child_process_1 = require("node:child_process");
const exec_env_1 = require("../system/exec-env");
function execCommand(command, args) {
    return new Promise((resolve) => {
        const child = (0, node_child_process_1.spawn)(command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: (0, exec_env_1.buildSafeExecEnv)(),
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
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
async function userExists(tools, username) {
    const idPath = await tools.resolve('id');
    const result = await execCommand(idPath, ['-u', username]);
    return result.code === 0;
}
class ShellUserAdapter {
    tools;
    constructor(tools) {
        this.tools = tools;
    }
    async ensurePresent(context, spec) {
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
        const args = ['-m', '-d', spec.homeDirectory];
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
    async ensureSuspended(context, username) {
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
    async ensureResumed(context, username) {
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
    async ensureAbsent(context, username) {
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
exports.ShellUserAdapter = ShellUserAdapter;
//# sourceMappingURL=hosting-shell-user.adapter.js.map