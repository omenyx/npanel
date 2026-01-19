"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShellWebServerAdapter = void 0;
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
function safeDomainName(domain) {
    const lowered = domain.toLowerCase();
    const filtered = lowered.replace(/[^a-z0-9.-]/g, '');
    return filtered || 'invalid-domain';
}
async function pathExists(path) {
    try {
        await (0, promises_1.access)(path, promises_1.constants.F_OK);
        return true;
    }
    catch {
        return false;
    }
}
function buildNginxConfig(spec) {
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
class ShellWebServerAdapter {
    tools;
    availableRoot = process.env.NPANEL_WEB_VHOST_ROOT || '/etc/nginx/sites-available';
    enabledRoot = process.env.NPANEL_WEB_VHOST_ENABLED_ROOT || '/etc/nginx/sites-enabled';
    constructor(tools) {
        this.tools = tools;
    }
    async ensureVhostPresent(context, spec) {
        const safeDomain = safeDomainName(spec.domain);
        const filename = `${safeDomain}.conf`;
        const availablePath = (0, node_path_1.join)(this.availableRoot, filename);
        const enabledPath = (0, node_path_1.join)(this.enabledRoot, filename);
        if (!context.dryRun) {
            await (0, promises_1.mkdir)((0, node_path_1.dirname)(availablePath), { recursive: true });
            await (0, promises_1.mkdir)((0, node_path_1.dirname)(enabledPath), { recursive: true });
            const config = buildNginxConfig(spec);
            await (0, promises_1.writeFile)(availablePath, config, { mode: 0o640 });
            const exists = await pathExists(enabledPath);
            if (!exists) {
                await (0, promises_1.symlink)(availablePath, enabledPath);
            }
            const testBin = process.env.NPANEL_WEB_SERVER_TEST_CMD || 'nginx';
            let testPath;
            try {
                testPath = await this.tools.resolve(testBin, {
                    packageHint: 'nginx package',
                });
            }
            catch (err) {
                if (err instanceof tool_resolver_1.ToolNotFoundError) {
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
            let reloadPath;
            try {
                reloadPath = await this.tools.resolve(reloadBin, {
                    packageHint: 'nginx package',
                });
            }
            catch (err) {
                if (err instanceof tool_resolver_1.ToolNotFoundError) {
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
    async ensureVhostSuspended(context, domain) {
        const safeDomain = safeDomainName(domain);
        const filename = `${safeDomain}.conf`;
        const enabledPath = (0, node_path_1.join)(this.enabledRoot, filename);
        if (!context.dryRun) {
            const exists = await pathExists(enabledPath);
            if (exists) {
                await (0, promises_1.unlink)(enabledPath);
                const reloadBin = process.env.NPANEL_WEB_SERVER_RELOAD_CMD || 'nginx';
                let reloadPath;
                try {
                    reloadPath = await this.tools.resolve(reloadBin, {
                        packageHint: 'nginx package',
                    });
                }
                catch (err) {
                    if (err instanceof tool_resolver_1.ToolNotFoundError) {
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
    async ensureVhostAbsent(context, domain) {
        const safeDomain = safeDomainName(domain);
        const filename = `${safeDomain}.conf`;
        const availablePath = (0, node_path_1.join)(this.availableRoot, filename);
        const enabledPath = (0, node_path_1.join)(this.enabledRoot, filename);
        if (!context.dryRun) {
            const enabledExists = await pathExists(enabledPath);
            if (enabledExists) {
                await (0, promises_1.unlink)(enabledPath);
            }
            const availableExists = await pathExists(availablePath);
            if (availableExists) {
                await (0, promises_1.unlink)(availablePath);
            }
            const reloadBin = process.env.NPANEL_WEB_SERVER_RELOAD_CMD || 'nginx';
            let reloadPath;
            try {
                reloadPath = await this.tools.resolve(reloadBin, {
                    packageHint: 'nginx package',
                });
            }
            catch (err) {
                if (err instanceof tool_resolver_1.ToolNotFoundError) {
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
exports.ShellWebServerAdapter = ShellWebServerAdapter;
//# sourceMappingURL=hosting-shell-web.adapter.js.map