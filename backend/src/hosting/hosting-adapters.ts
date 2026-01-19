export type AdapterOperationKind =
  | 'create'
  | 'update'
  | 'suspend'
  | 'resume'
  | 'delete';

export type AdapterTargetKind =
  | 'system_user'
  | 'web_vhost'
  | 'php_fpm_pool'
  | 'mysql_account'
  | 'dns_zone'
  | 'mailbox'
  | 'ftp_account';

export interface AdapterLogEntry {
  adapter: string;
  operation: AdapterOperationKind;
  targetKind: AdapterTargetKind;
  targetKey: string;
  success: boolean;
  dryRun: boolean;
  details?: Record<string, unknown>;
  errorMessage?: string | null;
}

export interface AdapterContext {
  dryRun: boolean;
  serviceId?: string;
  traceId?: string;
  log: (entry: AdapterLogEntry) => Promise<void> | void;
}

export interface AdapterOperationResult {
  rollback?: () => Promise<void>;
  details?: Record<string, unknown>;
}

export interface UserSpec {
  username: string;
  uid?: number;
  primaryGroup?: string;
  homeDirectory: string;
  shell?: string;
  quotaMb?: number;
}

export interface WebVhostSpec {
  domain: string;
  documentRoot: string;
  phpFpmPool?: string | null;
  sslCertificateId?: string | null;
}

export interface PhpFpmPoolSpec {
  name: string;
  user: string;
  group: string;
  listen: string;
  phpVersion?: string | null;
}

export interface MysqlAccountSpec {
  username: string;
  password: string;
  databases: string[];
}

export interface DnsRecordSpec {
  name: string;
  type: string;
  data: string;
}

export interface DnsZoneSpec {
  zoneName: string;
  records: DnsRecordSpec[];
}

export interface MailboxSpec {
  address: string;
  password: string;
  quotaMb?: number | null;
}

export interface FtpAccountSpec {
  username: string;
  password: string;
  homeDirectory: string;
}

export interface UserAdapter {
  ensurePresent(
    context: AdapterContext,
    spec: UserSpec,
  ): Promise<AdapterOperationResult>;
  ensureSuspended(
    context: AdapterContext,
    username: string,
  ): Promise<AdapterOperationResult>;

  ensureResumed(
    context: AdapterContext,
    username: string,
  ): Promise<AdapterOperationResult>;

  ensureAbsent(
    context: AdapterContext,
    username: string,
  ): Promise<AdapterOperationResult>;
}

export interface WebServerAdapter {
  ensureVhostPresent(
    context: AdapterContext,
    spec: WebVhostSpec,
  ): Promise<AdapterOperationResult>;
  ensureVhostSuspended(
    context: AdapterContext,
    domain: string,
  ): Promise<AdapterOperationResult>;
  ensureVhostAbsent(
    context: AdapterContext,
    domain: string,
  ): Promise<AdapterOperationResult>;
}

export interface PhpFpmAdapter {
  ensurePoolPresent(
    context: AdapterContext,
    spec: PhpFpmPoolSpec,
  ): Promise<AdapterOperationResult>;
  ensurePoolAbsent(
    context: AdapterContext,
    name: string,
  ): Promise<AdapterOperationResult>;
}

export interface MysqlAdapter {
  ensureAccountPresent(
    context: AdapterContext,
    spec: MysqlAccountSpec,
  ): Promise<AdapterOperationResult>;
  ensureAccountAbsent(
    context: AdapterContext,
    username: string,
  ): Promise<AdapterOperationResult>;
}

export interface DnsAdapter {
  ensureZonePresent(
    context: AdapterContext,
    spec: DnsZoneSpec,
  ): Promise<AdapterOperationResult>;
  ensureZoneAbsent(
    context: AdapterContext,
    zoneName: string,
  ): Promise<AdapterOperationResult>;
}

export interface MailAdapter {
  ensureMailboxPresent(
    context: AdapterContext,
    spec: MailboxSpec,
  ): Promise<AdapterOperationResult>;
  ensureMailboxAbsent(
    context: AdapterContext,
    address: string,
  ): Promise<AdapterOperationResult>;
  updatePassword(
    context: AdapterContext,
    address: string,
    password: string,
  ): Promise<AdapterOperationResult>;
  listMailboxes(
    context: AdapterContext,
    domain: string,
  ): Promise<string[]>;
}

export interface FtpAdapter {
  ensureAccountPresent(
    context: AdapterContext,
    spec: FtpAccountSpec,
  ): Promise<AdapterOperationResult>;
  ensureAccountAbsent(
    context: AdapterContext,
    username: string,
  ): Promise<AdapterOperationResult>;
}

export const USER_ADAPTER = 'USER_ADAPTER' as const;
export const WEB_SERVER_ADAPTER = 'WEB_SERVER_ADAPTER' as const;
export const PHP_FPM_ADAPTER = 'PHP_FPM_ADAPTER' as const;
export const MYSQL_ADAPTER = 'MYSQL_ADAPTER' as const;
export const DNS_ADAPTER = 'DNS_ADAPTER' as const;
export const MAIL_ADAPTER = 'MAIL_ADAPTER' as const;
export const FTP_ADAPTER = 'FTP_ADAPTER' as const;

export class NoopUserAdapter implements UserAdapter {
  async ensurePresent(
    context: AdapterContext,
    spec: UserSpec,
  ): Promise<AdapterOperationResult> {
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

  async ensureSuspended(
    context: AdapterContext,
    username: string,
  ): Promise<AdapterOperationResult> {
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

  async ensureResumed(
    context: AdapterContext,
    username: string,
  ): Promise<AdapterOperationResult> {
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

  async ensureAbsent(
    context: AdapterContext,
    username: string,
  ): Promise<AdapterOperationResult> {
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

export class NoopWebServerAdapter implements WebServerAdapter {
  async ensureVhostPresent(
    context: AdapterContext,
    spec: WebVhostSpec,
  ): Promise<AdapterOperationResult> {
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

  async ensureVhostSuspended(
    context: AdapterContext,
    domain: string,
  ): Promise<AdapterOperationResult> {
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

  async ensureVhostAbsent(
    context: AdapterContext,
    domain: string,
  ): Promise<AdapterOperationResult> {
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

export class NoopPhpFpmAdapter implements PhpFpmAdapter {
  async ensurePoolPresent(
    context: AdapterContext,
    spec: PhpFpmPoolSpec,
  ): Promise<AdapterOperationResult> {
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

  async ensurePoolAbsent(
    context: AdapterContext,
    name: string,
  ): Promise<AdapterOperationResult> {
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

export class NoopMysqlAdapter implements MysqlAdapter {
  async ensureAccountPresent(
    context: AdapterContext,
    spec: MysqlAccountSpec,
  ): Promise<AdapterOperationResult> {
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

  async ensureAccountAbsent(
    context: AdapterContext,
    username: string,
  ): Promise<AdapterOperationResult> {
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

export class NoopDnsAdapter implements DnsAdapter {
  async ensureZonePresent(
    context: AdapterContext,
    spec: DnsZoneSpec,
  ): Promise<AdapterOperationResult> {
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

  async ensureZoneAbsent(
    context: AdapterContext,
    zoneName: string,
  ): Promise<AdapterOperationResult> {
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

export class NoopMailAdapter implements MailAdapter {
  async ensureMailboxPresent(
    context: AdapterContext,
    spec: MailboxSpec,
  ): Promise<AdapterOperationResult> {
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

  async ensureMailboxAbsent(
    context: AdapterContext,
    address: string,
  ): Promise<AdapterOperationResult> {
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

  async updatePassword(
    context: AdapterContext,
    address: string,
    password: string,
  ): Promise<AdapterOperationResult> {
    await context.log({
      adapter: 'mail',
      operation: 'update',
      targetKind: 'mailbox',
      targetKey: address,
      success: true,
      dryRun: context.dryRun,
      details: { action: 'password_change' },
      errorMessage: null,
    });
    return {};
  }

  async listMailboxes(
    context: AdapterContext,
    domain: string,
  ): Promise<string[]> {
    return [`postmaster@${domain}`, `info@${domain}`];
  }
}

export class NoopFtpAdapter implements FtpAdapter {
  async ensureAccountPresent(
    context: AdapterContext,
    spec: FtpAccountSpec,
  ): Promise<AdapterOperationResult> {
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

  async ensureAccountAbsent(
    context: AdapterContext,
    username: string,
  ): Promise<AdapterOperationResult> {
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
