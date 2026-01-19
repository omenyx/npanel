import { Controller, Get } from '@nestjs/common';
import { ToolResolver } from './tool-resolver';

@Controller('system/tools')
export class ToolsController {
  constructor(private readonly tools: ToolResolver) {}

  @Get('status')
  async status() {
    const toolNames = [
      'id',
      'useradd',
      'usermod',
      'userdel',
      'nginx',
      'php-fpm',
      'mysql',
      'mysqladmin',
      'rndc',
      'pdnsutil',
    ];
    const results: any[] = [];
    for (const name of toolNames) {
      const status = await this.tools.statusFor(name);
      results.push(status);
    }
    return {
      tools: results,
      serverInfo: {
        defaultIpv4: '127.0.0.1',
        dnsBackend: 'PowerDNS',
        mailBackend: 'Exim4 + Dovecot',
        ftpBackend: 'System Users',
      },
    };
  }
}
