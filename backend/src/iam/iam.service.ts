import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User, UserRole } from './user.entity';
import { AuthLoginEvent, LoginType } from './auth-login-event.entity';

@Injectable()
export class IamService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(AuthLoginEvent)
    private readonly loginEvents: Repository<AuthLoginEvent>,
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

  async validateUser(
    emailOrUsername: string,
    password: string,
  ): Promise<User | null> {
    // Support root username login (no email format required)
    if (emailOrUsername.toLowerCase() === 'root') {
      // Get root password from environment, with multiple fallback options
      // Works on all distros: Linux, Windows, macOS, WSL, containers, etc.
      const rootPassword =
        process.env.NPANEL_ROOT_PASSWORD ||
        process.env.ROOT_PASSWORD ||
        process.env.ADMIN_PASSWORD;

      if (
        rootPassword &&
        rootPassword.length > 0 &&
        password === rootPassword
      ) {
        // Return a virtual root user (works on any distro without database)
        return {
          id: 'system-root',
          email: 'root@system.local',
          passwordHash: '',
          role: 'ADMIN' as const,
          tokenVersion: 0,
          createdAt: new Date(),
        };
      }
      return null;
    }

    // Standard email-based user authentication (works on all distros)
    const user = await this.users.findOne({
      where: { email: emailOrUsername },
    });
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

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      return;
    }
    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) {
      throw new Error('INVALID_CREDENTIALS');
    }
    if (newPassword.length < 8) {
      throw new Error('WEAK_PASSWORD');
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await this.users.save(user);
  }

  async logoutAll(userId: string): Promise<void> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      return;
    }
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await this.users.save(user);
  }

  async recordLoginEvent(input: {
    loginType: LoginType;
    sessionId: string;
    userId: string;
    userEmail: string;
    userRole: string;
    customerId: string | null;
    impersonatorId?: string | null;
    impersonatorEmail?: string | null;
    sourceIp: string | null;
    userAgent: string | null;
    expiresAt: Date | null;
  }): Promise<AuthLoginEvent> {
    const entity = this.loginEvents.create({
      loginType: input.loginType,
      sessionId: input.sessionId,
      userId: input.userId,
      userEmail: input.userEmail,
      userRole: input.userRole,
      customerId: input.customerId,
      impersonatorId: input.impersonatorId ?? null,
      impersonatorEmail: input.impersonatorEmail ?? null,
      sourceIp: input.sourceIp,
      userAgent: input.userAgent,
      expiresAt: input.expiresAt,
      logoutAt: null,
    });
    return this.loginEvents.save(entity);
  }

  async endSession(sessionId: string): Promise<boolean> {
    const event = await this.loginEvents.findOne({ where: { sessionId } });
    if (!event) return false;
    if (event.logoutAt) return true;
    event.logoutAt = new Date();
    await this.loginEvents.save(event);
    return true;
  }

  async getActiveImpersonationSession(
    sessionId: string,
  ): Promise<AuthLoginEvent | null> {
    const event = await this.loginEvents.findOne({ where: { sessionId } });
    if (!event) return null;
    if (event.loginType !== 'impersonation') return null;
    if (event.logoutAt) return null;
    if (event.expiresAt && event.expiresAt.getTime() <= Date.now()) return null;
    return event;
  }

  async listLoginEventsForCustomer(
    customerId: string,
    limit: number,
  ): Promise<AuthLoginEvent[]> {
    const take = Math.max(1, Math.min(200, limit));
    return this.loginEvents.find({
      where: { customerId },
      order: { loginAt: 'DESC' },
      take,
    });
  }

  async listLoginEventsForUser(
    userId: string,
    limit: number,
  ): Promise<AuthLoginEvent[]> {
    const take = Math.max(1, Math.min(200, limit));
    return this.loginEvents.find({
      where: { userId },
      order: { loginAt: 'DESC' },
      take,
    });
  }
}
