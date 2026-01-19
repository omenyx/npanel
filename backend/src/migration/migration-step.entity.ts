import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MigrationJob } from './migration-job.entity';
import { MigrationAccount } from './migration-account.entity';
import type { MigrationStepStatus } from './migration-step-status.enum';

@Entity({ name: 'migration_steps' })
export class MigrationStep {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => MigrationJob, (job) => job.steps, { onDelete: 'CASCADE' })
  job: MigrationJob;

  @ManyToOne(() => MigrationAccount, (account) => account.steps, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  account: MigrationAccount | null;

  @Column()
  name: string;

  @Column({ type: 'varchar', length: 32 })
  status: MigrationStepStatus;

  @Column({ type: 'json', nullable: true })
  payload: Record<string, any> | null;

  @Column({ type: 'json', nullable: true })
  lastError: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
