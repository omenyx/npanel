import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccountsService } from './accounts.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { JwtAuthGuard } from '../iam/jwt-auth.guard';
import { RolesGuard } from '../iam/roles.guard';
import { Roles } from '../iam/roles.decorator';
import { GovernanceService } from '../governance/governance.service';
import type { ActionStep } from '../governance/governance.service';

@Controller('v1/customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly governance: GovernanceService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list() {
    const customers = await this.accounts.list();
    return customers;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req: Request & { user?: { id?: string } },
    @Body() body: CreateCustomerDto,
  ) {
    throw new Error('Create customer requires prepare and confirm');
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async get(@Param('id') id: string) {
    const customer = await this.accounts.get(id);
    return customer;
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() body: UpdateCustomerDto) {
    throw new Error('Update customer requires prepare and confirm');
  }

  @Post('prepare-create')
  @HttpCode(HttpStatus.OK)
  async prepareCreate(
    @Req() req: Request & { user?: { id?: string } },
    @Body() body: CreateCustomerDto & { reason?: string },
  ) {
    const actor = { actorId: req.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    return this.governance.prepare({
      module: 'accounts',
      action: 'create_customer',
      targetKind: 'customer',
      targetKey: body.email,
      payload: body as any,
      risk: 'medium',
      reversibility: 'reversible',
      impactedSubsystems: ['control_plane_db'],
      actor,
    });
  }

  @Post('confirm-create')
  @HttpCode(HttpStatus.OK)
  async confirmCreate(
    @Req() req: Request & { user?: { id?: string } },
    @Body() body: { intentId: string; token: string },
  ) {
    const intent = await this.governance.verify(body.intentId, body.token);
    const ownerUserId = req.user?.id ?? '';
    const steps: ActionStep[] = [{ name: 'create_customer', status: 'SUCCESS' }];
    try {
      const result = await this.accounts.create(ownerUserId, intent.payload as any);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'create_customer', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':id/prepare-update')
  @HttpCode(HttpStatus.OK)
  async prepareUpdate(
    @Req() req: Request & { user?: { id?: string } },
    @Param('id') id: string,
    @Body() body: UpdateCustomerDto & { reason?: string },
  ) {
    const actor = { actorId: req.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    await this.accounts.get(id);
    return this.governance.prepare({
      module: 'accounts',
      action: 'update_customer',
      targetKind: 'customer',
      targetKey: id,
      payload: { id, ...body } as any,
      risk: 'medium',
      reversibility: 'reversible',
      impactedSubsystems: ['control_plane_db'],
      actor,
    });
  }

  @Post(':id/confirm-update')
  @HttpCode(HttpStatus.OK)
  async confirmUpdate(
    @Param('id') id: string,
    @Body() body: { intentId: string; token: string },
  ) {
    const intent = await this.governance.verify(body.intentId, body.token);
    const payload = intent.payload as any;
    if (payload?.id !== id) throw new Error('Intent target mismatch');
    const steps: ActionStep[] = [{ name: 'update_customer', status: 'SUCCESS' }];
    try {
      const result = await this.accounts.update(id, payload as any);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'update_customer', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }
}
