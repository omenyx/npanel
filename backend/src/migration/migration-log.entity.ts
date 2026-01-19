import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MigrationJob } from './migration-job.entity';
import { MigrationAccount } from './migration-account.entity';

@Entity({ name: 'migration_logs' })
export class MigrationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => MigrationJob, { onDelete: 'CASCADE' })
  job: MigrationJob;

  @ManyToOne(() => MigrationAccount, { nullable: true, onDelete: 'CASCADE' })
  account: MigrationAccount | null;

  @Column({ type: 'varchar', length: 16 })
  level: 'info' | 'warning' | 'error';

  @Column()
  message: string;

  @Column({ type: 'json', nullable: true })
  context: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;
}
