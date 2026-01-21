import {
  Controller,
  Get,
  Post,
  Body,
  BadRequestException,
  HttpException,
  HttpStatus,
  Query,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { ToolResolver } from './tool-resolver';
import { HostingService } from '../hosting/hosting.service';
import * as os from 'os';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { stat } from 'fs/promises';
import { JwtAuthGuard } from '../iam/jwt-auth.guard';
import { RolesGuard } from '../iam/roles.guard';
import { Roles } from '../iam/roles.decorator';
import { GovernanceService } from '../governance/governance.service';
import type { ActionStep } from '../governance/governance.service';

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
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class ToolsController {
  private readonly logger = new Logger(ToolsController.name);

  constructor(
    private readonly toolResolver: ToolResolver,
    private readonly hostingService: HostingService, // Inject HostingService
    private readonly governance: GovernanceService,
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
      'userdel',
      'quota', // Add quota to the list
      'pure-pw',
      'doveadm',
    ];

    const results = {};
    for (const tool of tools) {
      const status = await this.toolResolver.statusFor(tool);
      results[tool] = status.available;
    }

    const mailCmd = process.env.NPANEL_MAIL_CMD;
    if (typeof mailCmd === 'string' && mailCmd.length > 0) {
      const status = await this.toolResolver.statusFor(mailCmd);
      results['mail_cmd'] = status.available;
    } else {
      results['mail_cmd'] = false;
    }
    const ftpCmd = process.env.NPANEL_FTP_CMD;
    if (typeof ftpCmd === 'string' && ftpCmd.length > 0) {
      const status = await this.toolResolver.statusFor(ftpCmd);
      results['ftp_cmd'] = status.available;
    } else {
      results['ftp_cmd'] = false;
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
      this.logger.error(`Failed to get disk usage: ${e instanceof Error ? e.message : String(e)}`);
    }

    return {
      tools: results,
      serverInfo: {
        defaultIpv4: '127.0.0.1',
        dnsBackend: 'PowerDNS',
        mailBackend: 'Exim + Dovecot',
        ftpBackend: 'Pure-FTPd',
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
  restartService() {
    throw new BadRequestException(
      'Restart service requires prepare and confirm',
    );
  }

  @Post('restart-service/prepare')
  async restartServicePrepare(
    @Body('service') service: string,
    @Body('reason') reason: string | undefined,
    @Req() req: Request,
  ) {
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
    const actor = {
      actorId: (req as any)?.user?.id,
      actorRole: 'ADMIN',
      actorType: 'admin',
      reason: typeof reason === 'string' ? reason : undefined,
    };
    return this.governance.prepare({
      module: 'system',
      action: 'restart_service',
      targetKind: 'system_service',
      targetKey: serviceName,
      payload: { service: serviceName } as any,
      risk: 'high',
      reversibility: 'reversible',
      impactedSubsystems: ['systemd'],
      actor,
    });
  }

  @Post('restart-service/confirm')
  async restartServiceConfirm(
    @Body() body: { intentId: string; token: string },
    @Req() req: any,
  ) {
    const actor = {
      actorId: req?.user?.id,
      actorRole: 'ADMIN',
      actorType: 'admin',
    };
    const intent = await this.governance.verifyWithActor(
      body.intentId,
      body.token,
      actor,
    );
    const serviceName = (intent.payload as any)?.service as string;
    const steps: ActionStep[] = [
      { name: 'systemctl_restart', status: 'SKIPPED' },
      { name: 'service_restart_fallback', status: 'SKIPPED' },
    ];
    try {
      await execFileAsync('systemctl', ['restart', serviceName]);
      steps[0] = { name: 'systemctl_restart', status: 'SUCCESS' };
      return this.governance.recordResult({
        intent,
        status: 'SUCCESS',
        steps,
        result: { success: true, message: `Service ${serviceName} restarted.` },
      });
    } catch (error) {
      steps[0] = {
        name: 'systemctl_restart',
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      try {
        await execFileAsync('service', [serviceName, 'restart']);
        steps[1] = { name: 'service_restart_fallback', status: 'SUCCESS' };
        return this.governance.recordResult({
          intent,
          status: 'PARTIAL_SUCCESS',
          steps,
          result: {
            success: true,
            message: `Service ${serviceName} restarted.`,
          },
        });
      } catch (secondError) {
        steps[1] = {
          name: 'service_restart_fallback',
          status: 'FAILED',
          errorMessage:
            secondError instanceof Error
              ? secondError.message
              : String(secondError),
        };
        return this.governance.recordResult({
          intent,
          status: 'FAILED',
          steps,
          errorMessage: steps[1].errorMessage ?? steps[0].errorMessage ?? null,
        });
      }
    }
  }

  @Get('logs/files')
  async getLogFiles() {
    const candidates = [
      // System
      '/var/log/syslog', // Debian/Ubuntu
      '/var/log/messages', // RHEL/CentOS/Alma
      '/var/log/auth.log', // Debian/Ubuntu
      '/var/log/secure', // RHEL/CentOS/Alma
      '/var/log/cron', // RHEL/CentOS/Alma
      '/var/log/dmesg', // Kernel
      '/var/log/boot.log', // Boot

      // Web Server (Nginx)
      '/var/log/nginx/access.log',
      '/var/log/nginx/error.log',

      // Web Server (Apache/Httpd - if applicable)
      '/var/log/apache2/access.log', // Debian/Ubuntu
      '/var/log/apache2/error.log', // Debian/Ubuntu
      '/var/log/httpd/access_log', // RHEL/CentOS/Alma
      '/var/log/httpd/error_log', // RHEL/CentOS/Alma

      // Database
      '/var/log/mysql/error.log', // MySQL
      '/var/log/mariadb/mariadb.log', // MariaDB
      '/var/log/postgresql/postgresql.log', // Postgres (often versioned dir though)

      // Mail
      '/var/log/mail.log', // General mail
      '/var/log/maillog', // RHEL/CentOS/Alma
      '/var/log/exim4/mainlog', // Exim (Debian)
      '/var/log/exim/main.log', // Exim (RHEL)

      // Npanel
      '/var/log/npanel-backend.log',
      '/var/log/npanel-frontend.log',
      '/var/log/npanel.log',
    ];
    const available: string[] = [];
    for (const p of candidates) {
      try {
        const s = await stat(p);
        if (s.isFile()) available.push(p);
      } catch {
        // File doesn't exist or is not accessible
      }
    }
    return { files: available };
  }

  @Get('logs/content')
  async getLogContent(@Query('path') path: string) {
    if (!path || !path.startsWith('/var/log/') || path.includes('..')) {
      throw new BadRequestException('Invalid log path');
    }
    try {
      // Use tail to get last 200 lines
      const { stdout } = await execFileAsync('tail', ['-n', '200', path]);
      return { content: stdout };
    } catch (e) {
      throw new HttpException(
        `Failed to read log: ${e instanceof Error ? e.message : e}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
