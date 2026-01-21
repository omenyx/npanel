import type {
  AdapterContext,
  AdapterOperationResult,
  MysqlAdapter,
  MysqlAccountSpec,
} from './hosting-adapters';
import { ToolResolver, ToolNotFoundError } from '../system/tool-resolver';
import { execCommand, type ExecResult } from '../system/exec-command';

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

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function assertSafeIdentifier(value: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) {
    throw new Error('invalid_mysql_identifier');
  }
  return value;
}

function escapeSqlIdentifier(value: string): string {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

function buildUserIdentifier(username: string): string {
  const safe = assertSafeIdentifier(username);
  return `'${safe}'@'%'`;
}

async function execMysql(
  tools: ToolResolver,
  sql: string,
): Promise<ExecResult> {
  const mysqlBin = process.env.NPANEL_MYSQL_CMD || 'mysql';
  const mysqlPath = await tools.resolve(mysqlBin, {
    packageHint: 'mysql-server or mariadb-server package',
  });
  const baseArgs = getArgsFromEnv('NPANEL_MYSQL', []);
  const fullArgs = [...baseArgs, '-e', sql];
  return execCommand(mysqlPath, fullArgs);
}

export class ShellMysqlAdapter implements MysqlAdapter {
  constructor(private readonly tools: ToolResolver) {}

  async ensureAccountPresent(
    context: AdapterContext,
    spec: MysqlAccountSpec,
  ): Promise<AdapterOperationResult> {
    const userIdent = buildUserIdentifier(spec.username);
    if (!context.dryRun) {
      try {
        const createUserSql = `CREATE USER IF NOT EXISTS ${userIdent} IDENTIFIED BY '${escapeSqlString(
          spec.password,
        )}'`;
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
        const alterUserSql = `ALTER USER ${userIdent} IDENTIFIED BY '${escapeSqlString(
          spec.password,
        )}'`;
        const alterUserResult = await execMysql(this.tools, alterUserSql);
        if (alterUserResult.code !== 0) {
          const fallbackSql = `ALTER USER ${userIdent} IDENTIFIED WITH mysql_native_password BY '${escapeSqlString(
            spec.password,
          )}'`;
          const fallbackResult = await execMysql(this.tools, fallbackSql);
          if (fallbackResult.code !== 0) {
            await context.log({
              adapter: 'mysql_shell',
              operation: 'update',
              targetKind: 'mysql_account',
              targetKey: spec.username,
              success: false,
              dryRun: false,
              details: {},
              errorMessage: 'alter_user_failed',
            });
            throw new Error('mysql_alter_user_failed');
          }
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
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
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
      await execMysql(this.tools, `DROP USER IF EXISTS ${userIdent}`).catch(
        () => undefined,
      );
      await execMysql(this.tools, 'FLUSH PRIVILEGES').catch(() => undefined);
    };

    return {
      rollback,
      details: {},
    };
  }

  async ensureAccountAbsent(
    context: AdapterContext,
    username: string,
  ): Promise<AdapterOperationResult> {
    const userIdent = buildUserIdentifier(username);
    if (!context.dryRun) {
      try {
        const databases = await this.listDatabases(context, username).catch(
          () => [],
        );
        for (const dbName of databases) {
          await execMysql(
            this.tools,
            `DROP DATABASE IF EXISTS ${escapeSqlIdentifier(dbName)}`,
          ).catch(() => undefined);
        }
        await execMysql(this.tools, `DROP USER IF EXISTS ${userIdent}`).catch(
          () => undefined,
        );
        await execMysql(this.tools, 'FLUSH PRIVILEGES').catch(() => undefined);
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
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

  async listDatabases(
    context: AdapterContext,
    username: string,
  ): Promise<string[]> {
    const safeUser = assertSafeIdentifier(username);
    const sql = `SHOW DATABASES LIKE '${safeUser}_%'`;
    const result = await execMysql(this.tools, sql);
    if (result.code !== 0) {
      throw new Error(`Failed to list databases: ${result.stderr}`);
    }
    const lines = result.stdout.trim().split('\n');
    return lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line !== 'Database');
  }

  async resetPassword(
    context: AdapterContext,
    username: string,
    password: string,
  ): Promise<AdapterOperationResult> {
    const userIdent = buildUserIdentifier(username);
    if (!context.dryRun) {
      try {
        const sql = `ALTER USER IF EXISTS ${userIdent} IDENTIFIED BY '${escapeSqlString(password)}'`;
        const result = await execMysql(this.tools, sql);
        if (result.code !== 0) {
          throw new Error(`Failed to reset password: ${result.stderr}`);
        }
        await execMysql(this.tools, 'FLUSH PRIVILEGES');
      } catch (err) {
        await context.log({
          adapter: 'mysql_shell',
          operation: 'update',
          targetKind: 'mysql_account',
          targetKey: username,
          success: false,
          dryRun: false,
          details: {},
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
        });
        throw err;
      }
    }
    await context.log({
      adapter: 'mysql_shell',
      operation: 'update',
      targetKind: 'mysql_account',
      targetKey: username,
      success: true,
      dryRun: context.dryRun,
      details: { action: 'password_reset' },
      errorMessage: null,
    });
    return {};
  }
}
