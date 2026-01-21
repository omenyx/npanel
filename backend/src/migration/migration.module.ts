import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MigrationJob } from './migration-job.entity';
import { MigrationAccount } from './migration-account.entity';
import { MigrationStep } from './migration-step.entity';
import { MigrationLog } from './migration-log.entity';
import { MigrationService } from './migration.service';
import { MigrationController } from './migration.controller';
import { CustomerMigrationController } from './customer-migration.controller';
import { MigrationSourceController } from './migration-source.controller';
import { SystemModule } from '../system/system.module';
import { HostingModule } from '../hosting/hosting.module';
import { AccountsModule } from '../accounts/accounts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MigrationJob,
      MigrationAccount,
      MigrationStep,
      MigrationLog,
    ]),
    SystemModule,
    HostingModule,
    AccountsModule,
  ],
  controllers: [
    MigrationController,
    CustomerMigrationController,
    MigrationSourceController,
  ],
  providers: [MigrationService],
})
export class MigrationModule {}
