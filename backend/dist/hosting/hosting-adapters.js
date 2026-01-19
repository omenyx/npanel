"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoopFtpAdapter = exports.NoopMailAdapter = exports.NoopDnsAdapter = exports.NoopMysqlAdapter = exports.NoopPhpFpmAdapter = exports.NoopWebServerAdapter = exports.NoopUserAdapter = exports.FTP_ADAPTER = exports.MAIL_ADAPTER = exports.DNS_ADAPTER = exports.MYSQL_ADAPTER = exports.PHP_FPM_ADAPTER = exports.WEB_SERVER_ADAPTER = exports.USER_ADAPTER = void 0;
exports.USER_ADAPTER = 'USER_ADAPTER';
exports.WEB_SERVER_ADAPTER = 'WEB_SERVER_ADAPTER';
exports.PHP_FPM_ADAPTER = 'PHP_FPM_ADAPTER';
exports.MYSQL_ADAPTER = 'MYSQL_ADAPTER';
exports.DNS_ADAPTER = 'DNS_ADAPTER';
exports.MAIL_ADAPTER = 'MAIL_ADAPTER';
exports.FTP_ADAPTER = 'FTP_ADAPTER';
class NoopUserAdapter {
    async ensurePresent(context, spec) {
        await context.log({
            adapter: 'user',
            operation: 'create',
            targetKind: 'system_user',
            targetKey: spec.username,
            success: true,
            dryRun: context.dryRun,
            details: {
                homeDirectory: spec.homeDirectory,
                shell: spec.shell ?? null,
            },
            errorMessage: null,
        });
        return {};
    }
    async ensureSuspended(context, username) {
        await context.log({
            adapter: 'user',
            operation: 'suspend',
            targetKind: 'system_user',
            targetKey: username,
            success: true,
            dryRun: context.dryRun,
            details: {},
            errorMessage: null,
        });
        return {};
    }
    async ensureResumed(context, username) {
        await context.log({
            adapter: 'user',
            operation: 'resume',
            targetKind: 'system_user',
            targetKey: username,
            success: true,
            dryRun: context.dryRun,
            details: {},
            errorMessage: null,
        });
        return {};
    }
    async ensureAbsent(context, username) {
        await context.log({
            adapter: 'user',
            operation: 'delete',
            targetKind: 'system_user',
            targetKey: username,
            success: true,
            dryRun: context.dryRun,
            details: {},
            errorMessage: null,
        });
        return {};
    }
}
exports.NoopUserAdapter = NoopUserAdapter;
class NoopWebServerAdapter {
    async ensureVhostPresent(context, spec) {
        await context.log({
            adapter: 'web_server',
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
        await context.log({
            adapter: 'web_server',
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
        await context.log({
            adapter: 'web_server',
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
exports.NoopWebServerAdapter = NoopWebServerAdapter;
class NoopPhpFpmAdapter {
    async ensurePoolPresent(context, spec) {
        await context.log({
            adapter: 'php_fpm',
            operation: 'create',
            targetKind: 'php_fpm_pool',
            targetKey: spec.name,
            success: true,
            dryRun: context.dryRun,
            details: {
                user: spec.user,
                listen: spec.listen,
            },
            errorMessage: null,
        });
        return {};
    }
    async ensurePoolAbsent(context, name) {
        await context.log({
            adapter: 'php_fpm',
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
exports.NoopPhpFpmAdapter = NoopPhpFpmAdapter;
class NoopMysqlAdapter {
    async ensureAccountPresent(context, spec) {
        await context.log({
            adapter: 'mysql',
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
        return {};
    }
    async ensureAccountAbsent(context, username) {
        await context.log({
            adapter: 'mysql',
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
exports.NoopMysqlAdapter = NoopMysqlAdapter;
class NoopDnsAdapter {
    async ensureZonePresent(context, spec) {
        await context.log({
            adapter: 'dns',
            operation: 'create',
            targetKind: 'dns_zone',
            targetKey: spec.zoneName,
            success: true,
            dryRun: context.dryRun,
            details: {},
            errorMessage: null,
        });
        return {};
    }
    async ensureZoneAbsent(context, zoneName) {
        await context.log({
            adapter: 'dns',
            operation: 'delete',
            targetKind: 'dns_zone',
            targetKey: zoneName,
            success: true,
            dryRun: context.dryRun,
            details: {},
            errorMessage: null,
        });
        return {};
    }
}
exports.NoopDnsAdapter = NoopDnsAdapter;
class NoopMailAdapter {
    async ensureMailboxPresent(context, spec) {
        await context.log({
            adapter: 'mail',
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
        await context.log({
            adapter: 'mail',
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
exports.NoopMailAdapter = NoopMailAdapter;
class NoopFtpAdapter {
    async ensureAccountPresent(context, spec) {
        await context.log({
            adapter: 'ftp',
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
        await context.log({
            adapter: 'ftp',
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
exports.NoopFtpAdapter = NoopFtpAdapter;
//# sourceMappingURL=hosting-adapters.js.map