"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolResolver = exports.ToolNotFoundError = void 0;
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
const exec_env_1 = require("./exec-env");
class ToolNotFoundError extends Error {
    toolName;
    methods;
    packageHint;
    constructor(toolName, methods, packageHint) {
        super(`Tool ${toolName} not found`);
        this.toolName = toolName;
        this.methods = methods;
        this.packageHint = packageHint;
        this.name = 'ToolNotFoundError';
    }
}
exports.ToolNotFoundError = ToolNotFoundError;
function isSafeToolName(name) {
    return /^[a-zA-Z0-9._+-]+$/.test(name);
}
async function runCommand(command, args) {
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
class ToolResolver {
    cache = new Map();
    async resolve(binaryName, options) {
        const key = binaryName;
        const refresh = options?.refresh === true;
        if (!refresh) {
            const cached = this.cache.get(key);
            if (cached) {
                return cached.path;
            }
        }
        const methods = [];
        if (binaryName.includes('/')) {
            const ok = await this.isExecutable(binaryName);
            methods.push('fallback');
            if (ok) {
                const entry = {
                    name: binaryName,
                    path: binaryName,
                    method: 'fallback',
                };
                this.cache.set(key, entry);
                return entry.path;
            }
        }
        if (!binaryName.includes('/') && isSafeToolName(binaryName)) {
            methods.push('command_v');
            const commandV = await this.resolveViaCommandV(binaryName);
            if (commandV && (await this.isExecutable(commandV))) {
                const entry = {
                    name: binaryName,
                    path: commandV,
                    method: 'command_v',
                };
                this.cache.set(key, entry);
                return entry.path;
            }
            methods.push('which');
            const whichPath = await this.resolveViaWhich(binaryName);
            if (whichPath && (await this.isExecutable(whichPath))) {
                const entry = {
                    name: binaryName,
                    path: whichPath,
                    method: 'which',
                };
                this.cache.set(key, entry);
                return entry.path;
            }
        }
        methods.push('fallback');
        const fallbackDirs = [
            '/usr/sbin',
            '/usr/bin',
            '/sbin',
            '/bin',
            '/usr/local/sbin',
            '/usr/local/bin',
        ];
        for (const dir of fallbackDirs) {
            const candidate = `${dir}/${binaryName}`;
            if (await this.isExecutable(candidate)) {
                const entry = {
                    name: binaryName,
                    path: candidate,
                    method: 'fallback',
                };
                this.cache.set(key, entry);
                return entry.path;
            }
        }
        throw new ToolNotFoundError(binaryName, methods, options?.packageHint);
    }
    async statusFor(binaryName, options) {
        try {
            const path = await this.resolve(binaryName, options);
            const cached = this.cache.get(binaryName);
            return {
                name: binaryName,
                available: true,
                path,
                method: cached?.method,
            };
        }
        catch (err) {
            if (err instanceof ToolNotFoundError) {
                return {
                    name: binaryName,
                    available: false,
                    error: err.message,
                    packageHint: err.packageHint ?? this.defaultPackageHint(binaryName),
                    methodsTried: err.methods,
                };
            }
            return {
                name: binaryName,
                available: false,
                error: err instanceof Error ? err.message : 'Unknown error',
            };
        }
    }
    async isExecutable(path) {
        try {
            await (0, promises_1.access)(path, node_fs_1.constants.X_OK);
            return true;
        }
        catch {
            return false;
        }
    }
    async resolveViaCommandV(binaryName) {
        const shell = process.env.SHELL || '/bin/sh';
        const result = await runCommand(shell, ['-lc', `command -v ${binaryName}`]);
        if (result.code !== 0) {
            return null;
        }
        const out = result.stdout.trim();
        if (!out) {
            return null;
        }
        const firstLine = out.split('\n')[0] ?? '';
        return firstLine.trim() || null;
    }
    async resolveViaWhich(binaryName) {
        const result = await runCommand('which', [binaryName]);
        if (result.code !== 0) {
            return null;
        }
        const out = result.stdout.trim();
        if (!out) {
            return null;
        }
        const firstLine = out.split('\n')[0] ?? '';
        return firstLine.trim() || null;
    }
    defaultPackageHint(binaryName) {
        if (binaryName === 'rndc' || binaryName === 'named') {
            return 'bind or bind-utils package';
        }
        if (binaryName === 'pdnsutil') {
            return 'pdns-server and pdns-backend package';
        }
        if (binaryName === 'nginx') {
            return 'nginx package';
        }
        if (binaryName === 'php-fpm' || binaryName.startsWith('php-fpm')) {
            return 'php-fpm package';
        }
        if (binaryName === 'mysql' || binaryName === 'mysqladmin') {
            return 'mysql-server or mariadb-server package';
        }
        if (binaryName === 'useradd' ||
            binaryName === 'usermod' ||
            binaryName === 'userdel') {
            return 'shadow-utils or passwd package';
        }
        return undefined;
    }
}
exports.ToolResolver = ToolResolver;
//# sourceMappingURL=tool-resolver.js.map