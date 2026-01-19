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
import { JwtAuthGuard } from '../iam/jwt-auth.guard';
import { RolesGuard } from '../iam/roles.guard';
import { Roles } from '../iam/roles.decorator';

@Controller('v1/migrations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class MigrationController {
  constructor(private readonly migrations: MigrationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createJob(@Body() body: CreateMigrationJobDto) {
    const job = await this.migrations.createJob(body);
    return {
      id: job.id,
      name: job.name,
      status: job.status,
      sourceType: job.sourceType,
      dryRun: job.dryRun,
      createdAt: job.createdAt,
    };
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
    const account = await this.migrations.addAccount(id, body);
    return account;
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
    const steps = await this.migrations.planJob(id);
    return steps;
  }

  @Post(':id/run-next')
  @HttpCode(HttpStatus.OK)
  async runNext(@Param('id') id: string) {
    const result = await this.migrations.runNextStep(id);
    return result;
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  async start(@Param('id') id: string) {
    await this.migrations.startBackgroundMigration(id);
    return { success: true, message: 'Migration started in background' };
  }

  @Get(':id/logs')
  @HttpCode(HttpStatus.OK)
  async listLogs(@Param('id') id: string) {
      return this.migrations.listLogs(id);
  }
}
