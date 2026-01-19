import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'host_logs' })
export class HostingLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  serviceId: string;

  @Column()
  adapter: string;

  @Column()
  operation: string;

  @Column()
  targetKind: string;

  @Column()
  targetKey: string;

  @Column()
  success: boolean;

  @Column()
  dryRun: boolean;

  @Column({ type: 'json', nullable: true })
  details: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
