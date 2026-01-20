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
import { HostingService } from './hosting.service';
import { AccountsService } from '../accounts/accounts.service';
import { JwtAuthGuard } from '../iam/jwt-auth.guard';
import { RolesGuard } from '../iam/roles.guard';
import { Roles } from '../iam/roles.decorator';
import { GovernanceService } from '../governance/governance.service';
import type { ActionStep } from '../governance/governance.service';

@Controller('v1/customer/hosting/services')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class CustomerHostingController {
  constructor(
    private readonly hosting: HostingService,
    private readonly accounts: AccountsService,
    private readonly governance: GovernanceService,
  ) {}

  private async getCustomerForUser(req: any) {
    const userId = req.user.id;
    const customer = await this.accounts.findByOwnerUserId(userId);
    if (!customer) {
      throw new UnauthorizedException('No customer account linked to user');
    }
    return customer;
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@Req() req: any) {
    const customer = await this.getCustomerForUser(req);
    const services = await this.hosting.listForCustomer(customer.id);
    const mapped = await Promise.all(
      services.map(async (service) => {
        const planName = service.planName ?? 'basic';
        const plan = await this.hosting.getPlan(planName);
        return {
          id: service.id,
          primaryDomain: service.primaryDomain,
          planName,
          status: service.status,
          createdAt: service.createdAt,
          planLimits: plan
            ? {
                diskQuotaMb: plan.diskQuotaMb,
                maxDatabases: plan.maxDatabases,
                maxMailboxes: plan.maxMailboxes,
                mailboxQuotaMb: plan.mailboxQuotaMb,
              }
            : null,
        };
      }),
    );
    return mapped;
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async get(@Req() req: any, @Param('id') id: string) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) {
      throw new UnauthorizedException('Access denied');
    }
    const planName = service.planName ?? 'basic';
    const plan = await this.hosting.getPlan(planName);
    return {
      id: service.id,
      primaryDomain: service.primaryDomain,
      planName,
      status: service.status,
      createdAt: service.createdAt,
      planLimits: plan
        ? {
            diskQuotaMb: plan.diskQuotaMb,
            maxDatabases: plan.maxDatabases,
            maxMailboxes: plan.maxMailboxes,
            mailboxQuotaMb: plan.mailboxQuotaMb,
          }
        : null,
    };
  }

  @Get(':id/mailboxes')
  @HttpCode(HttpStatus.OK)
  async listMailboxes(@Req() req: any, @Param('id') id: string) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) {
      throw new UnauthorizedException('Access denied');
    }
    return this.hosting.listMailboxes(id);
  }

  @Post(':id/mailboxes')
  @HttpCode(HttpStatus.CREATED)
  async createMailbox(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { localPart: string; password: string },
  ) {
    throw new Error('Mailbox create requires prepare and confirm');
  }

  @Post(':id/mailboxes/delete')
  @HttpCode(HttpStatus.OK)
  async deleteMailbox(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { address: string },
  ) {
    throw new Error('Mailbox delete requires prepare and confirm');
  }

  @Post(':id/mailboxes/password')
  @HttpCode(HttpStatus.OK)
  async updatePassword(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { address: string; password: string },
  ) {
    throw new Error('Mailbox password update requires prepare and confirm');
  }

  @Get(':id/databases')
  @HttpCode(HttpStatus.OK)
  async listDatabases(@Req() req: any, @Param('id') id: string) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    const databases = await this.hosting.listDatabases(id);
    return { databases };
  }

  @Post(':id/databases/password')
  @HttpCode(HttpStatus.OK)
  async resetDatabasePassword(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { password: string },
  ) {
    throw new Error('Database password reset requires prepare and confirm');
  }

  @Get(':id/ftp')
  @HttpCode(HttpStatus.OK)
  async getFtpCredentials(@Req() req: any, @Param('id') id: string) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    return this.hosting.getFtpCredentials(id);
  }

  @Post(':id/ftp/password')
  @HttpCode(HttpStatus.OK)
  async resetFtpPassword(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { password: string },
  ) {
    throw new Error('FTP password reset requires prepare and confirm');
  }

  @Post(':id/mailboxes/prepare-create')
  @HttpCode(HttpStatus.OK)
  async prepareCreateMailbox(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { localPart: string; password: string; reason?: string },
  ) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    const actor = { actorId: req.user.id, actorRole: 'CUSTOMER', actorType: 'customer', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    return this.governance.prepare({
      module: 'email',
      action: 'create_mailbox',
      targetKind: 'mailbox',
      targetKey: `${body.localPart}@${service.primaryDomain}`,
      payload: { serviceId: id, localPart: body.localPart, password: body.password } as any,
      risk: 'medium',
      reversibility: 'reversible',
      impactedSubsystems: ['mail'],
      actor,
    });
  }

  @Post(':id/mailboxes/confirm-create')
  @HttpCode(HttpStatus.OK)
  async confirmCreateMailbox(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { intentId: string; token: string },
  ) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    const intent = await this.governance.verify(body.intentId, body.token);
    if ((intent.payload as any)?.serviceId !== id) throw new Error('Intent target mismatch');
    const steps: ActionStep[] = [{ name: 'create_mailbox', status: 'SUCCESS' }];
    try {
      const payload = intent.payload as any;
      const result = await this.hosting.createMailbox(id, { localPart: payload.localPart, password: payload.password });
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'create_mailbox', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/mailboxes/prepare-delete')
  @HttpCode(HttpStatus.OK)
  async prepareDeleteMailbox(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { address: string; reason?: string },
  ) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    const actor = { actorId: req.user.id, actorRole: 'CUSTOMER', actorType: 'customer', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    return this.governance.prepare({
      module: 'email',
      action: 'delete_mailbox',
      targetKind: 'mailbox',
      targetKey: body.address,
      payload: { serviceId: id, address: body.address } as any,
      risk: 'high',
      reversibility: 'requires_restore',
      impactedSubsystems: ['mail'],
      actor,
    });
  }

  @Post(':id/mailboxes/confirm-delete')
  @HttpCode(HttpStatus.OK)
  async confirmDeleteMailbox(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { intentId: string; token: string },
  ) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    const intent = await this.governance.verify(body.intentId, body.token);
    const payload = intent.payload as any;
    if (payload?.serviceId !== id) throw new Error('Intent target mismatch');
    const steps: ActionStep[] = [{ name: 'delete_mailbox', status: 'SUCCESS' }];
    try {
      await this.hosting.deleteMailbox(id, payload.address);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result: { success: true } });
    } catch (e) {
      steps[0] = { name: 'delete_mailbox', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/mailboxes/prepare-password')
  @HttpCode(HttpStatus.OK)
  async prepareMailboxPassword(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { address: string; password: string; reason?: string },
  ) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    const actor = { actorId: req.user.id, actorRole: 'CUSTOMER', actorType: 'customer', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    return this.governance.prepare({
      module: 'email',
      action: 'update_mailbox_password',
      targetKind: 'mailbox',
      targetKey: body.address,
      payload: { serviceId: id, address: body.address, password: body.password } as any,
      risk: 'high',
      reversibility: 'requires_restore',
      impactedSubsystems: ['mail'],
      actor,
    });
  }

  @Post(':id/mailboxes/confirm-password')
  @HttpCode(HttpStatus.OK)
  async confirmMailboxPassword(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { intentId: string; token: string },
  ) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    const intent = await this.governance.verify(body.intentId, body.token);
    const payload = intent.payload as any;
    if (payload?.serviceId !== id) throw new Error('Intent target mismatch');
    const steps: ActionStep[] = [{ name: 'update_mailbox_password', status: 'SUCCESS' }];
    try {
      await this.hosting.updateMailboxPassword(id, payload.address, payload.password);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result: { success: true } });
    } catch (e) {
      steps[0] = { name: 'update_mailbox_password', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/databases/prepare-password')
  @HttpCode(HttpStatus.OK)
  async prepareDatabasePassword(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { password: string; reason?: string },
  ) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    const actor = { actorId: req.user.id, actorRole: 'CUSTOMER', actorType: 'customer', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    return this.governance.prepare({
      module: 'databases',
      action: 'reset_database_password',
      targetKind: 'mysql_account',
      targetKey: service.primaryDomain,
      payload: { serviceId: id, password: body.password } as any,
      risk: 'high',
      reversibility: 'requires_restore',
      impactedSubsystems: ['mysql'],
      actor,
    });
  }

  @Post(':id/databases/confirm-password')
  @HttpCode(HttpStatus.OK)
  async confirmDatabasePassword(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { intentId: string; token: string },
  ) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    const intent = await this.governance.verify(body.intentId, body.token);
    const payload = intent.payload as any;
    if (payload?.serviceId !== id) throw new Error('Intent target mismatch');
    const steps: ActionStep[] = [{ name: 'reset_database_password', status: 'SUCCESS' }];
    try {
      await this.hosting.resetDatabasePassword(id, payload.password);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result: { success: true } });
    } catch (e) {
      steps[0] = { name: 'reset_database_password', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/ftp/prepare-password')
  @HttpCode(HttpStatus.OK)
  async prepareFtpPassword(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { password: string; reason?: string },
  ) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    const actor = { actorId: req.user.id, actorRole: 'CUSTOMER', actorType: 'customer', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    return this.governance.prepare({
      module: 'ftp',
      action: 'reset_ftp_password',
      targetKind: 'ftp_account',
      targetKey: service.primaryDomain,
      payload: { serviceId: id, password: body.password } as any,
      risk: 'high',
      reversibility: 'requires_restore',
      impactedSubsystems: ['ftp'],
      actor,
    });
  }

  @Post(':id/ftp/confirm-password')
  @HttpCode(HttpStatus.OK)
  async confirmFtpPassword(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { intentId: string; token: string },
  ) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    const intent = await this.governance.verify(body.intentId, body.token);
    const payload = intent.payload as any;
    if (payload?.serviceId !== id) throw new Error('Intent target mismatch');
    const steps: ActionStep[] = [{ name: 'reset_ftp_password', status: 'SUCCESS' }];
    try {
      await this.hosting.resetFtpPassword(id, payload.password);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result: { success: true } });
    } catch (e) {
      steps[0] = { name: 'reset_ftp_password', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }


  @Get(':id/dns')
  @HttpCode(HttpStatus.OK)
  async listDnsRecords(@Req() req: any, @Param('id') id: string) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    const records = await this.hosting.listDnsRecords(id);
    return { records };
  }
}
