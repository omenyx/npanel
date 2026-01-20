import {
  BadRequestException,
  Inject,
  Injectable,
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
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { buildSafeExecEnv } from '../system/exec-env';

const execAsync = promisify(exec);

type ActionMeta = {
  actorId?: string;
  actorRole?: string;
  actorType?: string;
  reason?: string;
};

@Injectable()
export class HostingService implements OnModuleInit {
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
      throw new BadRequestException(`Hosting plan '${input.name}' already exists`);
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
      throw new BadRequestException(`Cannot delete plan '${name}' because it is used by ${inUse} service(s)`);
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

  async create(input: CreateHostingServiceDto, meta?: ActionMeta): Promise<HostingServiceEntity | { service: HostingServiceEntity; credentials: { username: string; mysqlUsername: string; mysqlPassword: string; mailboxPassword: string; ftpPassword: string } }> {
    const planName = input.planName ?? 'basic';
    const plan = await this.plans.findOne({ where: { name: planName } });
    if (!plan) {
      throw new BadRequestException(`Hosting plan '${planName}' not found`);
    }
    const existsForDomain = await this.services.findOne({ where: { primaryDomain: input.primaryDomain } });
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
      throw new BadRequestException('Either customerId or customer must be provided');
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

    const entity = this.services.create({
      customerId,
      primaryDomain: input.primaryDomain,
      planName: plan.name,
      status: 'provisioning',
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

  async provision(id: string, meta?: ActionMeta): Promise<HostingServiceEntity> {
    const result = await this.provisionInternal(id, { returnCredentials: false, meta });
    return result.service;
  }

  async provisionWithCredentials(id: string, meta?: ActionMeta): Promise<{
    service: HostingServiceEntity;
    credentials: {
      username: string;
      mysqlUsername: string;
      mysqlPassword: string;
      mailboxPassword: string;
      ftpPassword: string;
    };
  }> {
    const result = await this.provisionInternal(id, { returnCredentials: true, meta });
    if (!result.credentials) {
      throw new Error('credentials_unavailable');
    }
    return {
      service: result.service,
      credentials: result.credentials,
    };
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
    const service = await this.get(id);
    if (
      service.status !== 'provisioning' &&
      service.status !== 'error' &&
      service.status !== 'active'
    ) {
      throw new BadRequestException(
        'Provisioning is only allowed for new or failed services',
      );
    }
    if (service.status === 'active') {
      return { service };
    }

    const planName = service.planName ?? 'basic';
    const plan = await this.plans.findOne({ where: { name: planName } });
    if (!plan) {
      throw new BadRequestException(
        `Hosting plan '${planName}' not found for service ${service.id}`,
      );
    }
    const mailEnabled =
      Number(plan.maxMailboxes ?? 0) > 0 &&
      typeof process.env.NPANEL_MAIL_CMD === 'string' &&
      process.env.NPANEL_MAIL_CMD.length > 0;
    const ftpEnabled =
      Number(plan.maxFtpAccounts ?? 0) > 0 &&
      typeof process.env.NPANEL_FTP_CMD === 'string' &&
      process.env.NPANEL_FTP_CMD.length > 0;
    const readiness = await this.checkToolReadinessForProvision({
      requireMail: mailEnabled,
      requireFtp: ftpEnabled,
    });
    if (readiness.missing.length > 0) {
      throw new BadRequestException(
        `Provision blocked; missing tools: ${readiness.missing.join(', ')}`,
      );
    }
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

    const context = this.buildAdapterContext(service);
    const username = this.deriveSystemUsername(service);
    const homeDirectory = `/home/${username}`;
    const phpPoolName = username;
    const mysqlUsername = `${username}_db`;
    const mysqlPassword = this.credentials.generateDatabasePassword();
    const mailboxPassword = mailEnabled
      ? this.credentials.generateMailboxPassword()
      : '';
    const ftpPassword = ftpEnabled ? this.credentials.generateFtpPassword() : '';
    const traceId = context.traceId ?? null;

    const rollbackFns: Array<() => Promise<void>> = [];
    const registerRollback = (fn?: () => Promise<void>) => {
      if (fn) rollbackFns.push(fn);
    };

    try {
      service.status = 'provisioning';
      await this.services.save(service);

      await context.log({
        adapter: 'hosting',
        operation: 'update',
        targetKind: 'system_user',
        targetKey: username,
        success: true,
        dryRun: context.dryRun,
        details: { phase: 'start', step: 'system_user', traceId },
        errorMessage: null,
      });
      const userResult = await this.userAdapter.ensurePresent(context, {
        username,
        homeDirectory,
        primaryGroup: username,
        shell: '/bin/bash',
        quotaMb: plan.diskQuotaMb,
      });
      registerRollback(userResult.rollback);

      await context.log({
        adapter: 'hosting',
        operation: 'update',
        targetKind: 'system_user',
        targetKey: username,
        success: true,
        dryRun: context.dryRun,
        details: { phase: 'start', step: 'document_root', traceId },
        errorMessage: null,
      });
      const documentRoot = await this.ensureDocumentRoot(username, homeDirectory);

      await context.log({
        adapter: 'hosting',
        operation: 'update',
        targetKind: 'php_fpm_pool',
        targetKey: phpPoolName,
        success: true,
        dryRun: context.dryRun,
        details: { phase: 'start', step: 'php_fpm_pool', traceId },
        errorMessage: null,
      });
      const phpResult = await this.phpFpmAdapter.ensurePoolPresent(context, {
        name: phpPoolName,
        user: username,
        group: username,
        listen: `/run/php-fpm-${username}.sock`,
        phpVersion: plan.phpVersion,
      });
      registerRollback(phpResult.rollback);

      await context.log({
        adapter: 'hosting',
        operation: 'update',
        targetKind: 'web_vhost',
        targetKey: service.primaryDomain,
        success: true,
        dryRun: context.dryRun,
        details: { phase: 'start', step: 'web_vhost', traceId },
        errorMessage: null,
      });
      const webResult = await this.webServerAdapter.ensureVhostPresent(context, {
        domain: service.primaryDomain,
        documentRoot,
        phpFpmPool: phpPoolName,
        sslCertificateId: null,
      });
      registerRollback(webResult.rollback);

      await context.log({
        adapter: 'hosting',
        operation: 'update',
        targetKind: 'mysql_account',
        targetKey: mysqlUsername,
        success: true,
        dryRun: context.dryRun,
        details: { phase: 'start', step: 'mysql_account', traceId },
        errorMessage: null,
      });
      const mysqlResult = await this.mysqlAdapter.ensureAccountPresent(context, {
        username: mysqlUsername,
        password: mysqlPassword,
        databases: [],
      });
      registerRollback(mysqlResult.rollback);

      await context.log({
        adapter: 'hosting',
        operation: 'update',
        targetKind: 'dns_zone',
        targetKey: service.primaryDomain,
        success: true,
        dryRun: context.dryRun,
        details: { phase: 'start', step: 'dns_zone', traceId },
        errorMessage: null,
      });
      const dnsRecords = this.buildDefaultDnsRecords(service.primaryDomain);
      const dnsResult = await this.dnsAdapter.ensureZonePresent(context, {
        zoneName: service.primaryDomain,
        records: dnsRecords,
      });
      registerRollback(dnsResult.rollback);

      await context.log({
        adapter: 'hosting',
        operation: 'update',
        targetKind: 'mailbox',
        targetKey: `postmaster@${service.primaryDomain}`,
        success: true,
        dryRun: context.dryRun,
        details: { phase: 'start', step: 'mailbox', traceId, enabled: mailEnabled },
        errorMessage: null,
      });
      if (mailEnabled) {
        const mailResult = await this.mailAdapter.ensureMailboxPresent(context, {
          address: `postmaster@${service.primaryDomain}`,
          password: mailboxPassword,
          quotaMb: plan.mailboxQuotaMb,
        });
        registerRollback(mailResult.rollback);
      } else if (Number(plan.maxMailboxes ?? 0) > 0) {
        await context.log({
          adapter: 'hosting',
          operation: 'update',
          targetKind: 'mailbox',
          targetKey: `postmaster@${service.primaryDomain}`,
          success: true,
          dryRun: context.dryRun,
          details: { action: 'skipped', reason: 'mail_cmd_not_configured', traceId },
          errorMessage: null,
        });
      }

      await context.log({
        adapter: 'hosting',
        operation: 'update',
        targetKind: 'ftp_account',
        targetKey: username,
        success: true,
        dryRun: context.dryRun,
        details: { phase: 'start', step: 'ftp_account', traceId, enabled: ftpEnabled },
        errorMessage: null,
      });
      if (ftpEnabled) {
        const ftpResult = await this.ftpAdapter.ensureAccountPresent(context, {
          username,
          password: ftpPassword,
          homeDirectory,
        });
        registerRollback(ftpResult.rollback);
      } else if (Number(plan.maxFtpAccounts ?? 0) > 0) {
        await context.log({
          adapter: 'hosting',
          operation: 'update',
          targetKind: 'ftp_account',
          targetKey: username,
          success: true,
          dryRun: context.dryRun,
          details: { action: 'skipped', reason: 'ftp_cmd_not_configured', traceId },
          errorMessage: null,
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
          action: 'provision',
          traceId,
          actorId: opts.meta?.actorId ?? null,
          actorRole: opts.meta?.actorRole ?? null,
          actorType: opts.meta?.actorType ?? null,
          reason: opts.meta?.reason ?? null,
        },
        errorMessage: null,
      });

      if (!opts.returnCredentials) {
        return { service: saved };
      }
      return {
        service: saved,
        credentials: {
          username,
          mysqlUsername,
          mysqlPassword,
          mailboxPassword,
          ftpPassword,
        },
      };
    } catch (error) {
      const contextAfter = this.buildAdapterContext(service);
      for (let index = rollbackFns.length - 1; index >= 0; index -= 1) {
        const fn = rollbackFns[index];
        try {
          await fn();
        } catch {
          await contextAfter.log({
            adapter: 'hosting',
            operation: 'update',
            targetKind: 'web_vhost',
            targetKey: service.id,
            success: false,
            dryRun: contextAfter.dryRun,
            details: {
              action: 'rollback_failed',
              traceId,
            },
            errorMessage: 'Rollback handler failed',
          });
        }
      }
      service.status = 'error';
      await this.services.save(service);
      await contextAfter.log({
        adapter: 'hosting',
        operation: 'update',
        targetKind: 'web_vhost',
        targetKey: service.id,
        success: false,
        dryRun: contextAfter.dryRun,
        details: {
          action: 'provision_failed',
          traceId,
        },
        errorMessage:
          error instanceof Error ? error.message : 'Unknown provisioning error',
      });
      throw error;
    }
  }

  async initCredentials(
    id: string,
    input: { mailboxPassword?: string; ftpPassword?: string },
    meta?: ActionMeta,
  ): Promise<{ service: HostingServiceEntity; mailboxPassword: string; ftpPassword: string }> {
    const service = await this.get(id);
    const planName = service.planName ?? 'basic';
    const plan = await this.plans.findOne({ where: { name: planName } });
    if (!plan) {
      throw new BadRequestException(
        `Hosting plan '${planName}' not found for service ${service.id}`,
      );
    }
    const mailEnabled =
      Number(plan.maxMailboxes ?? 0) > 0 &&
      typeof process.env.NPANEL_MAIL_CMD === 'string' &&
      process.env.NPANEL_MAIL_CMD.length > 0;
    const ftpEnabled =
      Number(plan.maxFtpAccounts ?? 0) > 0 &&
      typeof process.env.NPANEL_FTP_CMD === 'string' &&
      process.env.NPANEL_FTP_CMD.length > 0;
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
    const username = this.deriveSystemUsername(service);
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
    const service = await this.get(id);
    if (service.status !== 'active') {
      return service;
    }
    const context = this.buildAdapterContext(service);
    const username = this.deriveSystemUsername(service);
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
    return saved;
  }

  async softDelete(id: string, meta?: ActionMeta): Promise<HostingServiceEntity> {
    const service = await this.get(id);
    if (service.status !== 'active') {
      throw new BadRequestException('Soft delete is only allowed for active services');
    }
    const context = this.buildAdapterContext(service);
    const username = this.deriveSystemUsername(service);

    await this.userAdapter.ensureSuspended(context, username);
    await this.webServerAdapter.ensureVhostSuspended(context, service.primaryDomain);

    const mailboxRotatePassword = this.credentials.generateMailboxPassword();
    const mysqlRotatePassword = this.credentials.generateDatabasePassword();
    const ftpRotatePassword = this.credentials.generateFtpPassword();
    const mysqlUsername = `${username}_db`;
    const mailboxes = await this.mailAdapter.listMailboxes(context, service.primaryDomain);
    for (const address of mailboxes) {
      if (typeof address === 'string' && address.endsWith(`@${service.primaryDomain}`)) {
        await this.mailAdapter.updatePassword(context, address, mailboxRotatePassword);
      }
    }
    await this.mysqlAdapter.resetPassword(context, mysqlUsername, mysqlRotatePassword);
    await this.ftpAdapter.resetPassword(context, username, ftpRotatePassword);

    const retentionHoursRaw = process.env.NPANEL_SOFT_DELETE_RETENTION_HOURS;
    const retentionHours =
      typeof retentionHoursRaw === 'string' && retentionHoursRaw.trim().length > 0
        ? Number.parseInt(retentionHoursRaw, 10)
        : 168;
    const hours = Number.isFinite(retentionHours) && retentionHours >= 1 ? retentionHours : 168;
    service.status = 'soft_deleted';
    service.softDeletedAt = new Date();
    service.hardDeleteEligibleAt = new Date(Date.now() + hours * 60 * 60 * 1000);
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
    return saved;
  }

  async restore(id: string, meta?: ActionMeta): Promise<HostingServiceEntity> {
    const service = await this.get(id);
    if (service.status !== 'soft_deleted') {
      throw new BadRequestException('Restore is only allowed for soft-deleted services');
    }
    const context = this.buildAdapterContext(service);
    const username = this.deriveSystemUsername(service);
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
    return saved;
  }

  async unsuspend(id: string, meta?: ActionMeta): Promise<HostingServiceEntity> {
    const service = await this.get(id);
    if (service.status !== 'suspended') {
      return service;
    }
    const context = this.buildAdapterContext(service);
    const username = this.deriveSystemUsername(service);
    await this.userAdapter.ensureResumed(context, username);
    // For web server, ensureVhostPresent (idempotent) re-creates the symlink if missing
    const plan = await this.plans.findOne({ where: { name: service.planName || 'basic' } });
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
    return saved;
  }

  async terminate(id: string): Promise<HostingServiceEntity> {
    throw new BadRequestException('Termination requires prepare and confirm');
  }

  async terminatePrepare(id: string, meta?: ActionMeta): Promise<{ token: string; service: HostingServiceEntity }> {
    const service = await this.get(id);
    if (service.status !== 'soft_deleted') {
      throw new BadRequestException('Hard delete requires soft delete first');
    }
    if (service.hardDeleteEligibleAt && service.hardDeleteEligibleAt.getTime() > Date.now()) {
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
    return { token, service: saved };
  }

  async terminateConfirm(
    id: string,
    token: string,
    opts?: { purge?: boolean; meta?: ActionMeta },
  ): Promise<HostingServiceEntity> {
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
        throw new BadRequestException('Hard delete blocked: backup snapshot failed');
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
      const mailboxes = await this.mailAdapter.listMailboxes(context, service.primaryDomain);
      for (const address of mailboxes) {
        if (typeof address === 'string' && address.includes('@')) {
          mailboxesToDelete.add(address);
        }
      }
    }
    for (const address of mailboxesToDelete) {
      await this.mailAdapter.ensureMailboxAbsent(context, address);
    }
    await this.webServerAdapter.ensureVhostAbsent(context, service.primaryDomain);
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
    return saved;
  }

  async terminateCancel(id: string, meta?: ActionMeta): Promise<HostingServiceEntity> {
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
    return saved;
  }

  async listMailboxes(id: string): Promise<string[]> {
    const service = await this.get(id);
    const context = this.buildAdapterContext(service);
    return this.mailAdapter.listMailboxes(context, service.primaryDomain);
  }

  async updateMailboxPassword(id: string, address: string, password: string): Promise<void> {
    const service = await this.get(id);
    if (service.status !== 'active') {
      throw new BadRequestException('Service is not active');
    }
    const context = this.buildAdapterContext(service);
    if (!address.endsWith(`@${service.primaryDomain}`)) {
      throw new BadRequestException(`Mailbox '${address}' does not belong to domain '${service.primaryDomain}'`);
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
    if (!/^[a-z0-9._-]+$/.test(localPart) || localPart.length < 1 || localPart.length > 64) {
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
    const mysqlUsername = `${this.deriveSystemUsername(service)}_db`;
    return this.mysqlAdapter.listDatabases(context, mysqlUsername);
  }

  async resetDatabasePassword(id: string, password: string): Promise<void> {
    const service = await this.get(id);
    if (service.status !== 'active') throw new BadRequestException('Service not active');
    const context = this.buildAdapterContext(service);
    const mysqlUsername = `${this.deriveSystemUsername(service)}_db`;
    await this.mysqlAdapter.resetPassword(context, mysqlUsername, password);
  }

  async getFtpCredentials(id: string): Promise<{ username: string; host: string }> {
    const service = await this.get(id);
    const username = this.deriveSystemUsername(service);
    const host = process.env.NPANEL_HOSTING_DEFAULT_IPV4 || '127.0.0.1';
    return { username, host };
  }

  async resetFtpPassword(id: string, password: string): Promise<void> {
    const service = await this.get(id);
    if (service.status !== 'active') throw new BadRequestException('Service not active');
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
        const safeEntry = {
          ...entry,
          details: entry.details ?? {},
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
        if (process.env.NPANEL_HOSTING_LOG !== 'json') {
          console.log('[hosting]', payload);
          return;
        }

        console.log(JSON.stringify(payload));
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
    const required: string[] = ['id', 'useradd', 'nginx', 'php-fpm', 'mysql'];
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
        const mailStatus = await this.tools.statusFor(process.env.NPANEL_MAIL_CMD);
        if (!mailStatus.available) missing.push('mail_cmd');
      }
    }
    if (opts?.requireFtp) {
      if (!process.env.NPANEL_FTP_CMD) {
        missing.push('ftp_cmd');
      } else {
        const ftpStatus = await this.tools.statusFor(process.env.NPANEL_FTP_CMD);
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
    const toolsPresent = !!(quotaStatus.available && quotaCheckStatus.available);

    // 2. Check mount options in /proc/mounts
    let mountOptions = false;
    try {
      const mounts = await fs.readFile('/proc/mounts', 'utf8');
      // Look for ext4/xfs with usrquota/grpquota on root or home
      if (
        /(\/|\/home)\s+\w+\s+.*(usrquota|grpquota|quota).*/.test(mounts)
      ) {
        mountOptions = true;
      }
    } catch (e) {
      console.warn(`Failed to read /proc/mounts: ${e instanceof Error ? e.message : e}`);
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
