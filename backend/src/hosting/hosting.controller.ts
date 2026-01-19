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
import { HostingService } from './hosting.service';
import { CreateHostingServiceDto } from './dto/create-hosting-service.dto';
import { JwtAuthGuard } from '../iam/jwt-auth.guard';
import { RolesGuard } from '../iam/roles.guard';
import { Roles } from '../iam/roles.decorator';

@Controller('v1/hosting/services')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class HostingController {
  constructor(private readonly hosting: HostingService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list() {
    const services = await this.hosting.list();
    return services;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateHostingServiceDto) {
    const result = await this.hosting.create(body);
    return result;
  }

  @Get('services/logs')
  @HttpCode(HttpStatus.OK)
  async allLogs() {
    return this.hosting.listAllLogs();
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async get(@Param('id') id: string) {
    const service = await this.hosting.get(id);
    return service;
  }

  @Get(':id/logs')
  @HttpCode(HttpStatus.OK)
  async logs(@Param('id') id: string) {
    const entries = await this.hosting.listLogs(id);
    return entries;
  }

  @Post(':id/provision')
  @HttpCode(HttpStatus.OK)
  async provision(@Param('id') id: string) {
    const service = await this.hosting.provision(id);
    return service;
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  async suspend(@Param('id') id: string) {
    const service = await this.hosting.suspend(id);
    return service;
  }

  @Post(':id/unsuspend')
  @HttpCode(HttpStatus.OK)
  async unsuspend(@Param('id') id: string) {
    const service = await this.hosting.unsuspend(id);
    return service;
  }

  @Post(':id/terminate')
  @HttpCode(HttpStatus.OK)
  async terminate(@Param('id') id: string) {
    throw new Error('Termination requires prepare and confirm');
  }

  @Post(':id/terminate/prepare')
  @HttpCode(HttpStatus.OK)
  async terminatePrepare(@Param('id') id: string) {
    const result = await this.hosting.terminatePrepare(id);
    return result;
  }

  @Post(':id/terminate/confirm')
  @HttpCode(HttpStatus.OK)
  async terminateConfirm(@Param('id') id: string, @Body() body: any) {
    const token = typeof body?.token === 'string' ? body.token : '';
    const service = await this.hosting.terminateConfirm(id, token);
    return service;
  }

  @Post(':id/terminate/cancel')
  @HttpCode(HttpStatus.OK)
  async terminateCancel(@Param('id') id: string) {
    const service = await this.hosting.terminateCancel(id);
    return service;
  }

  @Post(':id/credentials/init')
  @HttpCode(HttpStatus.OK)
  async initCredentials(@Param('id') id: string, @Body() body: any) {
    const result = await this.hosting.initCredentials(id, {
      mailboxPassword: typeof body?.mailboxPassword === 'string' ? body.mailboxPassword : undefined,
      ftpPassword: typeof body?.ftpPassword === 'string' ? body.ftpPassword : undefined,
    });
    return result;
  }
}
