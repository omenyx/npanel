import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HostingServiceEntity } from './hosting-service.entity';
import { HostingService } from './hosting.service';
import { HostingController } from './hosting.controller';
import { DnsController } from './dns.controller';
import { CustomerHostingController } from './customer-hosting.controller';
import { HostingPlansController } from './hosting-plans.controller';
import { SystemController } from '../system/system.controller';
import { AccountsModule } from '../accounts/accounts.module';
import {
  DNS_ADAPTER,
  FTP_ADAPTER,
  MAIL_ADAPTER,
  MYSQL_ADAPTER,
  PHP_FPM_ADAPTER,
  USER_ADAPTER,
  WEB_SERVER_ADAPTER,
  NoopDnsAdapter,
  NoopFtpAdapter,
  NoopMailAdapter,
  NoopMysqlAdapter,
  NoopPhpFpmAdapter,
  NoopUserAdapter,
  NoopWebServerAdapter,
} from './hosting-adapters';
import { ShellUserAdapter } from './hosting-shell-user.adapter';
import { HostingLog } from './hosting-log.entity';
import { HostingPlan } from './hosting-plan.entity';
import { ShellWebServerAdapter } from './hosting-shell-web.adapter';
import { ShellPhpFpmAdapter } from './hosting-shell-php-fpm.adapter';
import { ShellMysqlAdapter } from './hosting-shell-mysql.adapter';
import { ToolResolver } from '../system/tool-resolver';
import { ShellDnsAdapter } from './hosting-shell-dns.adapter';
import { ShellMailAdapter } from './hosting-shell-mail.adapter';
import { ShellFtpAdapter } from './hosting-shell-ftp.adapter';
import { HostingCredentialsService } from './hosting-credentials.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([HostingServiceEntity, HostingLog, HostingPlan]),
    AccountsModule,
  ],
  providers: [
    HostingCredentialsService,
    ToolResolver,
    HostingService,
    {
      provide: USER_ADAPTER,
      useClass:
        process.env.NPANEL_HOSTING_USER_ADAPTER === 'shell'
          ? ShellUserAdapter
          : NoopUserAdapter,
    },
    {
      provide: WEB_SERVER_ADAPTER,
      useClass:
        process.env.NPANEL_HOSTING_WEB_ADAPTER === 'shell'
          ? ShellWebServerAdapter
          : NoopWebServerAdapter,
    },
    {
      provide: PHP_FPM_ADAPTER,
      useClass:
        process.env.NPANEL_HOSTING_PHP_FPM_ADAPTER === 'shell'
          ? ShellPhpFpmAdapter
          : NoopPhpFpmAdapter,
    },
    {
      provide: MYSQL_ADAPTER,
      useClass:
        process.env.NPANEL_HOSTING_MYSQL_ADAPTER === 'shell'
          ? ShellMysqlAdapter
          : NoopMysqlAdapter,
    },
    {
      provide: DNS_ADAPTER,
      useClass:
        process.env.NPANEL_HOSTING_DNS_ADAPTER === 'shell'
          ? ShellDnsAdapter
          : NoopDnsAdapter,
    },
    {
      provide: MAIL_ADAPTER,
      useClass:
        process.env.NPANEL_HOSTING_MAIL_ADAPTER === 'shell'
          ? ShellMailAdapter
          : NoopMailAdapter,
    },
    {
      provide: FTP_ADAPTER,
      useClass:
        process.env.NPANEL_HOSTING_FTP_ADAPTER === 'shell'
          ? ShellFtpAdapter
          : NoopFtpAdapter,
    },
  ],
  controllers: [
    HostingController,
    DnsController,
    CustomerHostingController,
    HostingPlansController,
    SystemController,
  ],
  exports: [HostingService],
})
export class HostingModule {}
