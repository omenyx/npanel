import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MigrationAccount } from './migration-account.entity';
import { MigrationStep } from './migration-step.entity';
import type { MigrationJobStatus } from './migration-job-status.enum';

@Entity({ name: 'migration_jobs' })
export class MigrationJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', nullable: true })
  customerId: string | null;

  @Column()
  name: string;

  @Column({ type: 'varchar', length: 32 })
  sourceType: 'cpanel_backup' | 'cpanel_live_ssh';

  @Column({ type: 'varchar', length: 32 })
  status: MigrationJobStatus;

  @Column({ type: 'text', nullable: true })
  sourceConfig: string | null;

  @Column({ type: 'boolean', default: false })
  dryRun: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => MigrationAccount, (account) => account.job)
  accounts: MigrationAccount[];

  @OneToMany(() => MigrationStep, (step) => step.job)
  steps: MigrationStep[];
}
