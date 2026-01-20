import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IamModule } from './iam/iam.module';
import { HealthModule } from './health/health.module';
import { MigrationModule } from './migration/migration.module';
import { AccountsModule } from './accounts/accounts.module';
import { HostingModule } from './hosting/hosting.module';
import { SystemModule } from './system/system.module';
import { GovernanceModule } from './governance/governance.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: 'npanel.sqlite',
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: true,
    }),
    IamModule,
    HealthModule,
    MigrationModule,
    AccountsModule,
    HostingModule,
    SystemModule,
    GovernanceModule,
  ],
})
export class AppModule {}
