import { Controller, Get, Post, Body, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { ToolResolver } from './tool-resolver';
import { HostingService } from '../hosting/hosting.service';
import * as os from 'os';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function parseAllowedServicesFromEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function sanitizeServiceName(value: string): string {
  if (!/^[a-zA-Z0-9@._-]+$/.test(value)) {
    throw new BadRequestException('invalid_service_name');
  }
  return value;
}

function normalizeServiceName(value: string): string {
  const service = sanitizeServiceName(value);
  if (service === 'php-fpm') return 'php8.2-fpm';
  if (service === 'pdns_server') return 'pdns';
  if (service === 'pdns-server') return 'pdns';
  if (service === 'sshd') return 'ssh';
  return service;
}

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
      'php8.1-fpm',
      'php8.3-fpm',
      'php-fpm',
      'mysql',
      'mariadb',
      'pdns',
      'pdns-server',
      'pdns_server',
      'exim4',
      'postfix',
      'dovecot',
      'dovecot-imapd',
      'dovecot-pop3d',
      'rspamd',
      'ssh',
      'sshd',
      'npanel-backend',
      'npanel-frontend',
      'redis',
      'redis-server',
      'fail2ban',
      'ufw',
      'cron',
      'crond',
      'bind9',
      'named',
    ];
    const envAllowed = parseAllowedServicesFromEnv(
      process.env.NPANEL_ALLOWED_RESTART_SERVICES,
    );
    const allowedSet = new Set<string>([...allowedServices, ...envAllowed]);
    const requestedService = sanitizeServiceName(service);

    if (!allowedSet.has(requestedService)) {
      throw new BadRequestException(
        `Service '${requestedService}' is not allowed to be restarted via this endpoint.`,
      );
    }

    const serviceName = normalizeServiceName(requestedService);

    try {
      await execFileAsync('systemctl', ['restart', serviceName]);
      return { success: true, message: `Service ${serviceName} restarted.` };
    } catch (error) {
      try {
        await execFileAsync('service', [serviceName, 'restart']);
        return { success: true, message: `Service ${serviceName} restarted.` };
      } catch (secondError) {
        const message =
          secondError instanceof Error
            ? secondError.message
            : error instanceof Error
              ? error.message
              : String(error);
        throw new HttpException(
          `Failed to restart service ${serviceName}: ${message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
  }
}
