import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'host_services' })
export class HostingServiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  @Column()
  primaryDomain: string;

  @Column({ type: 'varchar', nullable: true })
  planName: string | null;

  @Column({ type: 'varchar', length: 32, default: 'provisioning' })
  status:
    | 'provisioning'
    | 'active'
    | 'suspended'
    | 'soft_deleted'
    | 'terminated'
    | 'error';

  @Column({ type: 'varchar', length: 64, nullable: true })
  provisioningPhase: string | null;

  @Column({ type: 'text', nullable: true })
  provisioningCompletedPhasesJson: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  provisioningFailedPhase: string | null;

  @Column({ type: 'text', nullable: true })
  provisioningErrorJson: string | null;

  @Column({ type: 'datetime', nullable: true })
  provisioningUpdatedAt: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  systemUsername: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  mysqlUsername: string | null;

  @Column({ type: 'text', nullable: true })
  mysqlPasswordEnc: string | null;

  @Column({ type: 'text', nullable: true })
  mailboxPasswordEnc: string | null;

  @Column({ type: 'text', nullable: true })
  ftpPasswordEnc: string | null;

  @Column({ type: 'datetime', nullable: true })
  softDeletedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  hardDeleteEligibleAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  terminationToken: string | null;

  @Column({ type: 'datetime', nullable: true })
  terminationTokenExpiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
