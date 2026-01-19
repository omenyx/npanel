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

@Controller('v1/customer/migrations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class CustomerMigrationController {
  constructor(
    private readonly migrations: MigrationService,
    private readonly accounts: AccountsService,
    private readonly hosting: HostingService,
  ) {}

  private async getCustomerForUser(req: any) {
    const userId = req.user.id;
    const customer = await this.accounts.findByOwnerUserId(userId);
    if (!customer) {
      throw new UnauthorizedException('No customer account linked to user');
    }
    return customer;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createJob(@Req() req: any, @Body() body: CreateMigrationJobDto) {
    const customer = await this.getCustomerForUser(req);
    const job = await this.migrations.createJobForCustomer(customer.id, body);
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
    const customer = await this.getCustomerForUser(req);
    await this.migrations.getJobForCustomer(customer.id, id);

    const service = await this.hosting.get(body.targetServiceId);
    if (service.customerId !== customer.id) {
      throw new UnauthorizedException('Access denied');
    }

    const account = await this.migrations.addAccount(id, {
      sourceUsername: body.sourceUsername,
      sourcePrimaryDomain: body.sourcePrimaryDomain,
      targetCustomerId: customer.id,
      targetServiceId: body.targetServiceId,
    });
    return {
      id: account.id,
      sourceUsername: account.sourceUsername,
      sourcePrimaryDomain: account.sourcePrimaryDomain,
      targetServiceId: account.targetServiceId,
      createdAt: account.createdAt,
    };
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
    const customer = await this.getCustomerForUser(req);
    const steps = await this.migrations.planJobForCustomer(customer.id, id);
    return steps.map((step) => ({
      id: step.id,
      name: step.name,
      status: step.status,
      createdAt: step.createdAt,
      updatedAt: step.updatedAt,
    }));
  }

  @Post(':id/run-next')
  @HttpCode(HttpStatus.OK)
  async runNext(@Req() req: any, @Param('id') id: string) {
    const customer = await this.getCustomerForUser(req);
    const result = await this.migrations.runNextStepForCustomer(customer.id, id);
    return {
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
  }
}
