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
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

  async create(input: CreateHostingServiceDto): Promise<HostingServiceEntity | { service: HostingServiceEntity; credentials: { username: string; mysqlUsername: string; mysqlPassword: string; mailboxPassword: string; ftpPassword: string } }> {
    const planName = input.planName ?? 'basic';
    const plan = await this.plans.findOne({ where: { name: planName } });
    if (!plan) {
      throw new BadRequestException(`Hosting plan '${planName}' not found`);
    }
    const existsForDomain = await this.services.findOne({ where: { primaryDomain: input.primaryDomain } });
    if (existsForDomain) {
      throw new BadRequestException(`Hosting service for domain '${input.primaryDomain}' already exists`);
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
    });
    const saved = await this.services.save(entity);
    if (input.autoProvision === true) {
      const readiness = await this.checkToolReadinessForProvision();
      if (readiness.missing.length > 0) {
        throw new BadRequestException(`Auto-provision blocked; missing tools: ${readiness.missing.join(', ')}`);
      }
      const provisioned = await this.provisionWithCredentials(saved.id);
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

  async provision(id: string): Promise<HostingServiceEntity> {
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
      return service;
    }

    const planName = service.planName ?? 'basic';
    const plan = await this.plans.findOne({ where: { name: planName } });
    if (!plan) {
      throw new BadRequestException(
        `Hosting plan '${planName}' not found for service ${service.id}`,
      );
    }

    // Minimal validation of plan constraints for initial provisioning
    if (plan.maxMailboxes === 0) {
      throw new BadRequestException(
        `Plan '${plan.name}' does not allow mailboxes (limit: ${plan.maxMailboxes})`,
      );
    }
    if (plan.maxFtpAccounts === 0) {
      throw new BadRequestException(
        `Plan '${plan.name}' does not allow FTP accounts (limit: ${plan.maxFtpAccounts})`,
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
    const documentRoot = `${homeDirectory}/public_html`;
    const phpPoolName = username;
    const mysqlUsername = `${username}_db`;
    const mysqlPassword = this.credentials.generateDatabasePassword();
    const mailboxPassword = this.credentials.generateMailboxPassword();
    const ftpPassword = this.credentials.generateFtpPassword();
    const traceId = context.traceId ?? null;
    const rollbackFns: Array<() => Promise<void>> = [];
    const registerRollback = (fn?: () => Promise<void>) => {
      if (fn) {
        rollbackFns.push(fn);
      }
    };
    try {
      service.status = 'provisioning';
      await this.services.save(service);
      const userResult = await this.userAdapter.ensurePresent(context, {
        username,
        homeDirectory,
        primaryGroup: username,
        shell: '/bin/bash',
        quotaMb: plan.diskQuotaMb,
      });
      registerRollback(userResult.rollback);
      const phpResult = await this.phpFpmAdapter.ensurePoolPresent(context, {
        name: phpPoolName,
        user: username,
        group: username,
        listen: `/run/php-fpm-${username}.sock`,
        phpVersion: plan.phpVersion,
      });
      registerRollback(phpResult.rollback);
      const webResult = await this.webServerAdapter.ensureVhostPresent(
        context,
        {
          domain: service.primaryDomain,
          documentRoot,
          phpFpmPool: phpPoolName,
          sslCertificateId: null,
        },
      );
      registerRollback(webResult.rollback);
      const mysqlResult = await this.mysqlAdapter.ensureAccountPresent(
        context,
        {
          username: mysqlUsername,
          password: mysqlPassword,
          databases: [],
        },
      );
      registerRollback(mysqlResult.rollback);
      const dnsRecords = this.buildDefaultDnsRecords(service.primaryDomain);
      const dnsResult = await this.dnsAdapter.ensureZonePresent(context, {
        zoneName: service.primaryDomain,
        records: dnsRecords,
      });
      registerRollback(dnsResult.rollback);
      const mailResult = await this.mailAdapter.ensureMailboxPresent(context, {
        address: `postmaster@${service.primaryDomain}`,
        password: mailboxPassword,
        quotaMb: plan.mailboxQuotaMb,
      });
      registerRollback(mailResult.rollback);
      const ftpResult = await this.ftpAdapter.ensureAccountPresent(context, {
        username,
        password: ftpPassword,
        homeDirectory,
      });
      registerRollback(ftpResult.rollback);
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
        },
        errorMessage: null,
      });
      return saved;
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

  async provisionWithCredentials(id: string): Promise<{
    service: HostingServiceEntity;
    credentials: {
      username: string;
      mysqlUsername: string;
      mysqlPassword: string;
      mailboxPassword: string;
      ftpPassword: string;
    };
  }> {
    const service = await this.get(id);
    const planName = service.planName ?? 'basic';
    const plan = await this.plans.findOne({ where: { name: planName } });
    if (!plan) {
      throw new BadRequestException(
        `Hosting plan '${planName}' not found for service ${service.id}`,
      );
    }
    // Delegate to provision logic but capture credentials
    const context = this.buildAdapterContext(service);
    const username = this.deriveSystemUsername(service);
    const homeDirectory = `/home/${username}`;
    const documentRoot = `${homeDirectory}/public_html`;
    const phpPoolName = username;
    const mysqlUsername = `${username}_db`;
    const mysqlPassword = this.credentials.generateDatabasePassword();
    const mailboxPassword = this.credentials.generateMailboxPassword();
    const ftpPassword = this.credentials.generateFtpPassword();
    await this.userAdapter.ensurePresent(context, {
      username,
      homeDirectory,
      primaryGroup: username,
      shell: '/bin/bash',
      quotaMb: plan.diskQuotaMb,
    });
    await this.phpFpmAdapter.ensurePoolPresent(context, {
      name: phpPoolName,
      user: username,
      group: username,
      listen: `/run/php-fpm-${username}.sock`,
      phpVersion: plan.phpVersion,
    });
    await this.webServerAdapter.ensureVhostPresent(context, {
      domain: service.primaryDomain,
      documentRoot,
      phpFpmPool: phpPoolName,
      sslCertificateId: null,
    });
    await this.mysqlAdapter.ensureAccountPresent(context, {
      username: mysqlUsername,
      password: mysqlPassword,
      databases: [],
    });
    const dnsRecords = this.buildDefaultDnsRecords(service.primaryDomain);
    await this.dnsAdapter.ensureZonePresent(context, {
      zoneName: service.primaryDomain,
      records: dnsRecords,
    });
    await this.mailAdapter.ensureMailboxPresent(context, {
      address: `postmaster@${service.primaryDomain}`,
      password: mailboxPassword,
      quotaMb: plan.mailboxQuotaMb,
    });
    await this.ftpAdapter.ensureAccountPresent(context, {
      username,
      password: ftpPassword,
      homeDirectory,
    });
    service.status = 'active';
    const saved = await this.services.save(service);
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
  }

  async initCredentials(
    id: string,
    input: { mailboxPassword?: string; ftpPassword?: string },
  ): Promise<{ service: HostingServiceEntity; mailboxPassword: string; ftpPassword: string }> {
    const service = await this.get(id);
    const readiness = await this.checkToolReadinessForProvision();
    const missingMail = readiness.missing.includes('mail_cmd');
    const missingFtp = readiness.missing.includes('ftp_cmd');
    if (missingMail || missingFtp) {
      throw new BadRequestException(
        `Cannot set credentials; missing tools: ${[missingMail ? 'mail_cmd' : null, missingFtp ? 'ftp_cmd' : null]
          .filter(Boolean)
          .join(', ')}`,
      );
    }
    const context = this.buildAdapterContext(service);
    const username = this.deriveSystemUsername(service);
    const mailboxPassword = input.mailboxPassword || this.credentials.generateMailboxPassword();
    const ftpPassword = input.ftpPassword || this.credentials.generateFtpPassword();
    await this.mailAdapter.ensureMailboxPresent(context, {
      address: `postmaster@${service.primaryDomain}`,
      password: mailboxPassword,
      quotaMb: null,
    });
    await this.ftpAdapter.ensureAccountPresent(context, {
      username,
      password: ftpPassword,
      homeDirectory: `/home/${username}`,
    });
    return { service, mailboxPassword, ftpPassword };
  }

  async suspend(id: string): Promise<HostingServiceEntity> {
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
      },
      errorMessage: null,
    });
    return saved;
  }

  async unsuspend(id: string): Promise<HostingServiceEntity> {
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
      },
      errorMessage: null,
    });
    return saved;
  }

  async terminate(id: string): Promise<HostingServiceEntity> {
    throw new BadRequestException('Termination requires prepare and confirm');
  }

  async terminatePrepare(id: string): Promise<{ token: string; service: HostingServiceEntity }> {
    const service = await this.get(id);
    if (service.status === 'terminated') {
      throw new BadRequestException('Service already terminated');
    }
    service.status = 'termination_pending';
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
      details: { action: 'termination_prepare' },
      errorMessage: null,
    });
    return { token, service: saved };
  }

  async terminateConfirm(
    id: string,
    token: string,
    opts?: { purge?: boolean },
  ): Promise<HostingServiceEntity> {
    const service = await this.get(id);
    if (service.status !== 'termination_pending') {
      throw new BadRequestException('Termination is not pending');
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
      details: { action: 'terminate', homeDirectory },
      errorMessage: null,
    });
    service.status = 'terminated';
    service.terminationToken = null;
    service.terminationTokenExpiresAt = null;
    const saved = await this.services.save(service);
    if (purge) {
      await this.logs.delete({ serviceId: service.id } as any);
      await this.services.delete({ id: service.id } as any);
    }
    return saved;
  }

  async terminateCancel(id: string): Promise<HostingServiceEntity> {
    const service = await this.get(id);
    if (service.status !== 'termination_pending') {
      return service;
    }
    service.status = 'active';
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
      details: { action: 'termination_cancel' },
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

  private async checkToolReadinessForProvision(): Promise<{
    missing: string[];
    quotaStatus?: {
      tools_present: boolean;
      mount_options: boolean;
      kernel_support: boolean;
      enabled: boolean;
    };
  }> {
    const required: string[] = ['useradd', 'nginx', 'php-fpm', 'mysql'];
    const missing: string[] = [];
    for (const name of required) {
      const status = await this.tools.statusFor(name);
      if (!status.available) {
        missing.push(name);
      }
    }
    if (!process.env.NPANEL_MAIL_CMD) {
      missing.push('mail_cmd');
    } else {
      const mailStatus = await this.tools.statusFor(process.env.NPANEL_MAIL_CMD);
      if (!mailStatus.available) missing.push('mail_cmd');
    }
    if (!process.env.NPANEL_FTP_CMD) {
      missing.push('ftp_cmd');
    } else {
      const ftpStatus = await this.tools.statusFor(process.env.NPANEL_FTP_CMD);
      if (!ftpStatus.available) missing.push('ftp_cmd');
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
