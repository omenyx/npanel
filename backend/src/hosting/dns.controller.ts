import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/jwt-auth.guard';
import { RolesGuard } from '../iam/roles.guard';
import { Roles } from '../iam/roles.decorator';
import {
  DNS_ADAPTER,
  DnsAdapter,
  DnsZoneSpec,
  AdapterContext,
  AdapterLogEntry,
} from './hosting-adapters';
import { HostingService } from './hosting.service';
import { GovernanceService } from '../governance/governance.service';
import type { ActionStep } from '../governance/governance.service';

@Controller('v1/dns')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class DnsController {
  constructor(
    @Inject(DNS_ADAPTER) private readonly dns: DnsAdapter,
    private readonly hosting: HostingService, // Inject hosting service to use its logging capability if possible, or just mock context
    private readonly governance: GovernanceService,
  ) {}

  // Helper to create context. Ideally this should come from HostingService or a factory.
  // For now we create a simple one.
  private createContext(): AdapterContext {
    return {
      dryRun: process.env.NPANEL_HOSTING_DRY_RUN === '1',
      log: (entry: AdapterLogEntry) => {
        console.log(`[DNS] ${entry.operation} ${entry.targetKey}: ${entry.success ? 'OK' : 'FAIL'}`);
      },
    };
  }

  @Get('zones')
  @HttpCode(HttpStatus.OK)
  async listZones() {
    const zones = await this.dns.listZones(this.createContext());
    return { zones };
  }

  @Get('zones/:name')
  @HttpCode(HttpStatus.OK)
  async getZone(@Param('name') name: string) {
    const records = await this.dns.listRecords(this.createContext(), name);
    return { zone: name, records };
  }

  @Post('zones')
  @HttpCode(HttpStatus.CREATED)
  async createZone(@Body() spec: DnsZoneSpec) {
    throw new Error('DNS zone create requires prepare and confirm');
  }

  @Post('zones/:name')
  @HttpCode(HttpStatus.OK)
  async updateZone(@Param('name') name: string, @Body() body: { records: any[] }) {
    throw new Error('DNS zone update requires prepare and confirm');
  }

  @Delete('zones/:name')
  @HttpCode(HttpStatus.OK)
  async deleteZone(@Param('name') name: string) {
    throw new Error('DNS zone delete requires prepare and confirm');
  }

  @Post('zones/prepare-create')
  @HttpCode(HttpStatus.OK)
  async prepareCreateZone(@Body() spec: DnsZoneSpec, @Req() req: Request) {
    const actor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    return this.governance.prepare({
      module: 'dns',
      action: 'create_zone',
      targetKind: 'dns_zone',
      targetKey: spec.zoneName,
      payload: spec as any,
      risk: 'high',
      reversibility: 'reversible',
      impactedSubsystems: ['dns_server'],
      actor,
    });
  }

  @Post('zones/confirm-create')
  @HttpCode(HttpStatus.OK)
  async confirmCreateZone(@Body() body: { intentId: string; token: string }, @Req() req: Request) {
    const actor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    const intent = await this.governance.verifyWithActor(body.intentId, body.token, actor);
    const steps: ActionStep[] = [{ name: 'apply_dns_zone', status: 'SUCCESS' }];
    try {
      await this.dns.ensureZonePresent(this.createContext(), intent.payload as any);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result: { success: true } });
    } catch (e) {
      steps[0] = { name: 'apply_dns_zone', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post('zones/:name/prepare-update')
  @HttpCode(HttpStatus.OK)
  async prepareUpdateZone(@Param('name') name: string, @Body() body: { records: any[]; reason?: string }, @Req() req: Request) {
    const actor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    const spec: DnsZoneSpec = { zoneName: name, records: body.records };
    return this.governance.prepare({
      module: 'dns',
      action: 'update_zone',
      targetKind: 'dns_zone',
      targetKey: name,
      payload: spec as any,
      risk: 'high',
      reversibility: 'reversible',
      impactedSubsystems: ['dns_server'],
      actor,
    });
  }

  @Post('zones/:name/confirm-update')
  @HttpCode(HttpStatus.OK)
  async confirmUpdateZone(@Param('name') name: string, @Body() body: { intentId: string; token: string }, @Req() req: Request) {
    const actor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    const intent = await this.governance.verifyWithActor(body.intentId, body.token, actor);
    if (intent.targetKey !== name) throw new Error('Intent target mismatch');
    const steps: ActionStep[] = [{ name: 'apply_dns_zone', status: 'SUCCESS' }];
    try {
      await this.dns.ensureZonePresent(this.createContext(), intent.payload as any);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result: { success: true } });
    } catch (e) {
      steps[0] = { name: 'apply_dns_zone', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post('zones/:name/prepare-delete')
  @HttpCode(HttpStatus.OK)
  async prepareDeleteZone(@Param('name') name: string, @Body() body: any, @Req() req: Request) {
    const actor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin', reason: typeof body?.reason === 'string' ? body.reason : undefined };
    return this.governance.prepare({
      module: 'dns',
      action: 'delete_zone',
      targetKind: 'dns_zone',
      targetKey: name,
      payload: { zoneName: name } as any,
      risk: 'high',
      reversibility: 'requires_restore',
      impactedSubsystems: ['dns_server'],
      actor,
    });
  }

  @Post('zones/:name/confirm-delete')
  @HttpCode(HttpStatus.OK)
  async confirmDeleteZone(@Param('name') name: string, @Body() body: { intentId: string; token: string }, @Req() req: Request) {
    const actor = { actorId: (req as any)?.user?.id, actorRole: 'ADMIN', actorType: 'admin' };
    const intent = await this.governance.verifyWithActor(body.intentId, body.token, actor);
    if (intent.targetKey !== name) throw new Error('Intent target mismatch');
    const steps: ActionStep[] = [{ name: 'remove_dns_zone', status: 'SUCCESS' }];
    try {
      await this.dns.ensureZoneAbsent(this.createContext(), name);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result: { success: true } });
    } catch (e) {
      steps[0] = { name: 'remove_dns_zone', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }
}
