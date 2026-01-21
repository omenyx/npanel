import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type LoginType = 'password' | 'impersonation';

@Entity({ name: 'auth_login_events' })
export class AuthLoginEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32 })
  loginType: LoginType;

  @Column({ type: 'varchar', length: 64 })
  sessionId: string;

  @Column({ type: 'varchar', nullable: true })
  customerId: string | null;

  @Column({ type: 'varchar', length: 64 })
  userId: string;

  @Column()
  userEmail: string;

  @Column({ type: 'varchar', length: 16 })
  userRole: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  impersonatorId: string | null;

  @Column({ type: 'varchar', nullable: true })
  impersonatorEmail: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  sourceIp: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  userAgent: string | null;

  @CreateDateColumn()
  loginAt: Date;

  @Column({ type: 'datetime', nullable: true })
  logoutAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  expiresAt: Date | null;
}

