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
import { GovernanceService } from '../governance/governance.service';
import type { ActionStep } from '../governance/governance.service';

@Controller('v1/hosting/services')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class HostingController {
  constructor(
    private readonly hosting: HostingService,
    private readonly governance: GovernanceService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list() {
    const services = await this.hosting.list();
    return services;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateHostingServiceDto, @Req() req: Request) {
    throw new Error('Create account requires prepare and confirm');
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
    throw new Error('Provision requires prepare and confirm');
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  async suspend(@Param('id') id: string, @Req() req: Request) {
    throw new Error('Suspend requires prepare and confirm');
  }

  @Post(':id/unsuspend')
  @HttpCode(HttpStatus.OK)
  async unsuspend(@Param('id') id: string, @Req() req: Request) {
    throw new Error('Unsuspend requires prepare and confirm');
  }

  @Post(':id/soft-delete')
  @HttpCode(HttpStatus.OK)
  async softDelete(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    throw new Error('Soft delete requires prepare and confirm');
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    throw new Error('Restore requires prepare and confirm');
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
    throw new Error('Credential init requires prepare and confirm');
  }

  @Post('prepare-create')
  @HttpCode(HttpStatus.OK)
  async prepareCreate(@Body() body: CreateHostingServiceDto, @Req() req: Request) {
    const actor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof (body as any)?.reason === 'string' ? (body as any).reason : undefined };
    const planName = body.planName ?? 'basic';
    const plan = await this.hosting.getPlan(planName);
    if (!plan) {
      throw new Error(`Hosting plan '${planName}' not found`);
    }
    const services = await this.hosting.list();
    const existing = services.find((s) => s.primaryDomain === body.primaryDomain);
    if (existing && existing.status !== 'terminated') {
      throw new Error(`Hosting service for domain '${body.primaryDomain}' already exists`);
    }
    return this.governance.prepare({
      module: 'hosting',
      action: 'create_account',
      targetKind: 'hosting_service',
      targetKey: body.primaryDomain,
      payload: body as any,
      risk: 'high',
      reversibility: 'reversible',
      impactedSubsystems: ['control_plane_db', 'linux_users', 'nginx', 'php_fpm', 'dns', 'mail', 'mysql', 'ftp'],
      actor,
    });
  }

  @Post('confirm-create')
  @HttpCode(HttpStatus.OK)
  async confirmCreate(@Body() body: { intentId: string; token: string }, @Req() req: Request) {
    const expectedActor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    const intent = await this.governance.verifyWithActor(body.intentId, body.token, expectedActor);
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: intent.reason ?? undefined };
    const steps: ActionStep[] = [{ name: 'create_and_provision', status: 'SUCCESS' }];
    try {
      const result = await this.hosting.create(intent.payload as any, meta);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'create_and_provision', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/prepare-provision')
  @HttpCode(HttpStatus.OK)
  async prepareProvision(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const actor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    const service = await this.hosting.get(id);
    if (service.status === 'active') {
      throw new Error('Service already active');
    }
    const returnCredentials = body?.returnCredentials === true;
    return this.governance.prepare({
      module: 'hosting',
      action: returnCredentials ? 'provision_with_credentials' : 'provision',
      targetKind: 'hosting_service',
      targetKey: id,
      payload: { id, returnCredentials } as any,
      risk: 'high',
      reversibility: 'reversible',
      impactedSubsystems: ['linux_users', 'nginx', 'php_fpm', 'dns', 'mail', 'mysql', 'ftp'],
      actor,
    });
  }

  @Post(':id/confirm-provision')
  @HttpCode(HttpStatus.OK)
  async confirmProvision(@Param('id') id: string, @Body() body: { intentId: string; token: string }, @Req() req: Request) {
    const expectedActor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    const intent = await this.governance.verifyWithActor(body.intentId, body.token, expectedActor);
    if (intent.targetKey !== id) throw new Error('Intent target mismatch');
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: intent.reason ?? undefined };
    const returnCredentials = (intent.payload as any)?.returnCredentials === true;
    const steps: ActionStep[] = [{ name: 'provision', status: 'SUCCESS' }];
    try {
      const result = returnCredentials
        ? await this.hosting.provisionWithCredentials(id, meta)
        : await this.hosting.provision(id, meta);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'provision', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/resume-provision')
  @HttpCode(HttpStatus.OK)
  async resumeProvision(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    const service = await this.hosting.resumeProvision(id, meta);
    return service;
  }

  @Post(':id/prepare-retry-provision')
  @HttpCode(HttpStatus.OK)
  async prepareRetryProvision(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const actor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    return this.governance.prepare({
      module: 'hosting',
      action: 'retry_provision',
      targetKind: 'hosting_service',
      targetKey: id,
      payload: { id } as any,
      risk: 'high',
      reversibility: 'irreversible',
      impactedSubsystems: ['control_plane_db', 'linux_users', 'nginx', 'php_fpm', 'dns', 'mail', 'mysql', 'ftp'],
      actor,
    });
  }

  @Post(':id/confirm-retry-provision')
  @HttpCode(HttpStatus.OK)
  async confirmRetryProvision(@Param('id') id: string, @Body() body: { intentId: string; token: string }, @Req() req: Request) {
    const expectedActor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    const intent = await this.governance.verifyWithActor(body.intentId, body.token, expectedActor);
    if (intent.targetKey !== id) throw new Error('Intent target mismatch');
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: intent.reason ?? undefined };
    const steps: ActionStep[] = [{ name: 'retry_provision', status: 'SUCCESS' }];
    try {
      const result = await this.hosting.retryProvision(id, meta);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'retry_provision', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/prepare-suspend')
  @HttpCode(HttpStatus.OK)
  async prepareSuspend(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const actor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    const service = await this.hosting.get(id);
    if (service.status !== 'active') throw new Error('Service not active');
    return this.governance.prepare({
      module: 'hosting',
      action: 'suspend',
      targetKind: 'hosting_service',
      targetKey: id,
      payload: { id } as any,
      risk: 'medium',
      reversibility: 'reversible',
      impactedSubsystems: ['linux_users', 'nginx'],
      actor,
    });
  }

  @Post(':id/confirm-suspend')
  @HttpCode(HttpStatus.OK)
  async confirmSuspend(@Param('id') id: string, @Body() body: { intentId: string; token: string }, @Req() req: Request) {
    const expectedActor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    const intent = await this.governance.verifyWithActor(body.intentId, body.token, expectedActor);
    if (intent.targetKey !== id) throw new Error('Intent target mismatch');
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: intent.reason ?? undefined };
    const steps: ActionStep[] = [{ name: 'suspend', status: 'SUCCESS' }];
    try {
      const result = await this.hosting.suspend(id, meta);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'suspend', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/prepare-unsuspend')
  @HttpCode(HttpStatus.OK)
  async prepareUnsuspend(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const actor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    const service = await this.hosting.get(id);
    if (service.status !== 'suspended') throw new Error('Service not suspended');
    return this.governance.prepare({
      module: 'hosting',
      action: 'unsuspend',
      targetKind: 'hosting_service',
      targetKey: id,
      payload: { id } as any,
      risk: 'medium',
      reversibility: 'reversible',
      impactedSubsystems: ['linux_users', 'nginx'],
      actor,
    });
  }

  @Post(':id/confirm-unsuspend')
  @HttpCode(HttpStatus.OK)
  async confirmUnsuspend(@Param('id') id: string, @Body() body: { intentId: string; token: string }, @Req() req: Request) {
    const expectedActor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    const intent = await this.governance.verifyWithActor(body.intentId, body.token, expectedActor);
    if (intent.targetKey !== id) throw new Error('Intent target mismatch');
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: intent.reason ?? undefined };
    const steps: ActionStep[] = [{ name: 'unsuspend', status: 'SUCCESS' }];
    try {
      const result = await this.hosting.unsuspend(id, meta);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'unsuspend', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/prepare-soft-delete')
  @HttpCode(HttpStatus.OK)
  async prepareSoftDelete(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const actor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    const service = await this.hosting.get(id);
    if (service.status !== 'active') throw new Error('Soft delete allowed only for active services');
    return this.governance.prepare({
      module: 'hosting',
      action: 'soft_delete',
      targetKind: 'hosting_service',
      targetKey: id,
      payload: { id } as any,
      risk: 'high',
      reversibility: 'reversible',
      impactedSubsystems: ['linux_users', 'nginx', 'mysql', 'mail', 'ftp'],
      actor,
    });
  }

  @Post(':id/confirm-soft-delete')
  @HttpCode(HttpStatus.OK)
  async confirmSoftDelete(@Param('id') id: string, @Body() body: { intentId: string; token: string }, @Req() req: Request) {
    const expectedActor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    const intent = await this.governance.verifyWithActor(body.intentId, body.token, expectedActor);
    if (intent.targetKey !== id) throw new Error('Intent target mismatch');
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: intent.reason ?? undefined };
    const steps: ActionStep[] = [{ name: 'soft_delete', status: 'SUCCESS' }];
    try {
      const result = await this.hosting.softDelete(id, meta);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'soft_delete', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/prepare-restore')
  @HttpCode(HttpStatus.OK)
  async prepareRestore(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const actor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    const service = await this.hosting.get(id);
    if (service.status !== 'soft_deleted') throw new Error('Restore allowed only for soft-deleted services');
    return this.governance.prepare({
      module: 'hosting',
      action: 'restore',
      targetKind: 'hosting_service',
      targetKey: id,
      payload: { id } as any,
      risk: 'medium',
      reversibility: 'reversible',
      impactedSubsystems: ['linux_users', 'nginx'],
      actor,
    });
  }

  @Post(':id/confirm-restore')
  @HttpCode(HttpStatus.OK)
  async confirmRestore(@Param('id') id: string, @Body() body: { intentId: string; token: string }, @Req() req: Request) {
    const expectedActor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    const intent = await this.governance.verifyWithActor(body.intentId, body.token, expectedActor);
    if (intent.targetKey !== id) throw new Error('Intent target mismatch');
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: intent.reason ?? undefined };
    const steps: ActionStep[] = [{ name: 'restore', status: 'SUCCESS' }];
    try {
      const result = await this.hosting.restore(id, meta);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'restore', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/prepare-credentials-init')
  @HttpCode(HttpStatus.OK)
  async prepareInitCredentials(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const actor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    await this.hosting.get(id);
    return this.governance.prepare({
      module: 'hosting',
      action: 'init_credentials',
      targetKind: 'hosting_service',
      targetKey: id,
      payload: {
        id,
        mailboxPassword: typeof body?.mailboxPassword === 'string' ? body.mailboxPassword : undefined,
        ftpPassword: typeof body?.ftpPassword === 'string' ? body.ftpPassword : undefined,
      } as any,
      risk: 'high',
      reversibility: 'requires_restore',
      impactedSubsystems: ['mail', 'ftp'],
      actor,
    });
  }

  @Post(':id/confirm-credentials-init')
  @HttpCode(HttpStatus.OK)
  async confirmInitCredentials(@Param('id') id: string, @Body() body: { intentId: string; token: string }, @Req() req: Request) {
    const expectedActor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    const intent = await this.governance.verifyWithActor(body.intentId, body.token, expectedActor);
    if (intent.targetKey !== id) throw new Error('Intent target mismatch');
    const meta = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: intent.reason ?? undefined };
    const steps: ActionStep[] = [{ name: 'init_credentials', status: 'SUCCESS' }];
    try {
      const payload = intent.payload as any;
      const result = await this.hosting.initCredentials(id, {
        mailboxPassword: typeof payload?.mailboxPassword === 'string' ? payload.mailboxPassword : undefined,
        ftpPassword: typeof payload?.ftpPassword === 'string' ? payload.ftpPassword : undefined,
      }, meta);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'init_credentials', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }
}
