/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HostingServiceEntity } from './hosting-service.entity';
import { HostingPlan } from './hosting-plan.entity';
import { CreateHostingServiceDto } from './dto/create-hosting-service.dto';
import {
  DNS_ADAPTER,
  FTP_ADAPTER,
  MAIL_ADAPTER,
  MYSQL_ADAPTER,
  PHP_FPM_ADAPTER,
  USER_ADAPTER,
  WEB_SERVER_ADAPTER,
} from './hosting-adapters';
import type {
  AdapterContext,
  DnsAdapter,
  FtpAdapter,
  MailAdapter,
  MysqlAdapter,
  PhpFpmAdapter,
  UserAdapter,
  WebServerAdapter,
} from './hosting-adapters';
import { HostingLog } from './hosting-log.entity';
import { HostingCredentialsService } from './hosting-credentials.service';
import { AccountsService } from '../accounts/accounts.service';
import { ToolResolver } from '../system/tool-resolver';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { buildSafeExecEnv } from '../system/exec-env';
import { decryptString, encryptString } from '../system/secretbox';

type ActionMeta = {
  actorId?: string;
  actorRole?: string;
  actorType?: string;
  reason?: string;
};

type ProvisionPhase =
  | 'preflight'
  | 'system_user'
  | 'document_root'
  | 'php_fpm_pool'
  | 'web_vhost'
  | 'mysql_account'
  | 'dns_zone'
  | 'mailbox'
  | 'ftp_account'
  | 'structural_validate'
  | 'activate';

const PROVISION_PHASES: ProvisionPhase[] = [
  'preflight',
  'system_user',
  'document_root',
  'php_fpm_pool',
  'web_vhost',
  'mysql_account',
  'dns_zone',
  'mailbox',
  'ftp_account',
  'structural_validate',
  'activate',
];

type ProvisionError = {
  message: string;
  name?: string;
  stack?: string;
  at: string;
};

type ProvisioningCredentials = {
  username: string;
  mysqlUsername: string;
  mysqlPassword: string;
  mailboxPassword: string;
  ftpPassword: string;
};

@Injectable()
export class HostingService implements OnModuleInit {
  private readonly logger = new Logger(HostingService.name);

  constructor(
    @InjectRepository(HostingServiceEntity)
    private readonly services: Repository<HostingServiceEntity>,
    @InjectRepository(HostingPlan)
    private readonly plans: Repository<HostingPlan>,
    @Inject(USER_ADAPTER) private readonly userAdapter: UserAdapter,
    @Inject(WEB_SERVER_ADAPTER)
    private readonly webServerAdapter: WebServerAdapter,
    @Inject(PHP_FPM_ADAPTER)
    private readonly phpFpmAdapter: PhpFpmAdapter,
    @Inject(MYSQL_ADAPTER) private readonly mysqlAdapter: MysqlAdapter,
    @Inject(DNS_ADAPTER) private readonly dnsAdapter: DnsAdapter,
    @Inject(MAIL_ADAPTER) private readonly mailAdapter: MailAdapter,
    @Inject(FTP_ADAPTER) private readonly ftpAdapter: FtpAdapter,
    @InjectRepository(HostingLog)
    private readonly logs: Repository<HostingLog>,
    private readonly credentials: HostingCredentialsService,
    private readonly accounts: AccountsService,
    private readonly tools: ToolResolver,
  ) {}

  private readonly opClaims = new Set<string>();

  private claimOperation(id: string) {
    if (this.opClaims.has(id)) {
      throw new BadRequestException('concurrent_operation_blocked');
    }
    this.opClaims.add(id);
  }

  private releaseOperation(id: string) {
    this.opClaims.delete(id);
  }

  async onModuleInit() {
    const count = await this.plans.count();
    if (count === 0) {
      await this.plans.save({
        name: 'basic',
        diskQuotaMb: 5120,
        maxDatabases: 3,
        phpVersion: '8.2',
        mailboxQuotaMb: 1024,
        maxMailboxes: 5,
        maxFtpAccounts: 1,
      });
    }
  }

  async listPlans(): Promise<HostingPlan[]> {
    return this.plans.find({ order: { name: 'ASC' } });
  }

  async getPlan(name: string): Promise<HostingPlan | null> {
    return this.plans.findOne({ where: { name } });
  }

  async createPlan(input: any): Promise<HostingPlan> {
    const exists = await this.plans.findOne({ where: { name: input.name } });
    if (exists) {
      throw new BadRequestException(
        `Hosting plan '${input.name}' already exists`,
      );
    }
    const plan = this.plans.create(input);
    return this.plans.save(plan) as unknown as HostingPlan;
  }

  async deletePlan(name: string): Promise<{ deleted: boolean }> {
    const plan = await this.plans.findOne({ where: { name } });
    if (!plan) {
      throw new NotFoundException('Hosting plan not found');
    }
    const inUse = await this.services.count({ where: { planName: name } });
    if (inUse > 0) {
      throw new BadRequestException(
        `Cannot delete plan '${name}' because it is used by ${inUse} service(s)`,
      );
    }
    await this.plans.delete({ name });
    return { deleted: true };
  }

  async list(): Promise<HostingServiceEntity[]> {
    return this.services.find({ order: { createdAt: 'DESC' } });
  }

  async listForCustomer(customerId: string): Promise<HostingServiceEntity[]> {
    return this.services.find({
      where: { customerId },
      order: { createdAt: 'DESC' },
    });
  }

  async create(
    input: CreateHostingServiceDto,
    meta?: ActionMeta,
  ): Promise<
    | HostingServiceEntity
    | {
        service: HostingServiceEntity;
        credentials: {
          username: string;
          mysqlUsername: string;
          mysqlPassword: string;
          mailboxPassword: string;
          ftpPassword: string;
        };
      }
  > {
    const planName = input.planName ?? 'basic';
    const plan = await this.plans.findOne({ where: { name: planName } });
    if (!plan) {
      throw new BadRequestException(`Hosting plan '${planName}' not found`);
    }
    const existsForDomain = await this.services.findOne({
      where: { primaryDomain: input.primaryDomain },
    });
    if (existsForDomain) {
      if (existsForDomain.status === 'terminated') {
        await this.services.delete({ id: existsForDomain.id } as any);
      } else {
        throw new BadRequestException(
          `Hosting service for domain '${input.primaryDomain}' already exists`,
        );
      }
    }
    if (!input.customerId && !input.customer) {
      throw new BadRequestException(
        'Either customerId or customer must be provided',
      );
    }
    let customerId = input.customerId ?? null;
    if (!customerId && input.customer) {
      const existing = await this.accounts.findByEmail(input.customer.email);
      if (existing) {
        customerId = existing.id;
      } else {
        const created = await this.accounts.create('operator', {
          name: input.customer.name,
          email: input.customer.email,
        });
        customerId = created.id;
      }
    }
    if (!customerId) {
      throw new BadRequestException('Customer creation failed');
    }

    const domain = input.primaryDomain.toLowerCase();
    const base = domain.split('.')[0] ?? 'site';
    const safe = base.replace(/[^a-z0-9]/g, '').slice(0, 8) || 'site';
    const systemUsername = `u_${safe}`;
    const mysqlUsername = `${systemUsername}_db`;
    const existsForUsername = await this.services.findOne({
      where: { systemUsername },
    });
    if (existsForUsername) {
      throw new BadRequestException(
        `Derived system username '${systemUsername}' is already in use`,
      );
    }
    const entity = this.services.create({
      customerId,
      primaryDomain: input.primaryDomain,
      planName: plan.name,
      status: 'provisioning',
      provisioningPhase: 'preflight',
      provisioningCompletedPhasesJson: '[]',
      provisioningFailedPhase: null,
      provisioningErrorJson: null,
      provisioningUpdatedAt: new Date(),
      systemUsername,
      mysqlUsername,
      mysqlPasswordEnc: null,
      mailboxPasswordEnc: null,
      ftpPasswordEnc: null,
      softDeletedAt: null,
      hardDeleteEligibleAt: null,
    });
    const saved = await this.services.save(entity);
    const createContext = this.buildAdapterContext(saved);
    await createContext.log({
      adapter: 'hosting',
      operation: 'create',
      targetKind: 'hosting_service',
      targetKey: saved.id,
      success: true,
      dryRun: createContext.dryRun,
      details: {
        action: 'create',
        actorId: meta?.actorId ?? null,
        actorRole: meta?.actorRole ?? null,
        actorType: meta?.actorType ?? null,
        reason: meta?.reason ?? null,
      },
      errorMessage: null,
    });
    if (input.autoProvision === true) {
      const provisioned = await this.provisionWithCredentials(saved.id, meta);
      return provisioned;
    }
    return saved;
  }

  async get(id: string): Promise<HostingServiceEntity> {
    const service = await this.services.findOne({ where: { id } });
    if (!service) {
      throw new NotFoundException('Hosting service not found');
    }
    return service;
  }

  async listLogs(serviceId: string): Promise<HostingLog[]> {
    return this.logs.find({
      where: { serviceId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async listAllLogs(): Promise<HostingLog[]> {
    return this.logs.find({
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  async provision(
    id: string,
    meta?: ActionMeta,
  ): Promise<HostingServiceEntity> {
    this.claimOperation(id);
    const result = await this.provisionInternal(id, {
      returnCredentials: false,
      meta,
    });
    this.releaseOperation(id);
    return result.service;
  }

  async provisionWithCredentials(
    id: string,
    meta?: ActionMeta,
  ): Promise<{
    service: HostingServiceEntity;
    credentials: {
      username: string;
      mysqlUsername: string;
      mysqlPassword: string;
      mailboxPassword: string;
      ftpPassword: string;
    };
  }> {
    this.claimOperation(id);
    const result = await this.provisionInternal(id, {
      returnCredentials: true,
      meta,
    });
    this.releaseOperation(id);
    if (!result.credentials) {
      throw new Error('credentials_unavailable');
    }
    return {
      service: result.service,
      credentials: result.credentials,
    };
  }

  async resumeProvision(
    id: string,
    meta?: ActionMeta,
  ): Promise<HostingServiceEntity> {
    this.claimOperation(id);
    const result = await this.resumeProvisionInternal(id, { meta });
    this.releaseOperation(id);
    return result;
  }

  async retryProvision(
    id: string,
    meta?: ActionMeta,
  ): Promise<HostingServiceEntity> {
    const service = await this.get(id);
    const planName = service.planName ?? 'basic';
    const plan = await this.plans.findOne({ where: { name: planName } });
    if (!plan) {
      throw new BadRequestException(
        `Hosting plan '${planName}' not found for service ${service.id}`,
      );
    }
    const context = this.buildAdapterContext(service);
    const username =
      service.systemUsername || this.deriveSystemUsername(service);
    const homeDirectory = `/home/${username}`;

    const mailRequired = Number(plan.maxMailboxes ?? 0) > 0;
    const ftpRequired = Number(plan.maxFtpAccounts ?? 0) > 0;

    if (mailRequired) {
      await this.mailAdapter.ensureMailboxAbsent(
        context,
        `postmaster@${service.primaryDomain}`,
      );
    }
    await this.webServerAdapter.ensureVhostAbsent(
      context,
      service.primaryDomain,
    );
    await this.phpFpmAdapter.ensurePoolAbsent(context, username);
    await this.mysqlAdapter.ensureAccountAbsent(context, `${username}_db`);
    await this.dnsAdapter.ensureZoneAbsent(context, service.primaryDomain);
    if (ftpRequired) {
      await this.ftpAdapter.ensureAccountAbsent(context, username);
    }
    await this.userAdapter.ensureAbsent(context, username);

    service.status = 'provisioning';
    service.provisioningPhase = 'preflight';
    service.provisioningCompletedPhasesJson = '[]';
    service.provisioningFailedPhase = null;
    service.provisioningErrorJson = null;
    service.provisioningUpdatedAt = new Date();
    service.mysqlPasswordEnc = null;
    service.mailboxPasswordEnc = null;
    service.ftpPasswordEnc = null;
    await this.services.save(service);

    this.claimOperation(id);
    const result = await this.provisionInternal(id, {
      returnCredentials: false,
      meta,
    });
    this.releaseOperation(id);
    return result.service;
  }

  private async runTool(
    command: string,
    args: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildSafeExecEnv(),
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('close', (code) => {
        resolve({ code: code ?? -1, stdout, stderr });
      });
    });
  }

  private async ensureDocumentRoot(
    username: string,
    homeDirectory: string,
  ): Promise<string> {
    const documentRoot = `${homeDirectory}/public_html`;
    if (process.platform === 'win32') {
      return documentRoot;
    }
    await fs.mkdir(documentRoot, { recursive: true });
    const idPath = await this.tools.resolve('id');
    const uidRes = await this.runTool(idPath, ['-u', username]);
    const gidRes = await this.runTool(idPath, ['-g', username]);
    const uid = Number.parseInt(uidRes.stdout.trim(), 10);
    const gid = Number.parseInt(gidRes.stdout.trim(), 10);
    if (!Number.isFinite(uid) || !Number.isFinite(gid)) {
      throw new Error('invalid_uid_gid');
    }
    await fs.chown(documentRoot, uid, gid);
    await fs.chmod(documentRoot, 0o750);
    return documentRoot;
  }

  private parseCompletedPhases(
    service: HostingServiceEntity,
  ): ProvisionPhase[] {
    if (!service.provisioningCompletedPhasesJson) return [];
    try {
      const parsed = JSON.parse(
        service.provisioningCompletedPhasesJson,
      ) as unknown;
      if (!Array.isArray(parsed)) return [];
      const set = new Set<ProvisionPhase>();
      for (const item of parsed) {
        if (
          typeof item === 'string' &&
          (PROVISION_PHASES as string[]).includes(item)
        ) {
          set.add(item as ProvisionPhase);
        }
      }
      return Array.from(set);
    } catch {
      return [];
    }
  }

  private serializeCompletedPhases(phases: ProvisionPhase[]): string {
    const unique = Array.from(new Set(phases));
    return JSON.stringify(unique);
  }

  private buildProvisionError(err: unknown): ProvisionError {
    return {
      message: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : undefined,
      stack: err instanceof Error ? err.stack : undefined,
      at: new Date().toISOString(),
    };
  }

  private async markPhaseStart(
    service: HostingServiceEntity,
    phase: ProvisionPhase,
  ): Promise<HostingServiceEntity> {
    service.status = 'provisioning';
    service.provisioningPhase = phase;
    service.provisioningFailedPhase = null;
    service.provisioningErrorJson = null;
    service.provisioningUpdatedAt = new Date();
    return this.services.save(service);
  }

  private async markPhaseComplete(
    service: HostingServiceEntity,
    phase: ProvisionPhase,
  ): Promise<HostingServiceEntity> {
    const completed = this.parseCompletedPhases(service);
    if (!completed.includes(phase)) completed.push(phase);
    service.provisioningCompletedPhasesJson =
      this.serializeCompletedPhases(completed);
    const next = PROVISION_PHASES.find((p) => !completed.includes(p)) ?? null;
    service.provisioningPhase = next;
    service.provisioningUpdatedAt = new Date();
    return this.services.save(service);
  }

  private async markPhaseFailed(
    service: HostingServiceEntity,
    phase: ProvisionPhase,
    err: unknown,
  ): Promise<HostingServiceEntity> {
    service.status = 'error';
    service.provisioningPhase = phase;
    service.provisioningFailedPhase = phase;
    service.provisioningErrorJson = JSON.stringify(
      this.buildProvisionError(err),
    );
    service.provisioningUpdatedAt = new Date();
    return this.services.save(service);
  }

  private async ensureStoredCredentials(
    service: HostingServiceEntity,
    plan: HostingPlan,
  ): Promise<ProvisioningCredentials> {
    const username =
      service.systemUsername || this.deriveSystemUsername(service);
    const mysqlUsername = service.mysqlUsername || `${username}_db`;

    const mailRequired = Number(plan.maxMailboxes ?? 0) > 0;
    const ftpRequired = Number(plan.maxFtpAccounts ?? 0) > 0;

    if (!service.systemUsername || !service.mysqlUsername) {
      service.systemUsername = username;
      service.mysqlUsername = mysqlUsername;
    }
    if (!service.mysqlPasswordEnc) {
      service.mysqlPasswordEnc = encryptString(
        this.credentials.generateDatabasePassword(),
      );
    }
    if (mailRequired && !service.mailboxPasswordEnc) {
      service.mailboxPasswordEnc = encryptString(
        this.credentials.generateMailboxPassword(),
      );
    }
    if (ftpRequired && !service.ftpPasswordEnc) {
      service.ftpPasswordEnc = encryptString(
        this.credentials.generateFtpPassword(),
      );
    }
    service.provisioningUpdatedAt = new Date();
    service = await this.services.save(service);

    return {
      username,
      mysqlUsername,
      mysqlPassword: decryptString(service.mysqlPasswordEnc ?? ''),
      mailboxPassword: mailRequired
        ? decryptString(service.mailboxPasswordEnc ?? '')
        : '',
      ftpPassword: ftpRequired
        ? decryptString(service.ftpPasswordEnc ?? '')
        : '',
    };
  }

  private async provisionInternal(
    id: string,
    opts: { returnCredentials: boolean; meta?: ActionMeta },
  ): Promise<{
    service: HostingServiceEntity;
    credentials?: {
      username: string;
      mysqlUsername: string;
      mysqlPassword: string;
      mailboxPassword: string;
      ftpPassword: string;
    };
  }> {
    let service = await this.get(id);
    if (service.status === 'active') {
      return { service };
    }
    if (service.status !== 'provisioning' && service.status !== 'error') {
      throw new BadRequestException(
        'Provisioning is only allowed for provisioning or failed services',
      );
    }
    if (service.status === 'error' && service.provisioningFailedPhase) {
      throw new BadRequestException('use_resume_or_retry');
    }

    const planName = service.planName ?? 'basic';
    const plan = await this.plans.findOne({ where: { name: planName } });
    if (!plan) {
      throw new BadRequestException(
        `Hosting plan '${planName}' not found for service ${service.id}`,
      );
    }

    const completed = this.parseCompletedPhases(service);
    const startPhase =
      (service.provisioningPhase as ProvisionPhase | null) ?? 'preflight';
    const startIndex = Math.max(0, PROVISION_PHASES.indexOf(startPhase));

    const context = this.buildAdapterContext(service);
    const traceId = context.traceId ?? null;

    const username =
      service.systemUsername || this.deriveSystemUsername(service);
    const homeDirectory = `/home/${username}`;
    const phpPoolName = username;
    const mysqlUsername = service.mysqlUsername || `${username}_db`;

    let credentials: ProvisioningCredentials | null = null;
    let documentRoot: string | null = null;
    const rollbacks: Array<() => Promise<void>> = [];

    for (let index = startIndex; index < PROVISION_PHASES.length; index += 1) {
      const phase = PROVISION_PHASES[index];
      if (completed.includes(phase)) {
        continue;
      }
      service = await this.markPhaseStart(service, phase);
      try {
        if (phase === 'preflight') {
          if (plan.diskQuotaMb < 0) {
            throw new BadRequestException(
              `Plan '${plan.name}' has invalid disk quota (must be >= 0)`,
            );
          }
          const supportedPhp = ['7.4', '8.0', '8.1', '8.2', '8.3'];
          if (!supportedPhp.includes(plan.phpVersion)) {
            throw new BadRequestException(
              `Plan '${plan.name}' requests unsupported PHP version '${plan.phpVersion}' (supported: ${supportedPhp.join(', ')})`,
            );
          }
          const mailRequired = Number(plan.maxMailboxes ?? 0) > 0;
          const ftpRequired = Number(plan.maxFtpAccounts ?? 0) > 0;
          const readiness = await this.checkToolReadinessForProvision({
            requireMail: mailRequired,
            requireFtp: ftpRequired,
          });
          if (readiness.missing.length > 0) {
            throw new BadRequestException(
              `Provision blocked; missing tools: ${readiness.missing.join(', ')}`,
            );
          }
          if (
            !context.dryRun &&
            process.platform !== 'win32' &&
            plan.diskQuotaMb > 0 &&
            readiness.quotaStatus?.enabled !== true
          ) {
            throw new BadRequestException('quota_not_supported');
          }
          credentials = await this.ensureStoredCredentials(service, plan);
          await context.log({
            adapter: 'hosting',
            operation: 'update',
            targetKind: 'web_vhost',
            targetKey: service.id,
            success: true,
            dryRun: context.dryRun,
            details: { phase, traceId },
            errorMessage: null,
          });
        }

        if (!credentials) {
          credentials = await this.ensureStoredCredentials(service, plan);
        }

        if (phase === 'system_user') {
          await this.userAdapter.ensurePresent(context, {
            username,
            homeDirectory,
            primaryGroup: username,
            shell: '/bin/bash',
            quotaMb: plan.diskQuotaMb,
          });
          rollbacks.push(async () => {
            try {
              await this.userAdapter.ensureAbsent(context, username);
            } catch (rbErr) {
              await context.log({
                adapter: 'hosting',
                operation: 'delete',
                targetKind: 'system_user',
                targetKey: username,
                success: false,
                dryRun: context.dryRun,
                details: { phase, traceId, action: 'rollback' },
                errorMessage:
                  rbErr instanceof Error ? rbErr.message : 'rollback_failed',
              });
            }
          });
        }

        if (phase === 'document_root') {
          documentRoot = await this.ensureDocumentRoot(username, homeDirectory);
          rollbacks.push(async () => {
            if (process.platform === 'win32' || context.dryRun) return;
            try {
              await fs.rm(documentRoot!, { recursive: true, force: true });
            } catch (rbErr) {
              await context.log({
                adapter: 'hosting',
                operation: 'delete',
                targetKind: 'hosting_service',
                targetKey: service.id,
                success: false,
                dryRun: context.dryRun,
                details: {
                  phase,
                  traceId,
                  path: documentRoot!,
                  action: 'rollback',
                },
                errorMessage:
                  rbErr instanceof Error ? rbErr.message : 'rollback_failed',
              });
            }
          });
        }

        if (phase === 'php_fpm_pool') {
          await this.phpFpmAdapter.ensurePoolPresent(context, {
            name: phpPoolName,
            user: username,
            group: username,
            listen: `/run/php-fpm-${username}.sock`,
            phpVersion: plan.phpVersion,
          });
          rollbacks.push(async () => {
            try {
              await this.phpFpmAdapter.ensurePoolAbsent(context, phpPoolName);
            } catch (rbErr) {
              await context.log({
                adapter: 'hosting',
                operation: 'delete',
                targetKind: 'php_fpm_pool',
                targetKey: phpPoolName,
                success: false,
                dryRun: context.dryRun,
                details: { phase, traceId, action: 'rollback' },
                errorMessage:
                  rbErr instanceof Error ? rbErr.message : 'rollback_failed',
              });
            }
          });
        }

        if (phase === 'web_vhost') {
          if (!documentRoot) documentRoot = `${homeDirectory}/public_html`;
          await this.webServerAdapter.ensureVhostPresent(context, {
            domain: service.primaryDomain,
            documentRoot,
            phpFpmPool: phpPoolName,
            sslCertificateId: null,
          });
          rollbacks.push(async () => {
            try {
              await this.webServerAdapter.ensureVhostAbsent(
                context,
                service.primaryDomain,
              );
            } catch (rbErr) {
              await context.log({
                adapter: 'hosting',
                operation: 'delete',
                targetKind: 'web_vhost',
                targetKey: service.primaryDomain,
                success: false,
                dryRun: context.dryRun,
                details: { phase, traceId, action: 'rollback' },
                errorMessage:
                  rbErr instanceof Error ? rbErr.message : 'rollback_failed',
              });
            }
          });
        }

        if (phase === 'mysql_account') {
          await this.mysqlAdapter.ensureAccountPresent(context, {
            username: mysqlUsername,
            password: credentials.mysqlPassword,
            databases: [],
          });
          rollbacks.push(async () => {
            try {
              await this.mysqlAdapter.ensureAccountAbsent(
                context,
                mysqlUsername,
              );
            } catch (rbErr) {
              await context.log({
                adapter: 'hosting',
                operation: 'delete',
                targetKind: 'mysql_account',
                targetKey: mysqlUsername,
                success: false,
                dryRun: context.dryRun,
                details: { phase, traceId, action: 'rollback' },
                errorMessage:
                  rbErr instanceof Error ? rbErr.message : 'rollback_failed',
              });
            }
          });
        }

        if (phase === 'dns_zone') {
          const dnsRecords = this.buildDefaultDnsRecords(service.primaryDomain);
          await this.dnsAdapter.ensureZonePresent(context, {
            zoneName: service.primaryDomain,
            records: dnsRecords,
          });
          rollbacks.push(async () => {
            try {
              await this.dnsAdapter.ensureZoneAbsent(
                context,
                service.primaryDomain,
              );
            } catch (rbErr) {
              await context.log({
                adapter: 'hosting',
                operation: 'delete',
                targetKind: 'dns_zone',
                targetKey: service.primaryDomain,
                success: false,
                dryRun: context.dryRun,
                details: { phase, traceId, action: 'rollback' },
                errorMessage:
                  rbErr instanceof Error ? rbErr.message : 'rollback_failed',
              });
            }
          });
        }

        if (phase === 'mailbox') {
          const mailRequired = Number(plan.maxMailboxes ?? 0) > 0;
          if (mailRequired) {
            await this.mailAdapter.ensureMailboxPresent(context, {
              address: `postmaster@${service.primaryDomain}`,
              password: credentials.mailboxPassword,
              quotaMb: plan.mailboxQuotaMb,
            });
            rollbacks.push(async () => {
              try {
                await this.mailAdapter.ensureMailboxAbsent(
                  context,
                  `postmaster@${service.primaryDomain}`,
                );
              } catch (rbErr) {
                await context.log({
                  adapter: 'hosting',
                  operation: 'delete',
                  targetKind: 'mailbox',
                  targetKey: `postmaster@${service.primaryDomain}`,
                  success: false,
                  dryRun: context.dryRun,
                  details: { phase, traceId, action: 'rollback' },
                  errorMessage:
                    rbErr instanceof Error ? rbErr.message : 'rollback_failed',
                });
              }
            });
          }
        }

        if (phase === 'ftp_account') {
          const ftpRequired = Number(plan.maxFtpAccounts ?? 0) > 0;
          if (ftpRequired) {
            await this.ftpAdapter.ensureAccountPresent(context, {
              username,
              password: credentials.ftpPassword,
              homeDirectory,
            });
            rollbacks.push(async () => {
              try {
                await this.ftpAdapter.ensureAccountAbsent(context, username);
              } catch (rbErr) {
                await context.log({
                  adapter: 'hosting',
                  operation: 'delete',
                  targetKind: 'ftp_account',
                  targetKey: username,
                  success: false,
                  dryRun: context.dryRun,
                  details: { phase, traceId, action: 'rollback' },
                  errorMessage:
                    rbErr instanceof Error ? rbErr.message : 'rollback_failed',
                });
              }
            });
          }
        }

        if (phase === 'structural_validate') {
          await this.validateProvisionedStructure(service, plan, credentials);
        }

        if (phase === 'activate') {
          service.status = 'active';
          service.provisioningUpdatedAt = new Date();
          service = await this.services.save(service);
          await context.log({
            adapter: 'hosting',
            operation: 'update',
            targetKind: 'web_vhost',
            targetKey: service.id,
            success: true,
            dryRun: context.dryRun,
            details: {
              action: 'activate',
              traceId,
              actorId: opts.meta?.actorId ?? null,
              actorRole: opts.meta?.actorRole ?? null,
              actorType: opts.meta?.actorType ?? null,
              reason: opts.meta?.reason ?? null,
            },
            errorMessage: null,
          });
        }

        service = await this.markPhaseComplete(service, phase);
        completed.push(phase);
      } catch (error) {
        service = await this.markPhaseFailed(service, phase, error);
        // execute rollbacks in reverse order
        for (let i = rollbacks.length - 1; i >= 0; i -= 1) {
          try {
            await rollbacks[i]();
          } catch {
            // logged inside each rollback
          }
        }
        await context.log({
          adapter: 'hosting',
          operation: 'update',
          targetKind: 'web_vhost',
          targetKey: service.id,
          success: false,
          dryRun: context.dryRun,
          details: { action: 'phase_failed', phase, traceId },
          errorMessage:
            error instanceof Error ? error.message : 'unknown_error',
        });
        throw error;
      }
    }

    if (!opts.returnCredentials) {
      return { service };
    }
    if (!credentials) {
      throw new Error('credentials_unavailable');
    }
    return { service, credentials };
  }

  private async resumeProvisionInternal(
    id: string,
    opts: { meta?: ActionMeta },
  ): Promise<HostingServiceEntity> {
    let service = await this.get(id);
    if (service.status === 'active') {
      return service;
    }
    if (service.status !== 'error' && service.status !== 'provisioning') {
      throw new BadRequestException('resume_not_allowed');
    }

    const failedPhase =
      (service.provisioningFailedPhase as ProvisionPhase | null) ??
      (service.provisioningPhase as ProvisionPhase | null);
    if (!failedPhase) {
      throw new BadRequestException('no_failed_phase');
    }

    const planName = service.planName ?? 'basic';
    const plan = await this.plans.findOne({ where: { name: planName } });
    if (!plan) {
      throw new BadRequestException(
        `Hosting plan '${planName}' not found for service ${service.id}`,
      );
    }

    const completed = this.parseCompletedPhases(service);
    const startIndex = Math.max(0, PROVISION_PHASES.indexOf(failedPhase));

    const context = this.buildAdapterContext(service);
    const traceId = context.traceId ?? null;

    const username =
      service.systemUsername || this.deriveSystemUsername(service);
    const homeDirectory = `/home/${username}`;
    const phpPoolName = username;
    const mysqlUsername = service.mysqlUsername || `${username}_db`;

    const credentials = await this.ensureStoredCredentials(service, plan);
    let documentRoot: string | null = null;
    const rollbacks: Array<() => Promise<void>> = [];

    for (let index = startIndex; index < PROVISION_PHASES.length; index += 1) {
      const phase = PROVISION_PHASES[index];
      if (completed.includes(phase)) {
        continue;
      }
      service = await this.markPhaseStart(service, phase);
      try {
        if (phase === 'preflight') {
          const mailRequired = Number(plan.maxMailboxes ?? 0) > 0;
          const ftpRequired = Number(plan.maxFtpAccounts ?? 0) > 0;
          const readiness = await this.checkToolReadinessForProvision({
            requireMail: mailRequired,
            requireFtp: ftpRequired,
          });
          if (readiness.missing.length > 0) {
            throw new BadRequestException(
              `Provision blocked; missing tools: ${readiness.missing.join(', ')}`,
            );
          }
          if (
            !context.dryRun &&
            process.platform !== 'win32' &&
            plan.diskQuotaMb > 0 &&
            readiness.quotaStatus?.enabled !== true
          ) {
            throw new BadRequestException('quota_not_supported');
          }
        }

        if (phase === 'system_user') {
          await this.userAdapter.ensurePresent(context, {
            username,
            homeDirectory,
            primaryGroup: username,
            shell: '/bin/bash',
            quotaMb: plan.diskQuotaMb,
          });
          rollbacks.push(async () => {
            try {
              await this.userAdapter.ensureAbsent(context, username);
            } catch (rbErr) {
              await context.log({
                adapter: 'hosting',
                operation: 'delete',
                targetKind: 'system_user',
                targetKey: username,
                success: false,
                dryRun: context.dryRun,
                details: { phase, traceId, action: 'rollback' },
                errorMessage:
                  rbErr instanceof Error ? rbErr.message : 'rollback_failed',
              });
            }
          });
        }

        if (phase === 'document_root') {
          documentRoot = await this.ensureDocumentRoot(username, homeDirectory);
          rollbacks.push(async () => {
            if (process.platform === 'win32' || context.dryRun) return;
            try {
              await fs.rm(documentRoot!, { recursive: true, force: true });
            } catch (rbErr) {
              await context.log({
                adapter: 'hosting',
                operation: 'delete',
                targetKind: 'hosting_service',
                targetKey: service.id,
                success: false,
                dryRun: context.dryRun,
                details: {
                  phase,
                  traceId,
                  path: documentRoot!,
                  action: 'rollback',
                },
                errorMessage:
                  rbErr instanceof Error ? rbErr.message : 'rollback_failed',
              });
            }
          });
        }

        if (phase === 'php_fpm_pool') {
          await this.phpFpmAdapter.ensurePoolPresent(context, {
            name: phpPoolName,
            user: username,
            group: username,
            listen: `/run/php-fpm-${username}.sock`,
            phpVersion: plan.phpVersion,
          });
          rollbacks.push(async () => {
            try {
              await this.phpFpmAdapter.ensurePoolAbsent(context, phpPoolName);
            } catch (rbErr) {
              await context.log({
                adapter: 'hosting',
                operation: 'delete',
                targetKind: 'php_fpm_pool',
                targetKey: phpPoolName,
                success: false,
                dryRun: context.dryRun,
                details: { phase, traceId, action: 'rollback' },
                errorMessage:
                  rbErr instanceof Error ? rbErr.message : 'rollback_failed',
              });
            }
          });
        }

        if (phase === 'web_vhost') {
          if (!documentRoot) documentRoot = `${homeDirectory}/public_html`;
          await this.webServerAdapter.ensureVhostPresent(context, {
            domain: service.primaryDomain,
            documentRoot,
            phpFpmPool: phpPoolName,
            sslCertificateId: null,
          });
          rollbacks.push(async () => {
            try {
              await this.webServerAdapter.ensureVhostAbsent(
                context,
                service.primaryDomain,
              );
            } catch (rbErr) {
              await context.log({
                adapter: 'hosting',
                operation: 'delete',
                targetKind: 'web_vhost',
                targetKey: service.primaryDomain,
                success: false,
                dryRun: context.dryRun,
                details: { phase, traceId, action: 'rollback' },
                errorMessage:
                  rbErr instanceof Error ? rbErr.message : 'rollback_failed',
              });
            }
          });
        }

        if (phase === 'mysql_account') {
          await this.mysqlAdapter.ensureAccountPresent(context, {
            username: mysqlUsername,
            password: credentials.mysqlPassword,
            databases: [],
          });
          rollbacks.push(async () => {
            try {
              await this.mysqlAdapter.ensureAccountAbsent(
                context,
                mysqlUsername,
              );
            } catch (rbErr) {
              await context.log({
                adapter: 'hosting',
                operation: 'delete',
                targetKind: 'mysql_account',
                targetKey: mysqlUsername,
                success: false,
                dryRun: context.dryRun,
                details: { phase, traceId, action: 'rollback' },
                errorMessage:
                  rbErr instanceof Error ? rbErr.message : 'rollback_failed',
              });
            }
          });
        }

        if (phase === 'dns_zone') {
          const dnsRecords = this.buildDefaultDnsRecords(service.primaryDomain);
          await this.dnsAdapter.ensureZonePresent(context, {
            zoneName: service.primaryDomain,
            records: dnsRecords,
          });
          rollbacks.push(async () => {
            try {
              await this.dnsAdapter.ensureZoneAbsent(
                context,
                service.primaryDomain,
              );
            } catch (rbErr) {
              await context.log({
                adapter: 'hosting',
                operation: 'delete',
                targetKind: 'dns_zone',
                targetKey: service.primaryDomain,
                success: false,
                dryRun: context.dryRun,
                details: { phase, traceId, action: 'rollback' },
                errorMessage:
                  rbErr instanceof Error ? rbErr.message : 'rollback_failed',
              });
            }
          });
        }

        if (phase === 'mailbox') {
          const mailRequired = Number(plan.maxMailboxes ?? 0) > 0;
          if (mailRequired) {
            await this.mailAdapter.ensureMailboxPresent(context, {
              address: `postmaster@${service.primaryDomain}`,
              password: credentials.mailboxPassword,
              quotaMb: plan.mailboxQuotaMb,
            });
            rollbacks.push(async () => {
              try {
                await this.mailAdapter.ensureMailboxAbsent(
                  context,
                  `postmaster@${service.primaryDomain}`,
                );
              } catch (rbErr) {
                await context.log({
                  adapter: 'hosting',
                  operation: 'delete',
                  targetKind: 'mailbox',
                  targetKey: `postmaster@${service.primaryDomain}`,
                  success: false,
                  dryRun: context.dryRun,
                  details: { phase, traceId, action: 'rollback' },
                  errorMessage:
                    rbErr instanceof Error ? rbErr.message : 'rollback_failed',
                });
              }
            });
          }
        }

        if (phase === 'ftp_account') {
          const ftpRequired = Number(plan.maxFtpAccounts ?? 0) > 0;
          if (ftpRequired) {
            await this.ftpAdapter.ensureAccountPresent(context, {
              username,
              password: credentials.ftpPassword,
              homeDirectory,
            });
            rollbacks.push(async () => {
              try {
                await this.ftpAdapter.ensureAccountAbsent(context, username);
              } catch (rbErr) {
                await context.log({
                  adapter: 'hosting',
                  operation: 'delete',
                  targetKind: 'ftp_account',
                  targetKey: username,
                  success: false,
                  dryRun: context.dryRun,
                  details: { phase, traceId, action: 'rollback' },
                  errorMessage:
                    rbErr instanceof Error ? rbErr.message : 'rollback_failed',
                });
              }
            });
          }
        }

        if (phase === 'structural_validate') {
          await this.validateProvisionedStructure(service, plan, credentials);
        }

        if (phase === 'activate') {
          service.status = 'active';
          service.provisioningUpdatedAt = new Date();
          service = await this.services.save(service);
          await context.log({
            adapter: 'hosting',
            operation: 'update',
            targetKind: 'web_vhost',
            targetKey: service.id,
            success: true,
            dryRun: context.dryRun,
            details: {
              action: 'activate',
              traceId,
              actorId: opts.meta?.actorId ?? null,
              actorRole: opts.meta?.actorRole ?? null,
              actorType: opts.meta?.actorType ?? null,
              reason: opts.meta?.reason ?? null,
            },
            errorMessage: null,
          });
        }

        service = await this.markPhaseComplete(service, phase);
        completed.push(phase);
      } catch (error) {
        service = await this.markPhaseFailed(service, phase, error);
        for (let i = rollbacks.length - 1; i >= 0; i -= 1) {
          try {
            await rollbacks[i]();
          } catch (rollbackErr) {
            // Silently swallow rollback errors during failure handling
            void rollbackErr; // Acknowledge the error variable
          }
        }
        await context.log({
          adapter: 'hosting',
          operation: 'update',
          targetKind: 'web_vhost',
          targetKey: service.id,
          success: false,
          dryRun: context.dryRun,
          details: { action: 'phase_failed', phase, traceId },
          errorMessage:
            error instanceof Error ? error.message : 'unknown_error',
        });
        throw error;
      }
    }

    return service;
  }

  async initCredentials(
    id: string,
    input: { mailboxPassword?: string; ftpPassword?: string },
    meta?: ActionMeta,
  ): Promise<{
    service: HostingServiceEntity;
    mailboxPassword: string;
    ftpPassword: string;
  }> {
    let service = await this.get(id);
    const planName = service.planName ?? 'basic';
    const plan = await this.plans.findOne({ where: { name: planName } });
    if (!plan) {
      throw new BadRequestException(
        `Hosting plan '${planName}' not found for service ${service.id}`,
      );
    }
    const mailEnabled = Number(plan.maxMailboxes ?? 0) > 0;
    const ftpEnabled = Number(plan.maxFtpAccounts ?? 0) > 0;
    const readiness = await this.checkToolReadinessForProvision({
      requireMail: mailEnabled,
      requireFtp: ftpEnabled,
    });
    if (readiness.missing.length > 0) {
      throw new BadRequestException(
        `Cannot set credentials; missing tools: ${readiness.missing.join(', ')}`,
      );
    }
    const context = this.buildAdapterContext(service);
    const username =
      service.systemUsername || this.deriveSystemUsername(service);
    const mailboxPassword = mailEnabled
      ? input.mailboxPassword || this.credentials.generateMailboxPassword()
      : '';
    const ftpPassword = ftpEnabled
      ? input.ftpPassword || this.credentials.generateFtpPassword()
      : '';
    if (mailEnabled) {
      await this.mailAdapter.ensureMailboxPresent(context, {
        address: `postmaster@${service.primaryDomain}`,
        password: mailboxPassword,
        quotaMb: null,
      });
    }
    if (ftpEnabled) {
      await this.ftpAdapter.ensureAccountPresent(context, {
        username,
        password: ftpPassword,
        homeDirectory: `/home/${username}`,
      });
    }
    if (mailEnabled) {
      service.mailboxPasswordEnc = encryptString(mailboxPassword);
    }
    if (ftpEnabled) {
      service.ftpPasswordEnc = encryptString(ftpPassword);
    }
    service.provisioningUpdatedAt = new Date();
    service = await this.services.save(service);
    await context.log({
      adapter: 'hosting',
      operation: 'update',
      targetKind: 'web_vhost',
      targetKey: service.id,
      success: true,
      dryRun: context.dryRun,
      details: {
        action: 'init_credentials',
        mailApplied: mailEnabled,
        ftpApplied: ftpEnabled,
        actorId: meta?.actorId ?? null,
        actorRole: meta?.actorRole ?? null,
        actorType: meta?.actorType ?? null,
        reason: meta?.reason ?? null,
      },
      errorMessage: null,
    });
    return { service, mailboxPassword, ftpPassword };
  }

  async suspend(id: string, meta?: ActionMeta): Promise<HostingServiceEntity> {
    this.claimOperation(id);
    const service = await this.get(id);
    if (service.status !== 'active') {
      return service;
    }
    const context = this.buildAdapterContext(service);
    const username =
      service.systemUsername || this.deriveSystemUsername(service);
    await this.userAdapter.ensureSuspended(context, username);
    await this.webServerAdapter.ensureVhostSuspended(
      context,
      service.primaryDomain,
    );
    service.status = 'suspended';
    const saved = await this.services.save(service);
    await context.log({
      adapter: 'hosting',
      operation: 'update',
      targetKind: 'web_vhost',
      targetKey: service.id,
      success: true,
      dryRun: context.dryRun,
      details: {
        action: 'suspend',
        actorId: meta?.actorId ?? null,
        actorRole: meta?.actorRole ?? null,
        actorType: meta?.actorType ?? null,
        reason: meta?.reason ?? null,
      },
      errorMessage: null,
    });
    this.releaseOperation(id);
    return saved;
  }

  async softDelete(
    id: string,
    meta?: ActionMeta,
  ): Promise<HostingServiceEntity> {
    this.claimOperation(id);
    const service = await this.get(id);
    if (service.status !== 'active') {
      throw new BadRequestException(
        'Soft delete is only allowed for active services',
      );
    }
    const context = this.buildAdapterContext(service);
    const username =
      service.systemUsername || this.deriveSystemUsername(service);

    await this.userAdapter.ensureSuspended(context, username);
    await this.webServerAdapter.ensureVhostSuspended(
      context,
      service.primaryDomain,
    );

    const mailboxRotatePassword = this.credentials.generateMailboxPassword();
    const mysqlRotatePassword = this.credentials.generateDatabasePassword();
    const ftpRotatePassword = this.credentials.generateFtpPassword();
    const mysqlUsername = `${username}_db`;
    const mailboxes = await this.mailAdapter.listMailboxes(
      context,
      service.primaryDomain,
    );
    for (const address of mailboxes) {
      if (
        typeof address === 'string' &&
        address.endsWith(`@${service.primaryDomain}`)
      ) {
        await this.mailAdapter.updatePassword(
          context,
          address,
          mailboxRotatePassword,
        );
      }
    }
    await this.mysqlAdapter.resetPassword(
      context,
      mysqlUsername,
      mysqlRotatePassword,
    );
    await this.ftpAdapter.resetPassword(context, username, ftpRotatePassword);

    const retentionHoursRaw = process.env.NPANEL_SOFT_DELETE_RETENTION_HOURS;
    const retentionHours =
      typeof retentionHoursRaw === 'string' &&
      retentionHoursRaw.trim().length > 0
        ? Number.parseInt(retentionHoursRaw, 10)
        : 168;
    const hours =
      Number.isFinite(retentionHours) && retentionHours >= 1
        ? retentionHours
        : 168;
    service.status = 'soft_deleted';
    service.mailboxPasswordEnc = encryptString(mailboxRotatePassword);
    service.mysqlPasswordEnc = encryptString(mysqlRotatePassword);
    service.ftpPasswordEnc = encryptString(ftpRotatePassword);
    service.softDeletedAt = new Date();
    service.hardDeleteEligibleAt = new Date(
      Date.now() + hours * 60 * 60 * 1000,
    );
    const saved = await this.services.save(service);
    await context.log({
      adapter: 'hosting',
      operation: 'update',
      targetKind: 'web_vhost',
      targetKey: service.id,
      success: true,
      dryRun: context.dryRun,
      details: {
        action: 'soft_delete',
        hardDeleteEligibleAt: saved.hardDeleteEligibleAt?.toISOString() ?? null,
        actorId: meta?.actorId ?? null,
        actorRole: meta?.actorRole ?? null,
        actorType: meta?.actorType ?? null,
        reason: meta?.reason ?? null,
      },
      errorMessage: null,
    });
    this.releaseOperation(id);
    return saved;
  }

  async restore(id: string, meta?: ActionMeta): Promise<HostingServiceEntity> {
    this.claimOperation(id);
    const service = await this.get(id);
    if (service.status !== 'soft_deleted') {
      throw new BadRequestException(
        'Restore is only allowed for soft-deleted services',
      );
    }
    const context = this.buildAdapterContext(service);
    const username =
      service.systemUsername || this.deriveSystemUsername(service);
    await this.userAdapter.ensureResumed(context, username);
    await this.webServerAdapter.ensureVhostPresent(context, {
      domain: service.primaryDomain,
      documentRoot: `/home/${username}/public_html`,
      phpFpmPool: username,
      sslCertificateId: null,
    });
    service.status = 'active';
    service.softDeletedAt = null;
    service.hardDeleteEligibleAt = null;
    const saved = await this.services.save(service);
    await context.log({
      adapter: 'hosting',
      operation: 'update',
      targetKind: 'web_vhost',
      targetKey: service.id,
      success: true,
      dryRun: context.dryRun,
      details: {
        action: 'restore',
        actorId: meta?.actorId ?? null,
        actorRole: meta?.actorRole ?? null,
        actorType: meta?.actorType ?? null,
        reason: meta?.reason ?? null,
      },
      errorMessage: null,
    });
    this.releaseOperation(id);
    return saved;
  }

  async unsuspend(
    id: string,
    meta?: ActionMeta,
  ): Promise<HostingServiceEntity> {
    this.claimOperation(id);
    const service = await this.get(id);
    if (service.status !== 'suspended') {
      return service;
    }
    const context = this.buildAdapterContext(service);
    const username = this.deriveSystemUsername(service);
    await this.userAdapter.ensureResumed(context, username);
    // For web server, ensureVhostPresent (idempotent) re-creates the symlink if missing
    const plan = await this.plans.findOne({
      where: { name: service.planName || 'basic' },
    });
    if (plan) {
      await this.webServerAdapter.ensureVhostPresent(context, {
        domain: service.primaryDomain,
        documentRoot: `/home/${username}/public_html`,
        phpFpmPool: username,
        sslCertificateId: null,
      });
    }

    service.status = 'active';
    const saved = await this.services.save(service);
    await context.log({
      adapter: 'hosting',
      operation: 'update',
      targetKind: 'web_vhost',
      targetKey: service.id,
      success: true,
      dryRun: context.dryRun,
      details: {
        action: 'unsuspend',
        actorId: meta?.actorId ?? null,
        actorRole: meta?.actorRole ?? null,
        actorType: meta?.actorType ?? null,
        reason: meta?.reason ?? null,
      },
      errorMessage: null,
    });
    this.releaseOperation(id);
    return saved;
  }

  terminate(): Promise<HostingServiceEntity> {
    throw new BadRequestException('Termination requires prepare and confirm');
  }

  async terminatePrepare(
    id: string,
    meta?: ActionMeta,
  ): Promise<{ token: string; service: HostingServiceEntity }> {
    this.claimOperation(id);
    const service = await this.get(id);
    if (service.status !== 'soft_deleted') {
      throw new BadRequestException('Hard delete requires soft delete first');
    }
    if (
      service.hardDeleteEligibleAt &&
      service.hardDeleteEligibleAt.getTime() > Date.now()
    ) {
      throw new BadRequestException('Hard delete blocked by retention window');
    }
    const token = randomBytes(24).toString('hex');
    service.terminationToken = token;
    service.terminationTokenExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const saved = await this.services.save(service);
    const context = this.buildAdapterContext(saved);
    await context.log({
      adapter: 'hosting',
      operation: 'update',
      targetKind: 'web_vhost',
      targetKey: saved.primaryDomain,
      success: true,
      dryRun: context.dryRun,
      details: {
        action: 'hard_delete_prepare',
        actorId: meta?.actorId ?? null,
        actorRole: meta?.actorRole ?? null,
        actorType: meta?.actorType ?? null,
        reason: meta?.reason ?? null,
      },
      errorMessage: null,
    });
    this.releaseOperation(id);
    return { token, service: saved };
  }

  async terminateConfirm(
    id: string,
    token: string,
    opts?: { purge?: boolean; meta?: ActionMeta },
  ): Promise<HostingServiceEntity> {
    this.claimOperation(id);
    const service = await this.get(id);
    if (service.status !== 'soft_deleted') {
      throw new BadRequestException('Hard delete requires soft delete first');
    }
    if (!service.terminationToken || !service.terminationTokenExpiresAt) {
      throw new BadRequestException('Missing termination token');
    }
    if (service.terminationToken !== token) {
      throw new BadRequestException('Invalid termination token');
    }
    if (service.terminationTokenExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Termination token expired');
    }
    const purge = opts?.purge === true;
    const context = this.buildAdapterContext(service);
    const username = this.deriveSystemUsername(service);
    const homeDirectory = `/home/${username}`;
    const phpPoolName = username;
    const mysqlUsername = `${username}_db`;

    if (!context.dryRun) {
      const backupBin = process.env.NPANEL_BACKUP_CMD;
      if (!backupBin) {
        throw new BadRequestException('Hard delete requires NPANEL_BACKUP_CMD');
      }
      const command = await this.tools.resolve(backupBin);
      const argsValue = process.env.NPANEL_BACKUP_ARGS;
      const baseArgs =
        typeof argsValue === 'string'
          ? argsValue
              .split(' ')
              .map((p) => p.trim())
              .filter((p) => p.length > 0)
          : [];
      const snapshotArgs = [
        ...baseArgs,
        'snapshot',
        service.id,
        service.primaryDomain,
        homeDirectory,
      ];
      const snap = await this.runTool(command, snapshotArgs);
      if (snap.code !== 0) {
        await context.log({
          adapter: 'backup_shell',
          operation: 'create',
          targetKind: 'backup_snapshot',
          targetKey: service.id,
          success: false,
          dryRun: false,
          details: {
            command,
            args: snapshotArgs,
            stdout: snap.stdout,
            stderr: snap.stderr,
            actorId: opts?.meta?.actorId ?? null,
            actorRole: opts?.meta?.actorRole ?? null,
            actorType: opts?.meta?.actorType ?? null,
            reason: opts?.meta?.reason ?? null,
          },
          errorMessage: 'backup_snapshot_failed',
        });
        throw new BadRequestException(
          'Hard delete blocked: backup snapshot failed',
        );
      }
      await context.log({
        adapter: 'backup_shell',
        operation: 'create',
        targetKind: 'backup_snapshot',
        targetKey: service.id,
        success: true,
        dryRun: false,
        details: {
          command,
          args: snapshotArgs,
          actorId: opts?.meta?.actorId ?? null,
          actorRole: opts?.meta?.actorRole ?? null,
          actorType: opts?.meta?.actorType ?? null,
          reason: opts?.meta?.reason ?? null,
        },
        errorMessage: null,
      });
    }
    const mailboxesToDelete = new Set<string>([
      `postmaster@${service.primaryDomain}`,
    ]);
    if (purge) {
      const mailboxes = await this.mailAdapter.listMailboxes(
        context,
        service.primaryDomain,
      );
      for (const address of mailboxes) {
        if (typeof address === 'string' && address.includes('@')) {
          mailboxesToDelete.add(address);
        }
      }
    }
    for (const address of mailboxesToDelete) {
      await this.mailAdapter.ensureMailboxAbsent(context, address);
    }
    await this.webServerAdapter.ensureVhostAbsent(
      context,
      service.primaryDomain,
    );
    await this.phpFpmAdapter.ensurePoolAbsent(context, phpPoolName);
    await this.mysqlAdapter.ensureAccountAbsent(context, mysqlUsername);
    await this.dnsAdapter.ensureZoneAbsent(context, service.primaryDomain);
    await this.ftpAdapter.ensureAccountAbsent(context, username);
    await this.userAdapter.ensureAbsent(context, username);
    await context.log({
      adapter: 'hosting',
      operation: 'delete',
      targetKind: 'web_vhost',
      targetKey: service.primaryDomain,
      success: true,
      dryRun: context.dryRun,
      details: {
        action: 'hard_delete',
        homeDirectory,
        actorId: opts?.meta?.actorId ?? null,
        actorRole: opts?.meta?.actorRole ?? null,
        actorType: opts?.meta?.actorType ?? null,
        reason: opts?.meta?.reason ?? null,
      },
      errorMessage: null,
    });
    service.status = 'terminated';
    service.terminationToken = null;
    service.terminationTokenExpiresAt = null;
    const saved = await this.services.save(service);
    if (purge) {
      await this.services.delete({ id: service.id } as any);
    }
    this.releaseOperation(id);
    return saved;
  }

  async terminateCancel(
    id: string,
    meta?: ActionMeta,
  ): Promise<HostingServiceEntity> {
    this.claimOperation(id);
    const service = await this.get(id);
    if (service.status !== 'soft_deleted') {
      return service;
    }
    service.terminationToken = null;
    service.terminationTokenExpiresAt = null;
    const saved = await this.services.save(service);
    const context = this.buildAdapterContext(saved);
    await context.log({
      adapter: 'hosting',
      operation: 'update',
      targetKind: 'web_vhost',
      targetKey: saved.primaryDomain,
      success: true,
      dryRun: context.dryRun,
      details: {
        action: 'hard_delete_cancel',
        actorId: meta?.actorId ?? null,
        actorRole: meta?.actorRole ?? null,
        actorType: meta?.actorType ?? null,
        reason: meta?.reason ?? null,
      },
      errorMessage: null,
    });
    this.releaseOperation(id);
    return saved;
  }

  async listMailboxes(id: string): Promise<string[]> {
    const service = await this.get(id);
    const context = this.buildAdapterContext(service);
    return this.mailAdapter.listMailboxes(context, service.primaryDomain);
  }

  async updateMailboxPassword(
    id: string,
    address: string,
    password: string,
  ): Promise<void> {
    const service = await this.get(id);
    if (service.status !== 'active') {
      throw new BadRequestException('Service is not active');
    }
    const context = this.buildAdapterContext(service);
    if (!address.endsWith(`@${service.primaryDomain}`)) {
      throw new BadRequestException(
        `Mailbox '${address}' does not belong to domain '${service.primaryDomain}'`,
      );
    }

    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    await this.mailAdapter.updatePassword(context, address, password);
  }

  async createMailbox(
    id: string,
    input: { localPart: string; password: string },
  ): Promise<{ address: string }> {
    const service = await this.get(id);
    if (service.status !== 'active') {
      throw new BadRequestException('Service is not active');
    }
    const planName = service.planName ?? 'basic';
    const plan = await this.plans.findOne({ where: { name: planName } });
    if (!plan) {
      throw new BadRequestException('Hosting plan not found');
    }

    const localPart = input.localPart.trim().toLowerCase();
    if (
      !/^[a-z0-9._-]+$/.test(localPart) ||
      localPart.length < 1 ||
      localPart.length > 64
    ) {
      throw new BadRequestException('Invalid mailbox name');
    }
    if (input.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const existing = await this.listMailboxes(id);
    if (existing.length >= plan.maxMailboxes) {
      throw new BadRequestException('Mailbox limit reached for this plan');
    }

    const address = `${localPart}@${service.primaryDomain}`;
    const context = this.buildAdapterContext(service);
    await this.mailAdapter.ensureMailboxPresent(context, {
      address,
      password: input.password,
      quotaMb: plan.mailboxQuotaMb,
    });
    return { address };
  }

  async deleteMailbox(id: string, address: string): Promise<void> {
    const service = await this.get(id);
    if (service.status !== 'active') {
      throw new BadRequestException('Service is not active');
    }
    if (!address.endsWith(`@${service.primaryDomain}`)) {
      throw new BadRequestException('Mailbox does not belong to this service');
    }
    const context = this.buildAdapterContext(service);
    await this.mailAdapter.ensureMailboxAbsent(context, address);
  }

  async listDatabases(id: string): Promise<string[]> {
    const service = await this.get(id);
    const context = this.buildAdapterContext(service);
    const mysqlUsername =
      service.mysqlUsername ||
      `${service.systemUsername || this.deriveSystemUsername(service)}_db`;
    return this.mysqlAdapter.listDatabases(context, mysqlUsername);
  }

  async resetDatabasePassword(id: string, password: string): Promise<void> {
    const service = await this.get(id);
    if (service.status !== 'active')
      throw new BadRequestException('Service not active');
    const context = this.buildAdapterContext(service);
    const mysqlUsername =
      service.mysqlUsername ||
      `${service.systemUsername || this.deriveSystemUsername(service)}_db`;
    await this.mysqlAdapter.resetPassword(context, mysqlUsername, password);
  }

  async getFtpCredentials(
    id: string,
  ): Promise<{ username: string; host: string }> {
    const service = await this.get(id);
    const username =
      service.systemUsername || this.deriveSystemUsername(service);
    const host = process.env.NPANEL_HOSTING_DEFAULT_IPV4 || '127.0.0.1';
    return { username, host };
  }

  async resetFtpPassword(id: string, password: string): Promise<void> {
    const service = await this.get(id);
    if (service.status !== 'active')
      throw new BadRequestException('Service not active');
    const context = this.buildAdapterContext(service);
    const username = this.deriveSystemUsername(service);
    await this.ftpAdapter.resetPassword(context, username, password);
  }

  async listDnsRecords(id: string): Promise<any[]> {
    const service = await this.get(id);
    const context = this.buildAdapterContext(service);
    return this.dnsAdapter.listRecords(context, service.primaryDomain);
  }

  private buildAdapterContext(service: HostingServiceEntity): AdapterContext {
    const dryRun = process.env.NPANEL_HOSTING_DRY_RUN === '1';
    const traceId = service.id;
    const logsRepo = this.logs;
    return {
      dryRun,
      serviceId: service.id,
      traceId,
      log: async (entry) => {
        const redact = (obj: any): any => {
          if (!obj || typeof obj !== 'object') return obj;
          const clone: any = Array.isArray(obj)
            ? obj.map((v) => redact(v))
            : { ...obj };
          for (const k of Object.keys(clone)) {
            if (/(password|secret|token|key)/i.test(k)) {
              clone[k] = '[REDACTED]';
            }
          }
          return clone;
        };
        const safeEntry = {
          ...entry,
          details: redact(entry.details ?? {}),
        };
        const payload = {
          ...safeEntry,
          serviceId: service.id,
        };
        const entity = logsRepo.create({
          serviceId: service.id,
          adapter: safeEntry.adapter,
          operation: safeEntry.operation,
          targetKind: safeEntry.targetKind,
          targetKey: safeEntry.targetKey,
          success: safeEntry.success,
          dryRun: safeEntry.dryRun,
          details: safeEntry.details,
          errorMessage: safeEntry.errorMessage ?? null,
        });
        await logsRepo.save(entity);
        if (process.env.NPANEL_HOSTING_LOG === 'json') {
          this.logger.debug(
            `Hosting operation logged: ${JSON.stringify(payload)}`,
          );
        }
      },
    };
  }

  private async checkToolReadinessForProvision(opts?: {
    requireMail?: boolean;
    requireFtp?: boolean;
  }): Promise<{
    missing: string[];
    quotaStatus?: {
      tools_present: boolean;
      mount_options: boolean;
      kernel_support: boolean;
      enabled: boolean;
    };
  }> {
    const required: string[] = [
      'id',
      'useradd',
      'usermod',
      'userdel',
      'nginx',
      'php-fpm',
      'mysql',
    ];
    const dnsBackend = (process.env.NPANEL_DNS_BACKEND || '').toLowerCase();
    if (dnsBackend === 'powerdns') required.push('pdnsutil');
    if (dnsBackend === 'bind') required.push('rndc');
    const missing: string[] = [];
    for (const name of required) {
      const status = await this.tools.statusFor(name);
      if (!status.available) {
        missing.push(name);
      }
    }
    if (opts?.requireMail) {
      if (!process.env.NPANEL_MAIL_CMD) {
        missing.push('mail_cmd');
      } else {
        const mailStatus = await this.tools.statusFor(
          process.env.NPANEL_MAIL_CMD,
        );
        if (!mailStatus.available) missing.push('mail_cmd');
      }
    }
    if (opts?.requireFtp) {
      if (!process.env.NPANEL_FTP_CMD) {
        missing.push('ftp_cmd');
      } else {
        const ftpStatus = await this.tools.statusFor(
          process.env.NPANEL_FTP_CMD,
        );
        if (!ftpStatus.available) missing.push('ftp_cmd');
      }
    }

    const quotaStatus = await this.verifyQuotaSupport();

    return { missing, quotaStatus };
  }

  async verifyQuotaSupport(): Promise<{
    tools_present: boolean;
    mount_options: boolean;
    kernel_support: boolean;
    enabled: boolean;
  }> {
    // 1. Check for quota tools
    const quotaStatus = await this.tools.statusFor('quota');
    const quotaCheckStatus = await this.tools.statusFor('quotacheck');
    const toolsPresent = !!(
      quotaStatus.available && quotaCheckStatus.available
    );

    // 2. Check mount options in /proc/mounts
    let mountOptions = false;
    try {
      const mounts = await fs.readFile('/proc/mounts', 'utf8');
      // Look for ext4/xfs with usrquota/grpquota on root or home
      if (/(\/|\/home)\s+\w+\s+.*(usrquota|grpquota|quota).*/.test(mounts)) {
        mountOptions = true;
      }
    } catch (e) {
      this.logger.warn(
        `Failed to read /proc/mounts: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // 3. Check kernel support (primitive check)
    let kernelSupport = false;
    try {
      await fs.access('/proc/sys/fs/quota');
      kernelSupport = true;
    } catch {
      kernelSupport = false;
    }

    return {
      tools_present: toolsPresent,
      mount_options: mountOptions,
      kernel_support: kernelSupport,
      enabled: toolsPresent && mountOptions,
    };
  }

  private async validateProvisionedStructure(
    service: HostingServiceEntity,
    plan: HostingPlan,
    credentials: ProvisioningCredentials,
  ): Promise<void> {
    if (process.platform === 'win32') {
      return;
    }

    const username =
      service.systemUsername || this.deriveSystemUsername(service);
    const homeDirectory = `/home/${username}`;
    const documentRoot = `${homeDirectory}/public_html`;

    const missing: string[] = [];

    try {
      await fs.access(homeDirectory);
    } catch {
      missing.push('home_directory');
    }
    try {
      await fs.access(documentRoot);
    } catch {
      missing.push('document_root');
    }

    const safeDomain =
      service.primaryDomain.toLowerCase().replace(/[^a-z0-9.-]/g, '') ||
      'invalid-domain';
    const vhostFilename = `${safeDomain}.conf`;
    const vhostAvailableRoot =
      process.env.NPANEL_WEB_VHOST_ROOT || '/etc/nginx/sites-available';
    const vhostEnabledRoot =
      process.env.NPANEL_WEB_VHOST_ENABLED_ROOT || '/etc/nginx/sites-enabled';
    const vhostAvailablePath = `${vhostAvailableRoot}/${vhostFilename}`;
    const vhostEnabledPath = `${vhostEnabledRoot}/${vhostFilename}`;
    try {
      await fs.access(vhostAvailablePath);
    } catch {
      missing.push('web_vhost_available');
    }
    try {
      await fs.access(vhostEnabledPath);
    } catch {
      missing.push('web_vhost_enabled');
    }

    const poolRoot = process.env.NPANEL_PHP_FPM_POOL_ROOT || '/etc/php-fpm.d';
    const poolSafe =
      username.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'pool';
    const poolPath = `${poolRoot}/${poolSafe}.conf`;
    try {
      await fs.access(poolPath);
    } catch {
      missing.push('php_fpm_pool');
    }

    const dnsBackend = (process.env.NPANEL_DNS_BACKEND || '').toLowerCase();
    if (!dnsBackend) {
      missing.push('dns_backend');
    } else if (dnsBackend === 'bind') {
      const zoneRoot = process.env.NPANEL_BIND_ZONE_ROOT || '/etc/named';
      const zonePath = `${zoneRoot}/${service.primaryDomain}.zone`;
      try {
        await fs.access(zonePath);
      } catch {
        missing.push('dns_zone');
      }
    } else if (dnsBackend === 'powerdns') {
      try {
        const pdnsBin = process.env.NPANEL_POWERDNS_PDNSUTIL_CMD || 'pdnsutil';
        const pdnsPath = await this.tools.resolve(pdnsBin);
        const baseArgs = (process.env.NPANEL_POWERDNS_PDNSUTIL_ARGS || '')
          .split(' ')
          .map((p) => p.trim())
          .filter((p) => p.length > 0);
        const res = await this.runTool(pdnsPath, [
          ...baseArgs,
          'list-zone',
          service.primaryDomain,
        ]);
        if (res.code !== 0) {
          missing.push('dns_zone');
        }
      } catch {
        missing.push('dns_zone_validation');
      }
    } else {
      missing.push('dns_backend');
    }

    const mailRequired = Number(plan.maxMailboxes ?? 0) > 0;
    if (mailRequired) {
      const mailbox = `postmaster@${service.primaryDomain}`;
      const passwdFile =
        process.env.NPANEL_DOVECOT_PASSWD_FILE || '/etc/npanel/dovecot-passwd';
      try {
        const content = await fs.readFile(passwdFile, 'utf8');
        if (!content.split('\n').some((l) => l.startsWith(`${mailbox}:`))) {
          missing.push('mailbox_passwd_entry');
        }
      } catch {
        missing.push('mailbox_passwd_file');
      }
      const maildir = `/var/mail/vhosts/${service.primaryDomain}/postmaster/Maildir`;
      try {
        await fs.access(maildir);
      } catch {
        missing.push('mailbox_maildir');
      }
      if (!credentials.mailboxPassword) {
        missing.push('mailbox_password');
      }
    }

    const ftpRequired = Number(plan.maxFtpAccounts ?? 0) > 0;
    if (ftpRequired) {
      const ftpPasswdFile =
        process.env.NPANEL_PUREPW_PASSWD_FILE ||
        '/etc/pure-ftpd/pureftpd.passwd';
      try {
        const content = await fs.readFile(ftpPasswdFile, 'utf8');
        if (!content.split('\n').some((l) => l.startsWith(`${username}:`))) {
          missing.push('ftp_account_entry');
        }
      } catch {
        missing.push('ftp_passwd_file');
      }
      if (!credentials.ftpPassword) {
        missing.push('ftp_password');
      }
    }

    try {
      const mysqlBin = process.env.NPANEL_MYSQL_CMD || 'mysql';
      const mysqlPath = await this.tools.resolve(mysqlBin);
      const sql = `SELECT COUNT(*) AS c FROM mysql.user WHERE user='${(
        service.mysqlUsername || `${username}_db`
      ).replace(/'/g, "\\'")}';`;
      const res = await this.runTool(mysqlPath, ['-N', '-B', '-e', sql]);
      const count = Number.parseInt(res.stdout.trim(), 10);
      if (!Number.isFinite(count) || count < 1) {
        missing.push('mysql_account');
      }
    } catch {
      missing.push('mysql_validation');
    }

    if (missing.length > 0) {
      throw new Error(`structural_validation_failed:${missing.join(',')}`);
    }
  }

  private deriveSystemUsername(service: HostingServiceEntity): string {
    const domain = service.primaryDomain.toLowerCase();
    const base = domain.split('.')[0] ?? 'site';
    const safe = base.replace(/[^a-z0-9]/g, '').slice(0, 8) || 'site';
    return `u_${safe}`;
  }

  private buildDefaultDnsRecords(domain: string) {
    const ipv4 = process.env.NPANEL_HOSTING_DEFAULT_IPV4 || '127.0.0.1';
    const fqdn = domain.endsWith('.') ? domain : `${domain}.`;
    return [
      {
        name: '@',
        type: 'A',
        data: ipv4,
      },
      {
        name: '@',
        type: 'MX',
        data: `10 ${fqdn}`,
      },
      {
        name: '@',
        type: 'TXT',
        data: '"v=spf1 mx ~all"',
      },
    ];
  }
}
