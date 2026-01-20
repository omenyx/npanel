import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { MigrationService } from './migration.service';
import { CreateMigrationJobDto } from './dto/create-migration-job.dto';
import { AddMigrationAccountDto } from './dto/add-migration-account.dto';
import { CreateMigrationFromSourceDto } from './dto/create-migration-from-source.dto';
import { JwtAuthGuard } from '../iam/jwt-auth.guard';
import { RolesGuard } from '../iam/roles.guard';
import { Roles } from '../iam/roles.decorator';
import { GovernanceService } from '../governance/governance.service';
import type { ActionStep } from '../governance/governance.service';

@Controller('v1/migrations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class MigrationController {
  constructor(
    private readonly migrations: MigrationService,
    private readonly governance: GovernanceService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createJob(@Body() body: CreateMigrationJobDto) {
    throw new Error('Migration job create requires prepare and confirm');
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async listJobs() {
    const jobs = await this.migrations.listJobs();
    return jobs;
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getJob(@Param('id') id: string) {
    const job = await this.migrations.getJob(id);
    return job;
  }

  @Post(':id/accounts')
  @HttpCode(HttpStatus.CREATED)
  async addAccount(
    @Param('id') id: string,
    @Body() body: AddMigrationAccountDto,
  ) {
    throw new Error('Add migration account requires prepare and confirm');
  }

  @Get(':id/steps')
  @HttpCode(HttpStatus.OK)
  async listSteps(@Param('id') id: string) {
    const steps = await this.migrations.listSteps(id);
    return steps;
  }

  @Post(':id/plan')
  @HttpCode(HttpStatus.CREATED)
  async planJob(@Param('id') id: string) {
    throw new Error('Plan migration requires prepare and confirm');
  }

  @Post(':id/run-next')
  @HttpCode(HttpStatus.OK)
  async runNext(@Param('id') id: string) {
    throw new Error('Run next migration step requires prepare and confirm');
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  async start(@Param('id') id: string) {
    throw new Error('Start migration requires prepare and confirm');
  }

  @Post('prepare-create')
  @HttpCode(HttpStatus.OK)
  async prepareCreateJob(@Body() body: CreateMigrationJobDto) {
    return this.governance.prepare({
      module: 'migrations',
      action: 'create_migration_job',
      targetKind: 'migration_job',
      targetKey: body.name,
      payload: body as any,
      risk: 'high',
      reversibility: 'requires_restore',
      impactedSubsystems: ['control_plane_db', 'remote_host', 'filesystem', 'dns', 'mail', 'mysql'],
      actor: { actorRole: 'ADMIN', actorType: 'admin' },
    });
  }

  @Post('prepare-create-from-source')
  @HttpCode(HttpStatus.OK)
  async prepareCreateFromSource(@Body() body: CreateMigrationFromSourceDto) {
    return this.governance.prepare({
      module: 'migrations',
      action: 'create_migration_from_source',
      targetKind: 'migration_job',
      targetKey: body.name,
      payload: body as any,
      risk: 'high',
      reversibility: 'requires_restore',
      impactedSubsystems: ['control_plane_db', 'remote_host', 'filesystem', 'dns', 'mail', 'mysql'],
      actor: { actorRole: 'ADMIN', actorType: 'admin' },
    });
  }

  @Post('confirm-create-from-source')
  @HttpCode(HttpStatus.OK)
  async confirmCreateFromSource(@Body() body: { intentId: string; token: string }) {
    const intent = await this.governance.verify(body.intentId, body.token);
    const steps: ActionStep[] = [
      { name: 'create_migration_job', status: 'SUCCESS' },
      { name: 'add_accounts', status: 'SUCCESS' },
    ];
    try {
      const payload = intent.payload as any;
      const input: CreateMigrationJobDto = {
        name: payload.name,
        sourceType: payload.sourceType,
        sourceConfig: payload.sourceConfig,
        dryRun: payload.dryRun,
      };
      const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
      const created = await this.migrations.createJobWithAccounts(input, accounts);
      const result = {
        id: created.job.id,
        name: created.job.name,
        status: created.job.status,
        sourceType: created.job.sourceType,
        dryRun: created.job.dryRun,
        createdAt: created.job.createdAt,
        accountsCreated: created.accounts.length,
      };
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'create_migration_job', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      steps[1] = { name: 'add_accounts', status: 'SKIPPED' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post('confirm-create')
  @HttpCode(HttpStatus.OK)
  async confirmCreateJob(@Body() body: { intentId: string; token: string }) {
    const intent = await this.governance.verify(body.intentId, body.token);
    const steps: ActionStep[] = [{ name: 'create_migration_job', status: 'SUCCESS' }];
    try {
      const job = await this.migrations.createJob(intent.payload as any);
      const result = {
        id: job.id,
        name: job.name,
        status: job.status,
        sourceType: job.sourceType,
        dryRun: job.dryRun,
        createdAt: job.createdAt,
      };
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'create_migration_job', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/accounts/prepare-add')
  @HttpCode(HttpStatus.OK)
  async prepareAddAccount(@Param('id') id: string, @Body() body: AddMigrationAccountDto & { reason?: string }) {
    await this.migrations.getJob(id);
    return this.governance.prepare({
      module: 'migrations',
      action: 'add_migration_account',
      targetKind: 'migration_job',
      targetKey: id,
      payload: { id, ...body } as any,
      risk: 'medium',
      reversibility: 'reversible',
      impactedSubsystems: ['control_plane_db'],
      actor: { actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined },
    });
  }

  @Post(':id/accounts/confirm-add')
  @HttpCode(HttpStatus.OK)
  async confirmAddAccount(@Param('id') id: string, @Body() body: { intentId: string; token: string }) {
    const intent = await this.governance.verify(body.intentId, body.token);
    const payload = intent.payload as any;
    if (payload?.id !== id) throw new Error('Intent target mismatch');
    const steps: ActionStep[] = [{ name: 'add_migration_account', status: 'SUCCESS' }];
    try {
      const result = await this.migrations.addAccount(id, payload as any);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'add_migration_account', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/plan/prepare')
  @HttpCode(HttpStatus.OK)
  async preparePlan(@Param('id') id: string, @Body() body: { reason?: string }) {
    await this.migrations.getJob(id);
    return this.governance.prepare({
      module: 'migrations',
      action: 'plan_migration',
      targetKind: 'migration_job',
      targetKey: id,
      payload: { id } as any,
      risk: 'high',
      reversibility: 'reversible',
      impactedSubsystems: ['control_plane_db'],
      actor: { actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined },
    });
  }

  @Post(':id/plan/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmPlan(@Param('id') id: string, @Body() body: { intentId: string; token: string }) {
    const intent = await this.governance.verify(body.intentId, body.token);
    if ((intent.payload as any)?.id !== id) throw new Error('Intent target mismatch');
    const steps: ActionStep[] = [{ name: 'plan_migration', status: 'SUCCESS' }];
    try {
      const result = await this.migrations.planJob(id);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'plan_migration', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/run-next/prepare')
  @HttpCode(HttpStatus.OK)
  async prepareRunNext(@Param('id') id: string, @Body() body: { reason?: string }) {
    await this.migrations.getJob(id);
    return this.governance.prepare({
      module: 'migrations',
      action: 'run_next_step',
      targetKind: 'migration_job',
      targetKey: id,
      payload: { id } as any,
      risk: 'high',
      reversibility: 'requires_restore',
      impactedSubsystems: ['remote_host', 'filesystem', 'dns', 'mail', 'mysql'],
      actor: { actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined },
    });
  }

  @Post(':id/run-next/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmRunNext(@Param('id') id: string, @Body() body: { intentId: string; token: string }) {
    const intent = await this.governance.verify(body.intentId, body.token);
    if ((intent.payload as any)?.id !== id) throw new Error('Intent target mismatch');
    const steps: ActionStep[] = [{ name: 'run_next_step', status: 'SUCCESS' }];
    try {
      const result = await this.migrations.runNextStep(id);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'run_next_step', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/start/prepare')
  @HttpCode(HttpStatus.OK)
  async prepareStart(@Param('id') id: string, @Body() body: { reason?: string }) {
    await this.migrations.getJob(id);
    return this.governance.prepare({
      module: 'migrations',
      action: 'start_migration',
      targetKind: 'migration_job',
      targetKey: id,
      payload: { id } as any,
      risk: 'high',
      reversibility: 'requires_restore',
      impactedSubsystems: ['worker_queue'],
      actor: { actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined },
    });
  }

  @Post(':id/start/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmStart(@Param('id') id: string, @Body() body: { intentId: string; token: string }) {
    const intent = await this.governance.verify(body.intentId, body.token);
    if ((intent.payload as any)?.id !== id) throw new Error('Intent target mismatch');
    const steps: ActionStep[] = [{ name: 'start_background_migration', status: 'SUCCESS' }];
    try {
      await this.migrations.startBackgroundMigration(id);
      const result = { success: true, message: 'Migration started', poll: { jobId: id, stepsEndpoint: `/v1/migrations/${id}/steps`, logsEndpoint: `/v1/migrations/${id}/logs` } };
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'start_background_migration', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Get(':id/logs')
  @HttpCode(HttpStatus.OK)
  async listLogs(@Param('id') id: string) {
      return this.migrations.listLogs(id);
  }
}
