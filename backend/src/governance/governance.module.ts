import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActionIntentEntity } from './action-intent.entity';
import { AuditLogEntity } from './audit-log.entity';
import { GovernanceService } from './governance.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ActionIntentEntity, AuditLogEntity])],
  providers: [GovernanceService],
  exports: [GovernanceService],
})
export class GovernanceModule {}
