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
  UseGuards,
} from '@nestjs/common';
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

@Controller('v1/dns')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class DnsController {
  constructor(
    @Inject(DNS_ADAPTER) private readonly dns: DnsAdapter,
    private readonly hosting: HostingService, // Inject hosting service to use its logging capability if possible, or just mock context
  ) {}

  // Helper to create context. Ideally this should come from HostingService or a factory.
  // For now we create a simple one.
  private createContext(): AdapterContext {
    return {
      dryRun: false,
      log: (entry: AdapterLogEntry) => {
        // In a real implementation, we might want to save this log to DB via HostingService
        // But since we don't have a serviceId, we just console log for now
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
    await this.dns.ensureZonePresent(this.createContext(), spec);
    return { success: true };
  }

  @Post('zones/:name')
  @HttpCode(HttpStatus.OK)
  async updateZone(@Param('name') name: string, @Body() body: { records: any[] }) {
    const spec: DnsZoneSpec = {
      zoneName: name,
      records: body.records,
    };
    await this.dns.ensureZonePresent(this.createContext(), spec);
    return { success: true };
  }

  @Delete('zones/:name')
  @HttpCode(HttpStatus.OK)
  async deleteZone(@Param('name') name: string) {
    await this.dns.ensureZoneAbsent(this.createContext(), name);
    return { success: true };
  }
}
