import { Controller, Get, Post, Body, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { ToolResolver } from './tool-resolver';
import { HostingService } from '../hosting/hosting.service';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

    // System Stats
    const loadAvg = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const uptime = os.uptime();

    let disk = { total: 0, used: 0, free: 0, percent: 0 };
    try {
      // Get disk usage for root partition
      const { stdout } = await execAsync('df -B1 /');
      const lines = stdout.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        if (parts.length >= 4) {
          const total = parseInt(parts[1], 10);
          const used = parseInt(parts[2], 10);
          const free = parseInt(parts[3], 10);
          disk = {
            total,
            used,
            free,
            percent: total > 0 ? Math.round((used / total) * 100) : 0,
          };
        }
      }
    } catch (e) {
      console.error('Failed to get disk usage', e);
    }

    return {
      tools: results,
      serverInfo: {
        defaultIpv4: '127.0.0.1',
        dnsBackend: 'PowerDNS',
        mailBackend: 'Exim4 + Dovecot',
        ftpBackend: 'System Users',
      },
      quotaStatus, // Expose detailed quota status
      systemStats: {
        loadAvg,
        memory: {
          total: totalMem,
          used: usedMem,
          free: freeMem,
          percent: Math.round((usedMem / totalMem) * 100),
        },
        disk,
        uptime,
      },
    };
  }

  @Post('restart-service')
  async restartService(@Body('service') service: string) {
    const allowedServices = [
      'nginx',
      'php8.2-fpm', // Adjust based on actual service name
      'php-fpm',
      'mysql',
      'mariadb',
      'pdns',
      'pdns-server',
      'exim4',
      'dovecot',
      'ssh',
      'sshd',
      'npanel-backend',
    ];

    if (!allowedServices.includes(service)) {
      throw new BadRequestException(`Service '${service}' is not allowed to be restarted via this endpoint.`);
    }

    // Map friendly names to actual systemd service names if needed
    let serviceName = service;
    if (service === 'php-fpm') serviceName = 'php8.2-fpm'; // Default to 8.2 or detect
    if (service === 'mysql') serviceName = 'mysql';
    if (service === 'pdns_server') serviceName = 'pdns';

    try {
      // In a real environment, this might need sudo. 
      // Assuming the process runs as root or has sudoers NOPASSWD for systemctl.
      // For WSL, we might need 'wsl -u root' if running from outside, but this code runs INSIDE the backend.
      // If backend runs as root (common in simple VPS panels), this works.
      await execAsync(`systemctl restart ${serviceName}`);
      return { success: true, message: `Service ${serviceName} restarted.` };
    } catch (error) {
      throw new HttpException(
        `Failed to restart service ${serviceName}: ${error instanceof Error ? error.message : error}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
