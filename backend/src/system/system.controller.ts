import {
  Controller,
  Get,
  UseGuards,
  InternalServerErrorException,
} from '@nestjs/common';
import { ToolResolver } from './tool-resolver';
import { JwtAuthGuard } from '../iam/jwt-auth.guard';
import { RolesGuard } from '../iam/roles.guard';
import { Roles } from '../iam/roles.decorator';
import { readFile, access, mkdir } from 'fs/promises';
import { constants } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Controller('system/tools')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class SystemController {
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
      'rsync',
    ];
    const results: any[] = [];
    for (const name of toolNames) {
      try {
        const status = await this.tools.statusFor(name);
        results.push(status);
      } catch {
        // If tool not found in resolver list (e.g. rsync might need adding to resolver check list)
        // We still want to return what we have
        results.push({
          name,
          path: null,
          status: 'missing',
          error: 'not_checked',
        });
      }
    }
    return {
      tools: results,
      serverInfo: {
        defaultIpv4: process.env.NPANEL_HOSTING_DEFAULT_IPV4 || 'Unknown',
        dnsBackend:
          process.env.NPANEL_HOSTING_DNS_ADAPTER === 'shell'
            ? 'PowerDNS (Shell)'
            : 'None',
        mailBackend:
          process.env.NPANEL_HOSTING_MAIL_ADAPTER === 'shell'
            ? 'Available'
            : 'None',
        ftpBackend:
          process.env.NPANEL_HOSTING_FTP_ADAPTER === 'shell'
            ? 'Available'
            : 'None',
      },
    };
  }

  @Get('ssh-key')
  async getSshKey() {
    const sshDir = join(homedir(), '.ssh');
    const privateKeyPath = join(sshDir, 'id_rsa');
    const publicKeyPath = join(sshDir, 'id_rsa.pub');

    try {
      // Check if public key exists
      try {
        await access(publicKeyPath, constants.R_OK);
      } catch {
        // If not, ensure .ssh dir exists and generate key
        await mkdir(sshDir, { recursive: true, mode: 0o700 });

        // Check if private key exists (partial state)
        try {
          await access(privateKeyPath, constants.F_OK);
          // Private exists but public missing? unexpected but handleable by regenerating public
          await execAsync(
            `ssh-keygen -y -f "${privateKeyPath}" > "${publicKeyPath}"`,
          );
        } catch {
          // Neither exists, generate new pair
          // -t rsa -b 4096 -N "" (no passphrase) -f path
          await execAsync(
            `ssh-keygen -t rsa -b 4096 -N "" -f "${privateKeyPath}"`,
          );
        }
      }

      const keyContent = await readFile(publicKeyPath, 'utf8');
      return { publicKey: keyContent.trim() };
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to retrieve or generate SSH key: ${error.message}`,
      );
    }
  }
}
