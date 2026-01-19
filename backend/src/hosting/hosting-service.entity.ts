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
    | 'termination_pending'
    | 'terminated'
    | 'error';

  @Column({ type: 'varchar', nullable: true })
  terminationToken: string | null;

  @Column({ type: 'datetime', nullable: true })
  terminationTokenExpiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
