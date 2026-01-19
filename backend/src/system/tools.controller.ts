import { Controller, Get } from '@nestjs/common';
import { ToolResolver } from './tool-resolver';
import { HostingService } from '../hosting/hosting.service';

@Controller('system/tools')
export class ToolsController {
  constructor(
    private readonly toolResolver: ToolResolver,
    private readonly hostingService: HostingService, // Inject HostingService
  ) {}

  @Get('status')
  async getStatus() {
    const tools = [
      'nginx',
      'php',
      'mysql',
      'pdns_server',
      'git',
      'curl',
      'unzip',
      'certbot',
      'ufw',
      'useradd',
      'quota', // Add quota to the list
    ];

    const results = {};
    for (const tool of tools) {
      const status = await this.toolResolver.statusFor(tool);
      results[tool] = status.available;
    }

    // Get enhanced quota status
    const quotaStatus = await this.hostingService.verifyQuotaSupport();

    return {
      tools: results,
      serverInfo: {
        defaultIpv4: '127.0.0.1',
        dnsBackend: 'PowerDNS',
        mailBackend: 'Exim4 + Dovecot',
        ftpBackend: 'System Users',
      },
      quotaStatus, // Expose detailed quota status
    };
  }
}
