export type AdapterOperationKind = 'create' | 'update' | 'suspend' | 'resume' | 'delete';
export type AdapterTargetKind = 'system_user' | 'web_vhost' | 'php_fpm_pool' | 'mysql_account' | 'dns_zone' | 'mailbox' | 'ftp_account';
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
    ensurePresent(context: AdapterContext, spec: UserSpec): Promise<AdapterOperationResult>;
    ensureSuspended(context: AdapterContext, username: string): Promise<AdapterOperationResult>;
    ensureResumed(context: AdapterContext, username: string): Promise<AdapterOperationResult>;
    ensureAbsent(context: AdapterContext, username: string): Promise<AdapterOperationResult>;
}
export interface WebServerAdapter {
    ensureVhostPresent(context: AdapterContext, spec: WebVhostSpec): Promise<AdapterOperationResult>;
    ensureVhostSuspended(context: AdapterContext, domain: string): Promise<AdapterOperationResult>;
    ensureVhostAbsent(context: AdapterContext, domain: string): Promise<AdapterOperationResult>;
}
export interface PhpFpmAdapter {
    ensurePoolPresent(context: AdapterContext, spec: PhpFpmPoolSpec): Promise<AdapterOperationResult>;
    ensurePoolAbsent(context: AdapterContext, name: string): Promise<AdapterOperationResult>;
}
export interface MysqlAdapter {
    ensureAccountPresent(context: AdapterContext, spec: MysqlAccountSpec): Promise<AdapterOperationResult>;
    ensureAccountAbsent(context: AdapterContext, username: string): Promise<AdapterOperationResult>;
}
export interface DnsAdapter {
    ensureZonePresent(context: AdapterContext, spec: DnsZoneSpec): Promise<AdapterOperationResult>;
    ensureZoneAbsent(context: AdapterContext, zoneName: string): Promise<AdapterOperationResult>;
}
export interface MailAdapter {
    ensureMailboxPresent(context: AdapterContext, spec: MailboxSpec): Promise<AdapterOperationResult>;
    ensureMailboxAbsent(context: AdapterContext, address: string): Promise<AdapterOperationResult>;
}
export interface FtpAdapter {
    ensureAccountPresent(context: AdapterContext, spec: FtpAccountSpec): Promise<AdapterOperationResult>;
    ensureAccountAbsent(context: AdapterContext, username: string): Promise<AdapterOperationResult>;
}
export declare const USER_ADAPTER: "USER_ADAPTER";
export declare const WEB_SERVER_ADAPTER: "WEB_SERVER_ADAPTER";
export declare const PHP_FPM_ADAPTER: "PHP_FPM_ADAPTER";
export declare const MYSQL_ADAPTER: "MYSQL_ADAPTER";
export declare const DNS_ADAPTER: "DNS_ADAPTER";
export declare const MAIL_ADAPTER: "MAIL_ADAPTER";
export declare const FTP_ADAPTER: "FTP_ADAPTER";
export declare class NoopUserAdapter implements UserAdapter {
    ensurePresent(context: AdapterContext, spec: UserSpec): Promise<AdapterOperationResult>;
    ensureSuspended(context: AdapterContext, username: string): Promise<AdapterOperationResult>;
    ensureResumed(context: AdapterContext, username: string): Promise<AdapterOperationResult>;
    ensureAbsent(context: AdapterContext, username: string): Promise<AdapterOperationResult>;
}
export declare class NoopWebServerAdapter implements WebServerAdapter {
    ensureVhostPresent(context: AdapterContext, spec: WebVhostSpec): Promise<AdapterOperationResult>;
    ensureVhostSuspended(context: AdapterContext, domain: string): Promise<AdapterOperationResult>;
    ensureVhostAbsent(context: AdapterContext, domain: string): Promise<AdapterOperationResult>;
}
export declare class NoopPhpFpmAdapter implements PhpFpmAdapter {
    ensurePoolPresent(context: AdapterContext, spec: PhpFpmPoolSpec): Promise<AdapterOperationResult>;
    ensurePoolAbsent(context: AdapterContext, name: string): Promise<AdapterOperationResult>;
}
export declare class NoopMysqlAdapter implements MysqlAdapter {
    ensureAccountPresent(context: AdapterContext, spec: MysqlAccountSpec): Promise<AdapterOperationResult>;
    ensureAccountAbsent(context: AdapterContext, username: string): Promise<AdapterOperationResult>;
}
export declare class NoopDnsAdapter implements DnsAdapter {
    ensureZonePresent(context: AdapterContext, spec: DnsZoneSpec): Promise<AdapterOperationResult>;
    ensureZoneAbsent(context: AdapterContext, zoneName: string): Promise<AdapterOperationResult>;
}
export declare class NoopMailAdapter implements MailAdapter {
    ensureMailboxPresent(context: AdapterContext, spec: MailboxSpec): Promise<AdapterOperationResult>;
    ensureMailboxAbsent(context: AdapterContext, address: string): Promise<AdapterOperationResult>;
}
export declare class NoopFtpAdapter implements FtpAdapter {
    ensureAccountPresent(context: AdapterContext, spec: FtpAccountSpec): Promise<AdapterOperationResult>;
    ensureAccountAbsent(context: AdapterContext, username: string): Promise<AdapterOperationResult>;
}
