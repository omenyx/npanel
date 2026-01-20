import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
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
  async create(@Body() body: CreateHostingServiceDto, @Req() req: Request) {
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    const result = await this.hosting.create(body, meta);
    return result;
  }

  @Get('logs')
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
  async provision(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const returnCredentials = body?.returnCredentials === true;
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    if (returnCredentials) {
      return this.hosting.provisionWithCredentials(id, meta);
    }
    return this.hosting.provision(id, meta);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  async suspend(@Param('id') id: string, @Req() req: Request) {
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    const service = await this.hosting.suspend(id, meta);
    return service;
  }

  @Post(':id/unsuspend')
  @HttpCode(HttpStatus.OK)
  async unsuspend(@Param('id') id: string, @Req() req: Request) {
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    const service = await this.hosting.unsuspend(id, meta);
    return service;
  }

  @Post(':id/soft-delete')
  @HttpCode(HttpStatus.OK)
  async softDelete(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    const service = await this.hosting.softDelete(id, meta);
    return service;
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    const service = await this.hosting.restore(id, meta);
    return service;
  }

  @Post(':id/terminate')
  @HttpCode(HttpStatus.OK)
  async terminate(@Param('id') id: string) {
    throw new Error('Termination requires prepare and confirm');
  }

  @Post(':id/terminate/prepare')
  @HttpCode(HttpStatus.OK)
  async terminatePrepare(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    const result = await this.hosting.terminatePrepare(id, meta);
    return result;
  }

  @Post(':id/terminate/confirm')
  @HttpCode(HttpStatus.OK)
  async terminateConfirm(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const token = typeof body?.token === 'string' ? body.token : '';
    const purge = body?.purge === true;
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    const service = await this.hosting.terminateConfirm(id, token, { purge, meta });
    return service;
  }

  @Post(':id/terminate/cancel')
  @HttpCode(HttpStatus.OK)
  async terminateCancel(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    const service = await this.hosting.terminateCancel(id, meta);
    return service;
  }

  @Post(':id/credentials/init')
  @HttpCode(HttpStatus.OK)
  async initCredentials(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    const result = await this.hosting.initCredentials(id, {
      mailboxPassword: typeof body?.mailboxPassword === 'string' ? body.mailboxPassword : undefined,
      ftpPassword: typeof body?.ftpPassword === 'string' ? body.ftpPassword : undefined,
    }, meta);
    return result;
  }
}
