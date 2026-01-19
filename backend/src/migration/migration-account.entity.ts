import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MigrationJob } from './migration-job.entity';
import { MigrationStep } from './migration-step.entity';

@Entity({ name: 'migration_accounts' })
export class MigrationAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => MigrationJob, (job) => job.accounts, { onDelete: 'CASCADE' })
  job: MigrationJob;

  @Column()
  sourceUsername: string;

  @Column()
  sourcePrimaryDomain: string;

  @Column({ type: 'varchar', nullable: true })
  targetCustomerId: string | null;

  @Column({ type: 'varchar', nullable: true })
  targetServiceId: string | null;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => MigrationStep, (step) => step.account)
  steps: MigrationStep[];
}
