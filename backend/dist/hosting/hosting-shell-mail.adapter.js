"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShellMailAdapter = void 0;
const node_child_process_1 = require("node:child_process");
const tool_resolver_1 = require("../system/tool-resolver");
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
function getArgsFromEnv(baseEnvName, defaultArgs) {
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
class ShellMailAdapter {
    tools;
    constructor(tools) {
        this.tools = tools;
    }
    async ensureMailboxPresent(context, spec) {
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
            let command;
            try {
                command = await this.tools.resolve(mailBin);
            }
            catch (err) {
                if (err instanceof tool_resolver_1.ToolNotFoundError) {
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
            const cliArgs = [...args, 'present', spec.address];
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
    async ensureMailboxAbsent(context, address) {
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
            let command;
            try {
                command = await this.tools.resolve(mailBin);
            }
            catch (err) {
                if (err instanceof tool_resolver_1.ToolNotFoundError) {
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
            const cliArgs = [...args, 'absent', address];
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
exports.ShellMailAdapter = ShellMailAdapter;
//# sourceMappingURL=hosting-shell-mail.adapter.js.map