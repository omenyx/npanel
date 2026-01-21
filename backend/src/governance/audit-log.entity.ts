import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'audit_logs' })
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  module: string;

  @Column()
  action: string;

  @Column({ type: 'varchar', length: 16 })
  phase: 'initiation' | 'validation' | 'confirmation' | 'execution' | 'result';

  @Column()
  targetKind: string;

  @Column()
  targetKey: string;

  @Column({ type: 'varchar', length: 16 })
  outcome: 'success' | 'partial' | 'failed';

  @Column({ type: 'varchar', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', nullable: true })
  actorRole: string | null;

  @Column({ type: 'varchar', nullable: true })
  actorType: string | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'json', nullable: true })
  details: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
