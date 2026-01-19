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
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly iam: IamService) {
    const jwtFromRequest: JwtFromRequestFunction = ((request: Request) => {
      const header =
        request.get('authorization') ?? request.headers.authorization ?? null;
      if (!header) {
        return null;
      }
      const [scheme, token] = header.split(' ');
      if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
        return null;
      }
      return token;
    }) as JwtFromRequestFunction;
    super({
      jwtFromRequest,
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'change-this-secret',
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.iam.findById(payload.sub);
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }
}
