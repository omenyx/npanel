import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'action_intents' })
export class ActionIntentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  module: string;

  @Column()
  action: string;

  @Column()
  targetKind: string;

  @Column()
  targetKey: string;

  @Column({ type: 'json' })
  payload: Record<string, unknown>;

  @Column({ type: 'varchar', length: 16 })
  risk: 'low' | 'medium' | 'high';

  @Column({ type: 'varchar', length: 32 })
  reversibility: 'reversible' | 'requires_restore' | 'irreversible';

  @Column({ type: 'varchar', length: 16, default: 'prepared' })
  status: 'prepared' | 'confirmed' | 'cancelled' | 'expired';

  @Column()
  token: string;

  @Column({ type: 'datetime' })
  tokenExpiresAt: Date;

  @Column({ type: 'varchar', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', nullable: true })
  actorRole: string | null;

  @Column({ type: 'varchar', nullable: true })
  actorType: string | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

