import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'hosting_plans' })
export class HostingPlan {
  @PrimaryColumn()
  name: string;

  @Column({ type: 'int', default: 1024 })
  diskQuotaMb: number;

  @Column({ type: 'int', default: 1 })
  maxDatabases: number;

  @Column({ default: '8.2' })
  phpVersion: string;

  @Column({ type: 'int', default: 1024 })
  mailboxQuotaMb: number;

  @Column({ type: 'int', default: 1 })
  maxMailboxes: number;

  @Column({ type: 'int', default: 1 })
  maxFtpAccounts: number;
}
