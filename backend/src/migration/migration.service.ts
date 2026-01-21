import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MigrationJob } from './migration-job.entity';
import { MigrationAccount } from './migration-account.entity';
import { MigrationStep } from './migration-step.entity';
import { MigrationLog } from './migration-log.entity';
import { CreateMigrationJobDto } from './dto/create-migration-job.dto';
import { AddMigrationAccountDto } from './dto/add-migration-account.dto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ToolResolver, ToolNotFoundError } from '../system/tool-resolver';
import { HostingService } from '../hosting/hosting.service';
import { buildSafeExecEnv } from '../system/exec-env';
import { encryptString, decryptString } from '../system/secretbox';

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(
    @InjectRepository(MigrationJob)
    private readonly jobs: Repository<MigrationJob>,
    @InjectRepository(MigrationAccount)
    private readonly accounts: Repository<MigrationAccount>,
    @InjectRepository(MigrationStep)
    private readonly steps: Repository<MigrationStep>,
    @InjectRepository(MigrationLog)
    private readonly logs: Repository<MigrationLog>,
    private readonly tools: ToolResolver,
    private readonly hosting: HostingService,
  ) {}

  async sourcePreflight(sourceConfig: Record<string, unknown>) {
    const host =
      typeof sourceConfig['host'] === 'string' ? sourceConfig['host'] : '';
    const sshUser =
      typeof sourceConfig['sshUser'] === 'string'
        ? sourceConfig['sshUser']
        : '';
    const sshPortValue = sourceConfig['sshPort'];
    const sshPort =
      typeof sshPortValue === 'number' && Number.isInteger(sshPortValue)
        ? sshPortValue
        : typeof sshPortValue === 'string' && /^\d+$/.test(sshPortValue)
          ? Number.parseInt(sshPortValue, 10)
          : 22;
    const authMethod =
      typeof sourceConfig['authMethod'] === 'string'
        ? sourceConfig['authMethod']
        : 'system';
    if (!host || !sshUser) {
      throw new BadRequestException('missing_source_connection_fields');
    }

    const checks: Array<{
      name: string;
      status: 'PASS' | 'FAIL' | 'WARN';
      details?: Record<string, unknown> | null;
    }> = [];

    const sshPath = await this.tools.resolve('ssh', {
      packageHint: 'openssh-client',
    });
    checks.push({
      name: 'ssh_client_present',
      status: 'PASS',
      details: { sshPath },
    });

    const versionRes = await this.execTool(sshPath, ['-V']).catch((e) => ({
      code: 1,
      stdout: '',
      stderr: e instanceof Error ? e.message : String(e),
    }));
    checks.push({
      name: 'ssh_client_version',
      status: versionRes.code === 0 ? 'PASS' : 'WARN',
      details: { stderr: versionRes.stderr?.trim?.() ?? '' },
    });

    const pingRes = await this.execSshCommand(
      { ...sourceConfig, host, sshUser, sshPort, authMethod },
      'echo npanel_ok',
      { strictHostKey: false, connectTimeoutSeconds: 8 },
    );
    checks.push({
      name: 'ssh_connectivity',
      status:
        pingRes.code === 0 && pingRes.stdout.includes('npanel_ok')
          ? 'PASS'
          : 'FAIL',
      details:
        pingRes.code === 0
          ? { stdout: pingRes.stdout.trim() }
          : { code: pingRes.code, stderr: pingRes.stderr.trim() },
    });

    const cpanelVersionRes =
      pingRes.code === 0
        ? await this.execSshCommand(
            { ...sourceConfig, host, sshUser, sshPort, authMethod },
            'test -f /usr/local/cpanel/version && cat /usr/local/cpanel/version || echo no_cpanel_version_file',
            { strictHostKey: false, connectTimeoutSeconds: 8 },
          )
        : { code: 1, stdout: '', stderr: 'ssh_unreachable' };
    const cpanelVersion =
      cpanelVersionRes.code === 0 ? cpanelVersionRes.stdout.trim() : '';
    checks.push({
      name: 'cpanel_detect',
      status:
        cpanelVersion && cpanelVersion !== 'no_cpanel_version_file'
          ? 'PASS'
          : 'FAIL',
      details:
        cpanelVersion && cpanelVersion !== 'no_cpanel_version_file'
          ? { version: cpanelVersion }
          : { hint: 'cPanel not detected on source host' },
    });

    const whmapiRes =
      pingRes.code === 0
        ? await this.execSshCommand(
            { ...sourceConfig, host, sshUser, sshPort, authMethod },
            'test -x /usr/local/cpanel/bin/whmapi1 && echo whmapi1_ok || echo whmapi1_missing',
            { strictHostKey: false, connectTimeoutSeconds: 8 },
          )
        : { code: 1, stdout: '', stderr: 'ssh_unreachable' };
    checks.push({
      name: 'whmapi1_present',
      status:
        whmapiRes.code === 0 && whmapiRes.stdout.includes('whmapi1_ok')
          ? 'PASS'
          : 'FAIL',
      details:
        whmapiRes.code === 0
          ? { stdout: whmapiRes.stdout.trim() }
          : { code: whmapiRes.code, stderr: whmapiRes.stderr.trim() },
    });

    const ok = checks.every((c) => c.status !== 'FAIL');
    return {
      ok,
      source: {
        host,
        sshPort,
        sshUser,
        authMethod,
      },
      panel: {
        type: 'cpanel',
        version:
          cpanelVersion && cpanelVersion !== 'no_cpanel_version_file'
            ? cpanelVersion
            : null,
      },
      checks,
    };
  }

  async discoverSourceAccounts(sourceConfig: Record<string, unknown>) {
    const host =
      typeof sourceConfig['host'] === 'string' ? sourceConfig['host'] : '';
    const sshUser =
      typeof sourceConfig['sshUser'] === 'string'
        ? sourceConfig['sshUser']
        : '';
    const sshPortValue = sourceConfig['sshPort'];
    const sshPort =
      typeof sshPortValue === 'number' && Number.isInteger(sshPortValue)
        ? sshPortValue
        : typeof sshPortValue === 'string' && /^\d+$/.test(sshPortValue)
          ? Number.parseInt(sshPortValue, 10)
          : 22;
    const authMethod =
      typeof sourceConfig['authMethod'] === 'string'
        ? sourceConfig['authMethod']
        : 'system';
    if (!host || !sshUser) {
      throw new BadRequestException('missing_source_connection_fields');
    }

    const listRes = await this.execSshCommand(
      { ...sourceConfig, host, sshUser, sshPort, authMethod },
      '/usr/local/cpanel/bin/whmapi1 listaccts --output=json',
      { strictHostKey: false, connectTimeoutSeconds: 12 },
    );
    if (listRes.code !== 0) {
      const err = new Error('source_account_discovery_failed') as Error & {
        details?: unknown;
      };
      err.details = {
        code: listRes.code,
        stderr: listRes.stderr,
        stdout: listRes.stdout,
      };
      throw err;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(listRes.stdout);
    } catch {
      const err = new Error(
        'source_account_discovery_invalid_json',
      ) as Error & { details?: unknown };
      err.details = { sample: listRes.stdout.slice(0, 500) };
      throw err;
    }
    const acctList: any[] = Array.isArray(parsed?.data?.acct)
      ? parsed.data.acct
      : [];
    const accounts = acctList
      .map((acct) => {
        const username = typeof acct?.user === 'string' ? acct.user : '';
        const primaryDomain =
          typeof acct?.domain === 'string' ? acct.domain : '';
        const plan = typeof acct?.plan === 'string' ? acct.plan : null;
        const suspendedRaw = acct?.suspended;
        const suspended =
          suspendedRaw === 1 || suspendedRaw === '1' || suspendedRaw === true;
        const diskUsedRaw = acct?.diskused;
        const diskUsageMb =
          typeof diskUsedRaw === 'number'
            ? diskUsedRaw
            : typeof diskUsedRaw === 'string'
              ? Number.parseFloat(diskUsedRaw)
              : null;
        return {
          username,
          primaryDomain,
          plan,
          status: suspended ? 'suspended' : 'active',
          diskUsageMb: Number.isFinite(diskUsageMb as any)
            ? (diskUsageMb as number)
            : null,
        };
      })
      .filter((a) => a.username && a.primaryDomain);

    const existing = await this.hosting.list();
    const existingDomains = new Set(existing.map((s) => s.primaryDomain));
    const enriched = accounts.map((a) => ({
      ...a,
      conflicts: {
        domainExists: existingDomains.has(a.primaryDomain),
      },
    }));

    return {
      source: { host, sshPort, sshUser, authMethod },
      accounts: enriched,
      totals: {
        count: enriched.length,
        selectedBytesEstimate: null,
      },
      conflictsSummary: {
        domainConflicts: enriched.filter((a) => a.conflicts.domainExists)
          .length,
      },
    };
  }

  async createJob(input: CreateMigrationJobDto): Promise<MigrationJob> {
    const job = this.jobs.create({
      customerId: null,
      name: input.name,
      sourceType: input.sourceType,
      status: 'pending',
      sourceConfig: input.sourceConfig
        ? encryptString(JSON.stringify(input.sourceConfig))
        : null,
      dryRun: input.dryRun ?? false,
    });
    const saved = await this.jobs.save(job);
    await this.appendLog(saved, null, 'info', 'job_created', {
      sourceType: saved.sourceType,
      dryRun: saved.dryRun,
    });
    return saved;
  }

  async createJobWithAccounts(
    input: CreateMigrationJobDto,
    accounts: AddMigrationAccountDto[],
  ) {
    const job = await this.createJob(input);
    const created: MigrationAccount[] = [];
    for (const account of accounts) {
      created.push(await this.addAccount(job.id, account));
    }
    return { job, accounts: created };
  }

  async createJobForCustomer(
    customerId: string,
    input: CreateMigrationJobDto,
  ): Promise<MigrationJob> {
    const job = this.jobs.create({
      customerId,
      name: input.name,
      sourceType: input.sourceType,
      status: 'pending',
      sourceConfig: input.sourceConfig
        ? encryptString(JSON.stringify(input.sourceConfig))
        : null,
      dryRun: input.dryRun ?? false,
    });
    const saved = await this.jobs.save(job);
    await this.appendLog(saved, null, 'info', 'job_created', {
      sourceType: saved.sourceType,
      dryRun: saved.dryRun,
    });
    return saved;
  }

  async listJobs(): Promise<MigrationJob[]> {
    const items = await this.jobs.find({
      order: { createdAt: 'DESC' },
    });
    items.forEach((j) => this.hydrateDecryptedConfig(j));
    return items;
  }

  async listJobsForCustomer(customerId: string): Promise<MigrationJob[]> {
    const items = await this.jobs.find({
      where: { customerId },
      order: { createdAt: 'DESC' },
    });
    items.forEach((j) => this.hydrateDecryptedConfig(j));
    return items;
  }

  async getJob(id: string): Promise<MigrationJob> {
    const job = await this.jobs.findOne({
      where: { id },
      relations: ['accounts', 'steps'],
    });
    if (!job) {
      throw new NotFoundException('Migration job not found');
    }
    this.hydrateDecryptedConfig(job);
    return job;
  }

  async getJobForCustomer(
    customerId: string,
    id: string,
  ): Promise<MigrationJob> {
    const job = await this.jobs.findOne({
      where: { id, customerId },
      relations: ['accounts', 'steps'],
    });
    if (!job) {
      throw new NotFoundException('Migration job not found');
    }
    this.hydrateDecryptedConfig(job);
    return job;
  }

  async addAccount(
    jobId: string,
    input: AddMigrationAccountDto,
  ): Promise<MigrationAccount> {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('Migration job not found');
    }
    const account = this.accounts.create({
      job,
      sourceUsername: input.sourceUsername,
      sourcePrimaryDomain: input.sourcePrimaryDomain,
      targetCustomerId: input.targetCustomerId ?? null,
      targetServiceId: input.targetServiceId ?? null,
    });
    const saved = await this.accounts.save(account);
    await this.appendLog(job, saved, 'info', 'account_added', {
      sourceUsername: saved.sourceUsername,
      sourcePrimaryDomain: saved.sourcePrimaryDomain,
    });
    return saved;
  }

  async listSteps(jobId: string): Promise<MigrationStep[]> {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('Migration job not found');
    }
    return this.steps.find({
      where: { job: { id: job.id } },
      relations: ['account'],
      order: { createdAt: 'ASC' },
    });
  }

  async listStepsForCustomer(
    customerId: string,
    jobId: string,
  ): Promise<MigrationStep[]> {
    await this.getJobForCustomer(customerId, jobId);
    return this.steps.find({
      where: { job: { id: jobId } },
      relations: ['account'],
      order: { createdAt: 'ASC' },
    });
  }

  async planJob(jobId: string): Promise<MigrationStep[]> {
    const job = await this.jobs.findOne({
      where: { id: jobId },
      relations: ['accounts', 'steps'],
    });
    if (!job) {
      throw new NotFoundException('Migration job not found');
    }
    if (job.steps && job.steps.length > 0) {
      return this.steps.find({
        where: { job: { id: job.id } },
        relations: ['account'],
        order: { createdAt: 'ASC' },
      });
    }
    if (job.sourceType === 'cpanel_live_ssh') {
      const steps = await this.planLiveSshJob(job);
      await this.appendLog(job, null, 'info', 'steps_planned', {
        sourceType: job.sourceType,
        stepCount: steps.length,
      });
      return steps;
    }
    throw new BadRequestException(
      'Planning not implemented for this source type',
    );
  }

  async planJobForCustomer(
    customerId: string,
    jobId: string,
  ): Promise<MigrationStep[]> {
    await this.getJobForCustomer(customerId, jobId);
    return this.planJob(jobId);
  }

  async startBackgroundMigration(jobId: string): Promise<void> {
    const job = await this.jobs.findOne({
      where: { id: jobId },
      relations: ['accounts', 'steps'],
    });
    if (!job) {
      throw new NotFoundException('Migration job not found');
    }

    // If job is already running, do nothing (or maybe restart if stuck?)
    // For now, assume we just want to kick it off.
    if (job.status === 'running') {
      return;
    }

    // Ensure steps are planned
    if (!job.steps || job.steps.length === 0) {
      await this.planJob(job.id);
    }

    // Mark as running immediately
    job.status = 'running';
    await this.jobs.save(job);

    // Start the processing loop in background (no await)
    this.processJobLoop(job.id).catch((err) => {
      this.logger.error(`Background migration failed for job ${jobId}: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private async processJobLoop(jobId: string): Promise<void> {
    // Loop until no more steps or failure
    while (true) {
      const result = await this.runNextStep(jobId);
      if (
        result.job.status === 'completed' ||
        result.job.status === 'failed' ||
        result.job.status === 'partial'
      ) {
        break;
      }
      // If step is null but status is running, it might mean waiting or inconsistency.
      // refreshJobStatus inside runNextStep handles status updates.
      if (!result.step && result.job.status === 'running') {
        // No pending step found but job thinks it is running.
        // Maybe we need to break to avoid infinite loop?
        // runNextStep calls refreshJobStatus. If no pending steps, it sets to completed/failed.
        // So we should be fine.
        break;
      }
    }
  }

  async runNextStep(jobId: string): Promise<{
    job: MigrationJob;
    step: MigrationStep | null;
  }> {
    const job = await this.jobs.findOne({
      where: { id: jobId },
      relations: ['accounts', 'steps'],
    });
    if (!job) {
      throw new NotFoundException('Migration job not found');
    }
    if (
      job.status === 'completed' ||
      job.status === 'failed' ||
      job.status === 'partial'
    ) {
      return {
        job,
        step: null,
      };
    }
    if (!job.steps || job.steps.length === 0) {
      await this.planJob(job.id);
    }
    job.status = 'running';
    await this.jobs.save(job);
    let step = await this.steps.findOne({
      where: { job: { id: job.id }, status: 'pending' },
      order: { createdAt: 'ASC' },
      relations: ['account', 'job'],
    });
    if (!step) {
      await this.refreshJobStatus(job);
      const refreshed = await this.jobs.findOne({ where: { id: job.id } });
      return {
        job: refreshed ?? job,
        step: null,
      };
    }
    step.status = 'running';
    step.lastError = null;
    step = await this.steps.save(step);
    await this.appendLog(job, step.account, 'info', 'step_started', {
      stepId: step.id,
      name: step.name,
    });
    try {
      await this.handleStep(step, job);
      step.status = 'completed';
      step = await this.steps.save(step);
      await this.appendLog(job, step.account, 'info', 'step_completed', {
        stepId: step.id,
        name: step.name,
      });
    } catch (error) {
      step.status = 'failed';
      const withDetails = error as {
        message?: string;
        details?: unknown;
      };
      step.lastError = {
        message: withDetails.message ?? (error as Error).message,
        details: withDetails.details ?? null,
      };
      step = await this.steps.save(step);
      await this.appendLog(job, step.account, 'error', 'step_failed', {
        stepId: step.id,
        name: step.name,
      });
    }
    await this.refreshJobStatus(job);
    const refreshed = await this.jobs.findOne({ where: { id: job.id } });
    return {
      job: refreshed ?? job,
      step,
    };
  }

  async runNextStepForCustomer(
    customerId: string,
    jobId: string,
  ): Promise<{
    job: MigrationJob;
    step: MigrationStep | null;
  }> {
    await this.getJobForCustomer(customerId, jobId);
    return this.runNextStep(jobId);
  }

  async listLogs(jobId: string): Promise<MigrationLog[]> {
    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('Migration job not found');
    }
    return this.logs.find({
      where: { job: { id: job.id } },
      relations: ['account'],
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  async listLogsForCustomer(
    customerId: string,
    jobId: string,
  ): Promise<MigrationLog[]> {
    await this.getJobForCustomer(customerId, jobId);
    return this.logs.find({
      where: { job: { id: jobId } },
      relations: ['account'],
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  private hydrateDecryptedConfig(job: MigrationJob): void {
    if (job.sourceConfig) {
      try {
        const plain = decryptString(job.sourceConfig);
        (job as any).sourceConfig = JSON.parse(plain);
      } catch {
        (job as any).sourceConfig = {};
      }
    } else {
      (job as any).sourceConfig = {};
    }
  }

  private getDecryptedConfig(job: MigrationJob): Record<string, unknown> {
    const raw = (job as any).sourceConfig;
    if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
    if (typeof job.sourceConfig === 'string' && job.sourceConfig.length > 0) {
      try {
        const plain = decryptString(job.sourceConfig);
        return JSON.parse(plain);
      } catch {
        return {};
      }
    }
    return {};
  }

  private async planLiveSshJob(job: MigrationJob): Promise<MigrationStep[]> {
    if (!job.accounts || job.accounts.length === 0) {
      throw new BadRequestException(
        'At least one account is required to plan migration',
      );
    }
    const initialSteps: MigrationStep[] = [];
    const validateStep = this.steps.create({
      job,
      account: null,
      name: 'validate_source_host',
      status: 'pending',
      payload: null,
      lastError: null,
    });
    initialSteps.push(validateStep);
    for (const account of job.accounts) {
      const sourcePath = this.resolveSourceHomePath(job, account);
      const targetPath = this.resolveTargetHomePath(job, account);
      const provisionStep = this.steps.create({
        job,
        account,
        name: 'provision_target_env',
        status: 'pending',
        payload: null,
        lastError: null,
      });
      initialSteps.push(provisionStep);
      const step = this.steps.create({
        job,
        account,
        name: 'rsync_home_directory',
        status: 'pending',
        payload: {
          sourcePath,
          targetPath,
        },
        lastError: null,
      });
      initialSteps.push(step);
      const dbStep = this.steps.create({
        job,
        account,
        name: 'import_databases',
        status: 'pending',
        payload: null,
        lastError: null,
      });
      initialSteps.push(dbStep);
    }
    await this.steps.save(initialSteps);
    return this.steps.find({
      where: { job: { id: job.id } },
      relations: ['account'],
      order: { createdAt: 'ASC' },
    });
  }

  private resolveSourceHomePath(
    job: MigrationJob,
    account: MigrationAccount,
  ): string {
    const config = this.getDecryptedConfig(job);
    const homeRootValue = config['cpanelHome'];
    const homeRoot =
      typeof homeRootValue === 'string' && homeRootValue.length > 0
        ? homeRootValue
        : '/home';
    const trimmed = homeRoot.endsWith('/') ? homeRoot.slice(0, -1) : homeRoot;
    return `${trimmed}/${account.sourceUsername}`;
  }

  private resolveTargetHomePath(
    job: MigrationJob,
    account: MigrationAccount,
  ): string {
    const config = this.getDecryptedConfig(job);
    const rootValue = config['targetRoot'];
    const root =
      typeof rootValue === 'string' && rootValue.length > 0
        ? rootValue
        : process.env.NPANEL_MIGRATION_TARGET_ROOT || '/srv/npanel/migrations';
    const trimmed = root.endsWith('/') ? root.slice(0, -1) : root;
    return `${trimmed}/${job.id}/${account.sourceUsername}`;
  }

  private async handleStep(
    step: MigrationStep,
    job: MigrationJob,
  ): Promise<void> {
    if (step.name === 'validate_source_host') {
      this.handleValidateSourceHost(job);
      return;
    }
    if (step.name === 'provision_target_env') {
      await this.handleProvisionTargetEnv(step, job);
      return;
    }
    if (step.name === 'rsync_home_directory') {
      await this.handleRsyncHome(step, job);
      return;
    }
    if (step.name === 'import_databases') {
      await this.handleImportDatabases(step, job);
      return;
    }
    step.status = 'skipped';
    await this.steps.save(step);
  }

  private handleValidateSourceHost(job: MigrationJob): void {
    const config = this.getDecryptedConfig(job);
    const hostValue = config['host'];
    const sshUserValue = config['sshUser'];
    if (typeof hostValue !== 'string' || hostValue.length === 0) {
      throw new Error('Missing host in sourceConfig');
    }
    if (typeof sshUserValue !== 'string' || sshUserValue.length === 0) {
      throw new Error('Missing sshUser in sourceConfig');
    }
  }

  private async handleProvisionTargetEnv(
    step: MigrationStep,
    job: MigrationJob,
  ): Promise<void> {
    const account = step.account;
    if (!account) {
      throw new Error('Provision step requires an account');
    }
    const config = this.getDecryptedConfig(job);
    const planLimits = config['planLimits'] as
      | Record<string, unknown>
      | undefined;
    const planNameValue = config['planName'] as string | undefined;
    let planName =
      typeof planNameValue === 'string' && planNameValue.length > 0
        ? planNameValue
        : 'basic';
    if (!planNameValue && planLimits) {
      const stable = JSON.stringify({
        diskQuotaMb: planLimits['diskQuotaMb'],
        maxDatabases: planLimits['maxDatabases'],
        maxMailboxes: planLimits['maxMailboxes'],
        maxFtpAccounts: planLimits['maxFtpAccounts'],
        phpVersion: planLimits['phpVersion'],
      });
      const hash = Buffer.from(stable).toString('hex').slice(0, 12);
      planName = `imported_${hash}`;
      const plans = await this.hosting.listPlans();
      const exists = plans.find((p) => p.name === planName);
      if (!exists) {
        await this.hosting.createPlan({
          name: planName,
          diskQuotaMb: Number(planLimits['diskQuotaMb'] ?? 1024),
          maxDatabases: Number(planLimits['maxDatabases'] ?? 1),
          phpVersion: String(planLimits['phpVersion'] ?? '8.2'),
          mailboxQuotaMb: Number(planLimits['mailboxQuotaMb'] ?? 1024),
          maxMailboxes: Number(planLimits['maxMailboxes'] ?? 1),
          maxFtpAccounts: Number(planLimits['maxFtpAccounts'] ?? 1),
        });
      }
    }
    let serviceId = account.targetServiceId ?? null;
    if (!serviceId) {
      if (!account.targetCustomerId) {
        throw new Error('Missing targetCustomerId for account');
      }
      const created = await this.hosting.create({
        customerId: account.targetCustomerId,
        primaryDomain: account.sourcePrimaryDomain,
        planName,
      } as any);
      serviceId = (created as any).id ?? (created as any).service?.id ?? null;
      account.targetServiceId = serviceId;
      account.metadata = {
        ...(account.metadata ?? {}),
        sourceUsername: account.sourceUsername,
        sourcePackageName: planNameValue ?? null,
        addonDomains: Array.isArray(config['addonDomains'])
          ? config['addonDomains']
          : [],
        notes: ['Mailbox passwords reset during migration'],
      };
      await this.accounts.save(account);
    }
    if (!serviceId) {
      throw new Error('Failed to create target service for migration');
    }
    await this.hosting.provision(serviceId);
  }

  private async handleImportDatabases(
    step: MigrationStep,
    job: MigrationJob,
  ): Promise<void> {
    const account = step.account;
    if (!account || !account.targetServiceId) {
      return;
    }
    const service = await this.hosting.get(account.targetServiceId);
    const plans = await this.hosting.listPlans();
    const plan = plans.find((p) => p.name === (service.planName || 'basic'));
    const maxDbs = Number(plan?.maxDatabases ?? 0);
    const config = this.getDecryptedConfig(job);
    const dumps = Array.isArray((config as any)['dbDumps'])
      ? ((config as any)['dbDumps'] as Array<{ name: string; path: string }>)
      : [];
    if (dumps.length === 0) {
      return;
    }
    if (maxDbs > 0 && dumps.length > maxDbs) {
      const errorWithDetails = new Error('database_limit_exceeded') as Error & {
        details?: unknown;
      };
      errorWithDetails.details = { maxDbs, requested: dumps.length };
      throw errorWithDetails;
    }
    const mysqlUsername =
      service.mysqlUsername || `${service.systemUsername || 'u_site'}_db`;
    const mysqlPasswordEnc = (service as any).mysqlPasswordEnc as string | null;
    const mysqlPassword = mysqlPasswordEnc
      ? decryptString(mysqlPasswordEnc)
      : '';
    const mysqlBin = process.env.NPANEL_MYSQL_CMD || 'mysql';
    const mysqlPath = await this.tools.resolve(mysqlBin, {
      packageHint: 'mysql client',
    });
    for (const dump of dumps) {
      const dbName = dump.name;
      const createSql = `CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`;
      const createResult = await this.execTool(mysqlPath, [
        '-u',
        mysqlUsername,
        '-p' + mysqlPassword,
        '-e',
        createSql,
      ]);
      if (createResult.code !== 0) {
        const errorWithDetails = new Error('db_create_failed') as Error & {
          details?: unknown;
        };
        errorWithDetails.details = createResult;
        throw errorWithDetails;
      }
      const importResult = await this.execTool(mysqlPath, [
        '-u',
        mysqlUsername,
        '-p' + mysqlPassword,
        dbName,
        '-e',
        `source ${dump.path}`,
      ]);
      if (importResult.code !== 0) {
        const errorWithDetails = new Error('db_import_failed') as Error & {
          details?: unknown;
        };
        errorWithDetails.details = importResult;
        throw errorWithDetails;
      }
      const grantSql = `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${mysqlUsername}'@'localhost'; FLUSH PRIVILEGES;`;
      const grantResult = await this.execTool(mysqlPath, [
        '-u',
        mysqlUsername,
        '-p' + mysqlPassword,
        '-e',
        grantSql,
      ]);
      if (grantResult.code !== 0) {
        const errorWithDetails = new Error('db_grant_failed') as Error & {
          details?: unknown;
        };
        errorWithDetails.details = grantResult;
        throw errorWithDetails;
      }
    }
  }

  private async handleRsyncHome(
    step: MigrationStep,
    job: MigrationJob,
  ): Promise<void> {
    const account = step.account;
    if (!account) {
      throw new Error('Rsync step requires an account');
    }
    const config = this.getDecryptedConfig(job);
    const hostValue = config['host'];
    const sshUserValue = config['sshUser'];
    const sshPortValue = config['sshPort'];
    const sshKeyPathValue = config['sshKeyPath'];
    if (typeof hostValue !== 'string' || hostValue.length === 0) {
      throw new Error('Missing host in sourceConfig');
    }
    if (typeof sshUserValue !== 'string' || sshUserValue.length === 0) {
      throw new Error('Missing sshUser in sourceConfig');
    }
    const host = hostValue;
    const sshUser = sshUserValue;
    let sshPort = 22;
    if (
      typeof sshPortValue === 'number' &&
      Number.isInteger(sshPortValue) &&
      sshPortValue > 0
    ) {
      sshPort = sshPortValue;
    } else if (typeof sshPortValue === 'string' && /^\d+$/.test(sshPortValue)) {
      sshPort = parseInt(sshPortValue, 10);
    }

    // Auth Method Logic
    let sshKeyPath =
      typeof sshKeyPathValue === 'string' && sshKeyPathValue.length > 0
        ? sshKeyPathValue
        : null;

    const sshKeyContent = config['sshKey'] as string | undefined;
    const sshPassword = config['sshPassword'] as string | undefined;
    let tempKeyPath: string | null = null;

    if (!sshKeyPath && sshKeyContent && sshKeyContent.trim().length > 0) {
      // Create temp key file
      const tmpDir = process.env.NPANEL_TEMP_DIR || '/tmp';
      const rnd = randomBytes(16).toString('hex');
      tempKeyPath = join(tmpDir, `mig_key_${rnd}`);
      await writeFile(tempKeyPath, sshKeyContent, { mode: 0o600 });
      sshKeyPath = tempKeyPath;
    }

    try {
      const payload: Record<string, unknown> = step.payload ?? {};
      const sourcePathValue = payload['sourcePath'];
      const sourcePath =
        typeof sourcePathValue === 'string' && sourcePathValue.length > 0
          ? sourcePathValue
          : this.resolveSourceHomePath(job, account);
      // restore into actual service home
      let targetPath: string;
      if (account.targetServiceId) {
        const svc = await this.hosting.get(account.targetServiceId);
        const username =
          svc.systemUsername ||
          (svc as any).systemUsername ||
          `u_${(svc.primaryDomain.toLowerCase().split('.')[0] || 'site').replace(/[^a-z0-9]/g, '').slice(0, 8)}`;
        targetPath = `/home/${username}`;
      } else {
        const targetPathValue = payload['targetPath'];
        targetPath =
          typeof targetPathValue === 'string' && targetPathValue.length > 0
            ? targetPathValue
            : this.resolveTargetHomePath(job, account);
      }
      await mkdir(targetPath, { recursive: true });
      const args: string[] = ['-az'];
      if (job.dryRun) {
        args.push('--dry-run');
      }
      const sshArgs: string[] = ['-o', 'StrictHostKeyChecking=yes'];
      const knownHostsPathValue = config['knownHostsPath'];
      const knownHostsPath =
        typeof knownHostsPathValue === 'string' &&
        knownHostsPathValue.length > 0
          ? knownHostsPathValue
          : null;
      if (knownHostsPath) {
        sshArgs.push('-o', `UserKnownHostsFile=${knownHostsPath}`);
      }

      if (sshPort) {
        sshArgs.push('-p', String(sshPort));
      }
      if (sshKeyPath) {
        sshArgs.push('-i', sshKeyPath);
      }

      if (sshPassword && !sshKeyPath) {
        // Use sshpass
        // We need to check if sshpass is available
        // But we are constructing the RSYNC command's -e argument.
        // rsync -e 'sshpass -p pass ssh ...'
        // Note: sshpass needs to run rsync, or rsync needs to run sshpass?
        // rsync -e 'ssh ...'
        // If we use sshpass, we wrap rsync?
        // sshpass -p pass rsync ... -e 'ssh ...'
        // Wait, sshpass passes the password to the command it runs.
        // If rsync runs ssh, ssh prompts for password.
        // sshpass -p pass rsync ... works if rsync runs ssh and ssh reads from tty?
        // sshpass sets up a PTY.
        // It's cleaner to wrap the whole rsync command with sshpass.
        // But we need to know if we are using it.
      }

      const rsyncBin = process.env.NPANEL_RSYNC_CMD || 'rsync';
      let rsyncPath: string;
      try {
        rsyncPath = await this.tools.resolve(rsyncBin, {
          packageHint: 'rsync package',
        });
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
          await this.appendLog(job, account, 'error', 'tool_not_found', {
            tool: err.toolName,
            feature: 'migration_rsync_home',
            packageHint: err.packageHint ?? 'rsync package',
            methodsTried: err.methods,
          });
        }
        throw err;
      }

      let execCommand = rsyncPath;
      let execArgs = args;

      // Finalize -e argument
      execArgs.push('-e', `ssh ${sshArgs.join(' ')}`);
      execArgs.push(`${sshUser}@${host}:${sourcePath}/`, `${targetPath}/`);

      if (sshPassword && !sshKeyPath) {
        const sshpassBin = await this.tools
          .resolve('sshpass', { packageHint: 'sshpass' })
          .catch(() => null);
        if (!sshpassBin) {
          throw new Error(
            'sshpass not found. Please install sshpass or use SSH Key.',
          );
        }
        execCommand = sshpassBin;
        execArgs = ['-p', sshPassword, rsyncPath, ...args]; // Re-construct args for sshpass wrapping
        // Wait, if we wrap, args are: sshpass -p PASS rsync -az ... -e 'ssh ...' src dest
        // Yes.
      }

      const result = await this.execRsync(execCommand, execArgs);
      if (result.code !== 0) {
        const errorWithDetails = new Error('rsync_failed') as Error & {
          details?: {
            code: number;
            stdout: string;
            stderr: string;
          };
        };
        errorWithDetails.details = result;
        if (result.stderr.includes('Host key verification failed')) {
          await this.appendLog(
            job,
            account,
            'error',
            'host_key_verification_failed',
            {
              hint: knownHostsPath
                ? 'Verify known_hosts file contains correct host key'
                : 'Add source host key to known_hosts or provide knownHostsPath',
              host: host,
            },
          );
        }
        throw errorWithDetails;
      }
    } finally {
      if (tempKeyPath) {
        await rm(tempKeyPath, { force: true }).catch(() => {});
      }
    }
  }

  private execRsync(
    command: string,
    args: string[],
  ): Promise<{
    code: number;
    stdout: string;
    stderr: string;
  }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildSafeExecEnv(),
      });
      let stdout = '';
      let stderr = '';
      if (child.stdout) {
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8');
        });
      }
      if (child.stderr) {
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
        });
      }
      child.on('error', (error) => {
        reject(error);
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

  private execTool(
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
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('close', (code) => {
        resolve({ code: code ?? -1, stdout, stderr });
      });
    });
  }

  private async execSshCommand(
    sourceConfig: Record<string, unknown>,
    remoteCommand: string,
    opts?: { strictHostKey?: boolean; connectTimeoutSeconds?: number },
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const host = sourceConfig['host'] as string;
    const sshUser = sourceConfig['sshUser'] as string;
    const sshPort = (sourceConfig['sshPort'] as number | undefined) ?? 22;
    const strictHostKey = opts?.strictHostKey ?? false;
    const connectTimeoutSeconds = opts?.connectTimeoutSeconds ?? 10;
    const knownHostsPathValue = sourceConfig['knownHostsPath'];
    const knownHostsPath =
      typeof knownHostsPathValue === 'string' && knownHostsPathValue.length > 0
        ? knownHostsPathValue
        : null;

    let sshKeyPath =
      typeof sourceConfig['sshKeyPath'] === 'string' &&
      sourceConfig['sshKeyPath'].length > 0
        ? sourceConfig['sshKeyPath']
        : null;
    const sshKeyContent = sourceConfig['sshKey'] as string | undefined;
    const sshPassword = sourceConfig['sshPassword'] as string | undefined;
    let tempKeyPath: string | null = null;
    if (!sshKeyPath && sshKeyContent && sshKeyContent.trim().length > 0) {
      const tmpDir = process.env.NPANEL_TEMP_DIR || '/tmp';
      const rnd = randomBytes(16).toString('hex');
      tempKeyPath = join(tmpDir, `mig_key_${rnd}`);
      await writeFile(tempKeyPath, sshKeyContent, { mode: 0o600 });
      sshKeyPath = tempKeyPath;
    }

    try {
      const sshPath = await this.tools.resolve('ssh', {
        packageHint: 'openssh-client',
      });
      const sshArgs: string[] = [
        '-p',
        String(sshPort),
        '-o',
        `ConnectTimeout=${connectTimeoutSeconds}`,
      ];
      if (knownHostsPath) {
        sshArgs.push('-o', `UserKnownHostsFile=${knownHostsPath}`);
      }
      sshArgs.push(
        '-o',
        `StrictHostKeyChecking=${strictHostKey ? 'yes' : 'no'}`,
      );
      if (sshKeyPath) {
        sshArgs.push('-i', sshKeyPath);
      }
      sshArgs.push(`${sshUser}@${host}`, remoteCommand);

      if (sshPassword && !sshKeyPath) {
        const sshpassBin = await this.tools.resolve('sshpass', {
          packageHint: 'sshpass',
        });
        return this.execTool(sshpassBin, [
          '-p',
          sshPassword,
          sshPath,
          ...sshArgs,
        ]);
      }
      return this.execTool(sshPath, sshArgs);
    } finally {
      if (tempKeyPath) {
        await rm(tempKeyPath, { force: true }).catch(() => {});
      }
    }
  }

  private async refreshJobStatus(job: MigrationJob): Promise<void> {
    const steps = await this.steps.find({
      where: { job: { id: job.id } },
    });
    if (steps.length === 0) {
      job.status = 'pending';
      await this.jobs.save(job);
      return;
    }
    const anyPending = steps.some(
      (step) => step.status === 'pending' || step.status === 'running',
    );
    const anyFailed = steps.some((step) => step.status === 'failed');
    const anyCompleted = steps.some((step) => step.status === 'completed');
    if (anyPending) {
      job.status = 'running';
    } else if (anyFailed && anyCompleted) {
      job.status = 'partial';
    } else if (anyFailed) {
      job.status = 'failed';
    } else {
      job.status = 'completed';
    }
    await this.jobs.save(job);
  }

  async appendLog(
    job: MigrationJob,
    account: MigrationAccount | null,
    level: 'info' | 'warning' | 'error',
    message: string,
    context?: Record<string, any>,
  ): Promise<MigrationLog> {
    const sanitized = this.sanitizeLogContext(context ?? null);
    const log = this.logs.create({
      job,
      account,
      level,
      message,
      context: sanitized,
    });
    return this.logs.save(log);
  }

  private sanitizeLogContext(
    context: Record<string, any> | null,
  ): Record<string, any> | null {
    if (!context) return null;
    const cloned: Record<string, any> = { ...context };
    const redactKeys = [
      'password',
      'sshPassword',
      'sshKey',
      'privateKey',
      'secret',
    ];
    for (const k of Object.keys(cloned)) {
      if (redactKeys.includes(k)) {
        cloned[k] = '[REDACTED]';
      }
    }
    return cloned;
  }
}
