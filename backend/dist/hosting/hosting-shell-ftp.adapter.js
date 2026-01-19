"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShellFtpAdapter = void 0;
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
class ShellFtpAdapter {
    tools;
    constructor(tools) {
        this.tools = tools;
    }
    async ensureAccountPresent(context, spec) {
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
            let command;
            try {
                command = await this.tools.resolve(ftpBin);
            }
            catch (err) {
                if (err instanceof tool_resolver_1.ToolNotFoundError) {
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
            const cliArgs = [
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
    async ensureAccountAbsent(context, username) {
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
            let command;
            try {
                command = await this.tools.resolve(ftpBin);
            }
            catch (err) {
                if (err instanceof tool_resolver_1.ToolNotFoundError) {
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
            const cliArgs = [...args, 'absent', username];
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
}
exports.ShellFtpAdapter = ShellFtpAdapter;
//# sourceMappingURL=hosting-shell-ftp.adapter.js.map