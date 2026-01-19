"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShellPhpFpmAdapter = void 0;
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
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
function safePoolName(name) {
    const lowered = name.toLowerCase();
    const filtered = lowered.replace(/[^a-z0-9_-]/g, '');
    return filtered || 'pool';
}
function buildPoolConfig(spec) {
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
class ShellPhpFpmAdapter {
    tools;
    poolRoot = process.env.NPANEL_PHP_FPM_POOL_ROOT || '/etc/php-fpm.d';
    constructor(tools) {
        this.tools = tools;
    }
    async ensurePoolPresent(context, spec) {
        const safeName = safePoolName(spec.name);
        const poolPath = (0, node_path_1.join)(this.poolRoot, `${safeName}.conf`);
        if (!context.dryRun) {
            await (0, promises_1.mkdir)((0, node_path_1.dirname)(poolPath), { recursive: true });
            const config = buildPoolConfig(spec);
            await (0, promises_1.writeFile)(poolPath, config, { mode: 0o640 });
            const testBin = process.env.NPANEL_PHP_FPM_TEST_CMD || 'php-fpm';
            let testPath;
            try {
                testPath = await this.tools.resolve(testBin, {
                    packageHint: 'php-fpm package',
                });
            }
            catch (err) {
                if (err instanceof tool_resolver_1.ToolNotFoundError) {
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
            let reloadPath;
            try {
                reloadPath = await this.tools.resolve(reloadBin);
            }
            catch (err) {
                if (err instanceof tool_resolver_1.ToolNotFoundError) {
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
            const poolPath = (0, node_path_1.join)(this.poolRoot, `${safeName}.conf`);
            await (0, promises_1.unlink)(poolPath).catch(() => undefined);
            const reloadBin = process.env.NPANEL_PHP_FPM_RELOAD_CMD || 'systemctl';
            let reloadPath;
            try {
                reloadPath = await this.tools.resolve(reloadBin);
            }
            catch (err) {
                if (err instanceof tool_resolver_1.ToolNotFoundError) {
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
    async ensurePoolAbsent(context, name) {
        const safeName = safePoolName(name);
        const poolPath = (0, node_path_1.join)(this.poolRoot, `${safeName}.conf`);
        if (!context.dryRun) {
            await (0, promises_1.unlink)(poolPath).catch(() => undefined);
            const reloadBin = process.env.NPANEL_PHP_FPM_RELOAD_CMD || 'systemctl';
            let reloadPath;
            try {
                reloadPath = await this.tools.resolve(reloadBin);
            }
            catch (err) {
                if (err instanceof tool_resolver_1.ToolNotFoundError) {
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
exports.ShellPhpFpmAdapter = ShellPhpFpmAdapter;
//# sourceMappingURL=hosting-shell-php-fpm.adapter.js.map