import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type UserRole = 'ADMIN' | 'RESELLER' | 'CUSTOMER' | 'SUPPORT';

@Entity({ name: 'iam_users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column({ type: 'varchar', length: 32 })
  role: UserRole;

  @Column({ type: 'integer', default: 0 })
  tokenVersion: number;

  @CreateDateColumn()
  createdAt: Date;
}
