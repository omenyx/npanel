import {
  Body,
  Controller,
  Delete,
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
import { CreateHostingPlanDto } from './dto/create-hosting-plan.dto';
import { JwtAuthGuard } from '../iam/jwt-auth.guard';
import { RolesGuard } from '../iam/roles.guard';
import { Roles } from '../iam/roles.decorator';
import { GovernanceService } from '../governance/governance.service';
import type { ActionStep } from '../governance/governance.service';

@Controller('v1/hosting/plans')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class HostingPlansController {
  constructor(
    private readonly hosting: HostingService,
    private readonly governance: GovernanceService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list() {
    return this.hosting.listPlans();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateHostingPlanDto) {
    throw new Error('Create plan requires prepare and confirm');
  }

  @Delete(':name')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('name') name: string) {
    throw new Error('Delete plan requires prepare and confirm');
  }

  @Post('prepare-create')
  @HttpCode(HttpStatus.OK)
  async prepareCreate(@Body() body: CreateHostingPlanDto, @Req() req: Request) {
    const actor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    await this.hosting.getPlan(body?.name ?? '');
    return this.governance.prepare({
      module: 'hosting_plans',
      action: 'create_plan',
      targetKind: 'hosting_plan',
      targetKey: body.name,
      payload: body as any,
      risk: 'medium',
      reversibility: 'reversible',
      impactedSubsystems: ['control_plane_db'],
      actor,
    });
  }

  @Post('confirm-create')
  @HttpCode(HttpStatus.OK)
  async confirmCreate(@Body() body: { intentId: string; token: string }, @Req() req: Request) {
    const actor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    const intent = await this.governance.verifyWithActor(body.intentId, body.token, actor);
    const steps: ActionStep[] = [{ name: 'create_plan', status: 'SUCCESS' }];
    try {
      const result = await this.hosting.createPlan(intent.payload as any);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'create_plan', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post(':name/prepare-delete')
  @HttpCode(HttpStatus.OK)
  async prepareDelete(@Param('name') name: string, @Body() body: any, @Req() req: Request) {
    const actor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    await this.hosting.getPlan(name);
    return this.governance.prepare({
      module: 'hosting_plans',
      action: 'delete_plan',
      targetKind: 'hosting_plan',
      targetKey: name,
      payload: { name } as any,
      risk: 'high',
      reversibility: 'requires_restore',
      impactedSubsystems: ['control_plane_db', 'hosting_services'],
      actor,
    });
  }

  @Post(':name/confirm-delete')
  @HttpCode(HttpStatus.OK)
  async confirmDelete(@Param('name') name: string, @Body() body: { intentId: string; token: string }, @Req() req: Request) {
    const actor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    const intent = await this.governance.verifyWithActor(body.intentId, body.token, actor);
    if (intent.targetKey !== name) {
      throw new Error('Intent target mismatch');
    }
    const steps: ActionStep[] = [{ name: 'delete_plan', status: 'SUCCESS' }];
    try {
      const result = await this.hosting.deletePlan(name);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result });
    } catch (e) {
      steps[0] = { name: 'delete_plan', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }
}
