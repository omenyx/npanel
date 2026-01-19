import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User, UserRole } from './user.entity';

@Injectable()
export class IamService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  async hasAnyUser(): Promise<boolean> {
    const count = await this.users.count();
    return count > 0;
  }

  async createInitialAdmin(email: string, password: string): Promise<User> {
    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      return existing;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const entity = this.users.create({
      email,
      passwordHash,
      role: 'ADMIN' satisfies UserRole,
    });

    return this.users.save(entity);
  }

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.users.findOne({ where: { email } });
    if (!user) {
      return null;
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return null;
    }

    return user;
  }

  async findById(id: string): Promise<User | null> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) {
      return null;
    }

    return user;
  }
}
