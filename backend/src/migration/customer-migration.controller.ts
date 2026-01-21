import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { MigrationService } from './migration.service';
import { AccountsService } from '../accounts/accounts.service';
import { HostingService } from '../hosting/hosting.service';
import { JwtAuthGuard } from '../iam/jwt-auth.guard';
import { RolesGuard } from '../iam/roles.guard';
import { Roles } from '../iam/roles.decorator';
import { CreateMigrationJobDto } from './dto/create-migration-job.dto';
import { AddCustomerMigrationAccountDto } from './dto/add-customer-migration-account.dto';
import { GovernanceService } from '../governance/governance.service';
import type { ActionStep } from '../governance/governance.service';

@Controller('v1/customer/migrations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class CustomerMigrationController {
  constructor(
    private readonly migrations: MigrationService,
    private readonly accounts: AccountsService,
    private readonly hosting: HostingService,
    private readonly governance: GovernanceService,
  ) {}

  private async getCustomerForUser(req: any) {
    const impersonatedCustomerId = req.user?.impersonation?.customerId ?? null;
    if (impersonatedCustomerId) {
      return this.accounts.get(impersonatedCustomerId);
    }
    const userId = req.user.id;
    const customer = await this.accounts.findByOwnerUserId(userId);
    if (!customer) {
      throw new UnauthorizedException('No customer account linked to user');
    }
    return customer;
  }

  private getActor(req: any, reason?: string) {
    const imp = req.user?.impersonation ?? null;
    if (imp?.active) {
      return {
        actorId: imp.adminId,
        actorRole: 'ADMIN',
        actorType: 'impersonation',
        reason: typeof reason === 'string' ? reason : undefined,
      };
    }
    return {
      actorId: req.user?.id,
      actorRole: 'CUSTOMER',
      actorType: 'customer',
      reason: typeof reason === 'string' ? reason : undefined,
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createJob(@Req() req: any, @Body() body: CreateMigrationJobDto) {
    throw new Error('Customer migration create requires prepare and confirm');
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async listJobs(@Req() req: any) {
    const customer = await this.getCustomerForUser(req);
    const jobs = await this.migrations.listJobsForCustomer(customer.id);
    return jobs.map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      sourceType: job.sourceType,
      dryRun: job.dryRun,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }));
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getJob(@Req() req: any, @Param('id') id: string) {
    const customer = await this.getCustomerForUser(req);
    const job = await this.migrations.getJobForCustomer(customer.id, id);
    return {
      id: job.id,
      name: job.name,
      status: job.status,
      sourceType: job.sourceType,
      dryRun: job.dryRun,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  @Post(':id/accounts')
  @HttpCode(HttpStatus.CREATED)
  async addAccount(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: AddCustomerMigrationAccountDto,
  ) {
    throw new Error('Customer migration account add requires prepare and confirm');
  }

  @Get(':id/steps')
  @HttpCode(HttpStatus.OK)
  async listSteps(@Req() req: any, @Param('id') id: string) {
    const customer = await this.getCustomerForUser(req);
    const steps = await this.migrations.listStepsForCustomer(customer.id, id);
    return steps.map((step) => ({
      id: step.id,
      name: step.name,
      status: step.status,
      lastError: step.lastError ? { message: step.lastError.message } : null,
      createdAt: step.createdAt,
      updatedAt: step.updatedAt,
    }));
  }

  @Get(':id/logs')
  @HttpCode(HttpStatus.OK)
  async listLogs(@Req() req: any, @Param('id') id: string) {
    const customer = await this.getCustomerForUser(req);
    const logs = await this.migrations.listLogsForCustomer(customer.id, id);
    return logs.map((log) => ({
      id: log.id,
      level: log.level,
      message: log.message,
      createdAt: log.createdAt,
      accountId: log.account?.id ?? null,
    }));
  }

  @Post(':id/plan')
  @HttpCode(HttpStatus.CREATED)
  async planJob(@Req() req: any, @Param('id') id: string) {
    throw new Error('Customer migration plan requires prepare and confirm');
  }

  @Post(':id/run-next')
  @HttpCode(HttpStatus.OK)
  async runNext(@Req() req: any, @Param('id') id: string) {
    throw new Error('Customer migration run-next requires prepare and confirm');
  }

  @Post('prepare-create')
  @HttpCode(HttpStatus.OK)
  async prepareCreateJob(@Req() req: any, @Body() body: CreateMigrationJobDto & { reason?: string }) {
    const customer = await this.getCustomerForUser(req);
    const actor = this.getActor(req, body?.reason);
    return this.governance.prepare({
      module: 'migrations',
      action: 'create_migration_job',
      targetKind: 'migration_job',
      targetKey: body.name,
      payload: { customerId: customer.id, ...body } as any,
      risk: 'high',
      reversibility: 'requires_restore',
      impactedSubsystems: ['control_plane_db', 'remote_host', 'filesystem', 'dns', 'mail', 'mysql'],
      actor,
    });
  }

  @Post('confirm-create')
  @HttpCode(HttpStatus.OK)
  async confirmCreateJob(@Req() req: any, @Body() body: { intentId: string; token: string }) {
    const customer = await this.getCustomerForUser(req);
    const intent = await this.governance.verifyWithActor(body.intentId, body.token, this.getActor(req));
    const payload = intent.payload as any;
    if (payload?.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    const steps: ActionStep[] = [{ name: 'create_migration_job', status: 'SUCCESS' }];
    try {
      const job = await this.migrations.createJobForCustomer(customer.id, payload as any);
      const result = {
        id: job.id,
        name: job.name,
        status: job.status,
        sourceType: job.sourceType,
        dryRun: job.dryRun,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      };
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'create_migration_job', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/accounts/prepare-add')
  @HttpCode(HttpStatus.OK)
  async prepareAddAccount(@Req() req: any, @Param('id') id: string, @Body() body: AddCustomerMigrationAccountDto & { reason?: string }) {
    const customer = await this.getCustomerForUser(req);
    await this.migrations.getJobForCustomer(customer.id, id);
    const service = await this.hosting.get(body.targetServiceId);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    const actor = this.getActor(req, body?.reason);
    return this.governance.prepare({
      module: 'migrations',
      action: 'add_migration_account',
      targetKind: 'migration_job',
      targetKey: id,
      payload: { id, targetCustomerId: customer.id, ...body } as any,
      risk: 'medium',
      reversibility: 'reversible',
      impactedSubsystems: ['control_plane_db'],
      actor,
    });
  }

  @Post(':id/accounts/confirm-add')
  @HttpCode(HttpStatus.OK)
  async confirmAddAccount(@Req() req: any, @Param('id') id: string, @Body() body: { intentId: string; token: string }) {
    const customer = await this.getCustomerForUser(req);
    const intent = await this.governance.verifyWithActor(body.intentId, body.token, this.getActor(req));
    const payload = intent.payload as any;
    if (payload?.id !== id || payload?.targetCustomerId !== customer.id) throw new UnauthorizedException('Access denied');
    const steps: ActionStep[] = [{ name: 'add_migration_account', status: 'SUCCESS' }];
    try {
      const account = await this.migrations.addAccount(id, {
        sourceUsername: payload.sourceUsername,
        sourcePrimaryDomain: payload.sourcePrimaryDomain,
        targetCustomerId: customer.id,
        targetServiceId: payload.targetServiceId,
      });
      const result = {
        id: account.id,
        sourceUsername: account.sourceUsername,
        sourcePrimaryDomain: account.sourcePrimaryDomain,
        targetServiceId: account.targetServiceId,
        createdAt: account.createdAt,
      };
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'add_migration_account', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/plan/prepare')
  @HttpCode(HttpStatus.OK)
  async preparePlan(@Req() req: any, @Param('id') id: string, @Body() body: { reason?: string }) {
    const customer = await this.getCustomerForUser(req);
    await this.migrations.getJobForCustomer(customer.id, id);
    const actor = this.getActor(req, body?.reason);
    return this.governance.prepare({
      module: 'migrations',
      action: 'plan_migration',
      targetKind: 'migration_job',
      targetKey: id,
      payload: { id, customerId: customer.id } as any,
      risk: 'high',
      reversibility: 'reversible',
      impactedSubsystems: ['control_plane_db'],
      actor,
    });
  }

  @Post(':id/plan/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmPlan(@Req() req: any, @Param('id') id: string, @Body() body: { intentId: string; token: string }) {
    const customer = await this.getCustomerForUser(req);
    const intent = await this.governance.verifyWithActor(body.intentId, body.token, this.getActor(req));
    const payload = intent.payload as any;
    if (payload?.id !== id || payload?.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    const steps: ActionStep[] = [{ name: 'plan_migration', status: 'SUCCESS' }];
    try {
      const stepsResult = await this.migrations.planJobForCustomer(customer.id, id);
      const result = stepsResult.map((step) => ({
        id: step.id,
        name: step.name,
        status: step.status,
        createdAt: step.createdAt,
        updatedAt: step.updatedAt,
      }));
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'plan_migration', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/run-next/prepare')
  @HttpCode(HttpStatus.OK)
  async prepareRunNext(@Req() req: any, @Param('id') id: string, @Body() body: { reason?: string }) {
    const customer = await this.getCustomerForUser(req);
    await this.migrations.getJobForCustomer(customer.id, id);
    const actor = this.getActor(req, body?.reason);
    return this.governance.prepare({
      module: 'migrations',
      action: 'run_next_step',
      targetKind: 'migration_job',
      targetKey: id,
      payload: { id, customerId: customer.id } as any,
      risk: 'high',
      reversibility: 'requires_restore',
      impactedSubsystems: ['remote_host', 'filesystem', 'dns', 'mail', 'mysql'],
      actor,
    });
  }

  @Post(':id/run-next/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmRunNext(@Req() req: any, @Param('id') id: string, @Body() body: { intentId: string; token: string }) {
    const customer = await this.getCustomerForUser(req);
    const intent = await this.governance.verifyWithActor(body.intentId, body.token, this.getActor(req));
    const payload = intent.payload as any;
    if (payload?.id !== id || payload?.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    const steps: ActionStep[] = [{ name: 'run_next_step', status: 'SUCCESS' }];
    try {
      const result = await this.migrations.runNextStepForCustomer(customer.id, id);
      const mapped = {
        job: {
          id: result.job.id,
          status: result.job.status,
        },
        step: result.step
          ? {
              id: result.step.id,
              name: result.step.name,
              status: result.step.status,
            }
          : null,
      };
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result: mapped });
    } catch (e) {
      steps[0] = { name: 'run_next_step', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }
}
