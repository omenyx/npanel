import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import type { Request } from 'express';
import type { JwtFromRequestFunction } from 'passport-jwt';
import { IamService } from './iam.service';

export type JwtPayload = {
  sub: string;
  email: string;
  role: string;
  sid?: string;
  tokenVersion?: number;
  impersonation?: {
    adminId: string;
    adminEmail: string;
    customerId: string;
    issuedAt: string;
    expiresAt: string;
  };
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly iam: IamService) {
    const jwtFromRequest: JwtFromRequestFunction = ((request: Request) => {
      const cookieToken = (request as any)?.cookies?.['access_token'] ?? null;
      if (typeof cookieToken === 'string' && cookieToken.length > 0) {
        return cookieToken;
      }
      const header =
        request.get('authorization') ?? request.headers.authorization ?? null;
      if (!header) return null;
      const [scheme, token] = header.split(' ');
      if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
      return token;
    }) as JwtFromRequestFunction;
    super({
      jwtFromRequest,
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'change-this-secret',
      passReqToCallback: true,
    });
  }

  async validate(request: Request, payload: JwtPayload) {
    const csrfHeader = request.get('x-csrf-token') ?? null;
    const csrfCookie = (request as any)?.cookies?.['csrf_token'] ?? null;
    if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
      return null;
    }
    const user = await this.iam.findById(payload.sub);
    if (!user) {
      return null;
    }
    const tokenVersion = payload.tokenVersion ?? 0;
    if ((user.tokenVersion ?? 0) !== tokenVersion) {
      return null;
    }

    const isImpersonating = !!payload.impersonation;
    if (isImpersonating && user.role !== 'ADMIN') {
      return null;
    }
    if (isImpersonating && payload.role !== 'CUSTOMER') {
      return null;
    }
    if (!isImpersonating && payload.role !== user.role) {
      return null;
    }

    if (isImpersonating) {
      const sid = payload.sid ?? '';
      if (!sid) return null;
      if (payload.impersonation?.adminId !== user.id) return null;
      const session = await this.iam.getActiveImpersonationSession(sid);
      if (!session) return null;
      if (session.customerId !== payload.impersonation?.customerId) return null;
      if (session.impersonatorId !== user.id) return null;
    }

    return {
      id: user.id,
      email: user.email,
      role: payload.role,
      realRole: user.role,
      sessionId: payload.sid ?? null,
      impersonation: payload.impersonation
        ? {
            active: true,
            ...payload.impersonation,
            sessionId: payload.sid ?? null,
          }
        : null,
    };
  }
}
