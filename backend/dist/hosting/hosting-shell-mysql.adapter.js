"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShellMysqlAdapter = void 0;
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
function escapeSqlString(value) {
    return value.replace(/'/g, "''");
}
function assertSafeIdentifier(value) {
    if (!/^[a-zA-Z0-9_]+$/.test(value)) {
        throw new Error('invalid_mysql_identifier');
    }
    return value;
}
function buildUserIdentifier(username) {
    const safe = assertSafeIdentifier(username);
    return `'${safe}'@'%'`;
}
async function execMysql(tools, sql) {
    const mysqlBin = process.env.NPANEL_MYSQL_CMD || 'mysql';
    const mysqlPath = await tools.resolve(mysqlBin, {
        packageHint: 'mysql-server or mariadb-server package',
    });
    const baseArgs = getArgsFromEnv('NPANEL_MYSQL', []);
    const fullArgs = [...baseArgs, '-e', sql];
    return execCommand(mysqlPath, fullArgs);
}
class ShellMysqlAdapter {
    tools;
    constructor(tools) {
        this.tools = tools;
    }
    async ensureAccountPresent(context, spec) {
        const userIdent = buildUserIdentifier(spec.username);
        if (!context.dryRun) {
            try {
                const createUserSql = `CREATE USER IF NOT EXISTS ${userIdent} IDENTIFIED BY '${escapeSqlString(spec.password)}'`;
                const createUserResult = await execMysql(this.tools, createUserSql);
                if (createUserResult.code !== 0) {
                    await context.log({
                        adapter: 'mysql_shell',
                        operation: 'create',
                        targetKind: 'mysql_account',
                        targetKey: spec.username,
                        success: false,
                        dryRun: false,
                        details: {},
                        errorMessage: 'create_user_failed',
                    });
                    throw new Error('mysql_create_user_failed');
                }
                for (const dbName of spec.databases) {
                    const safeDb = assertSafeIdentifier(dbName);
                    const createDbSql = `CREATE DATABASE IF NOT EXISTS \`${safeDb}\``;
                    const grantSql = `GRANT ALL PRIVILEGES ON \`${safeDb}\`.* TO ${userIdent}`;
                    const createDbResult = await execMysql(this.tools, createDbSql);
                    if (createDbResult.code !== 0) {
                        await context.log({
                            adapter: 'mysql_shell',
                            operation: 'create',
                            targetKind: 'mysql_account',
                            targetKey: spec.username,
                            success: false,
                            dryRun: false,
                            details: {},
                            errorMessage: 'create_database_failed',
                        });
                        throw new Error('mysql_create_database_failed');
                    }
                    const grantResult = await execMysql(this.tools, grantSql);
                    if (grantResult.code !== 0) {
                        await context.log({
                            adapter: 'mysql_shell',
                            operation: 'create',
                            targetKind: 'mysql_account',
                            targetKey: spec.username,
                            success: false,
                            dryRun: false,
                            details: {},
                            errorMessage: 'grant_failed',
                        });
                        throw new Error('mysql_grant_failed');
                    }
                }
                const flushResult = await execMysql(this.tools, 'FLUSH PRIVILEGES');
                if (flushResult.code !== 0) {
                    await context.log({
                        adapter: 'mysql_shell',
                        operation: 'create',
                        targetKind: 'mysql_account',
                        targetKey: spec.username,
                        success: false,
                        dryRun: false,
                        details: {},
                        errorMessage: 'flush_privileges_failed',
                    });
                    throw new Error('mysql_flush_privileges_failed');
                }
            }
            catch (err) {
                if (err instanceof tool_resolver_1.ToolNotFoundError) {
                    await context.log({
                        adapter: 'mysql_shell',
                        operation: 'create',
                        targetKind: 'mysql_account',
                        targetKey: spec.username,
                        success: false,
                        dryRun: false,
                        details: {
                            tool: err.toolName,
                            feature: 'mysql_account_management',
                            packageHint: err.packageHint ?? null,
                            methodsTried: err.methods,
                        },
                        errorMessage: 'tool_not_found',
                    });
                }
                throw err;
            }
        }
        await context.log({
            adapter: 'mysql_shell',
            operation: 'create',
            targetKind: 'mysql_account',
            targetKey: spec.username,
            success: true,
            dryRun: context.dryRun,
            details: {
                databases: spec.databases,
            },
            errorMessage: null,
        });
        const rollback = async () => {
            if (context.dryRun) {
                return;
            }
            const userIdent = buildUserIdentifier(spec.username);
            await execMysql(this.tools, `DROP USER IF EXISTS ${userIdent}`).catch(() => undefined);
            await execMysql(this.tools, 'FLUSH PRIVILEGES').catch(() => undefined);
        };
        return {
            rollback,
            details: {},
        };
    }
    async ensureAccountAbsent(context, username) {
        const userIdent = buildUserIdentifier(username);
        if (!context.dryRun) {
            try {
                await execMysql(this.tools, `DROP USER IF EXISTS ${userIdent}`).catch(() => undefined);
                await execMysql(this.tools, 'FLUSH PRIVILEGES').catch(() => undefined);
            }
            catch (err) {
                if (err instanceof tool_resolver_1.ToolNotFoundError) {
                    await context.log({
                        adapter: 'mysql_shell',
                        operation: 'delete',
                        targetKind: 'mysql_account',
                        targetKey: username,
                        success: false,
                        dryRun: false,
                        details: {
                            tool: err.toolName,
                            feature: 'mysql_account_management',
                            packageHint: err.packageHint ?? null,
                            methodsTried: err.methods,
                        },
                        errorMessage: 'tool_not_found',
                    });
                }
                throw err;
            }
        }
        await context.log({
            adapter: 'mysql_shell',
            operation: 'delete',
            targetKind: 'mysql_account',
            targetKey: username,
            success: true,
            dryRun: context.dryRun,
            details: {},
            errorMessage: null,
        });
        return {};
    }
}
exports.ShellMysqlAdapter = ShellMysqlAdapter;
//# sourceMappingURL=hosting-shell-mysql.adapter.js.map