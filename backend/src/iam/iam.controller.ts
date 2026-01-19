import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { IamService } from './iam.service';
import { InstallInitDto } from './dto/install-init.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('v1')
export class IamController {
  constructor(
    private readonly iam: IamService,
    private readonly jwt: JwtService,
  ) {}

  @Post('install/init')
  @HttpCode(HttpStatus.CREATED)
  async initialize(@Body() body: InstallInitDto) {
    const alreadyInitialized = await this.iam.hasAnyUser();
    if (alreadyInitialized) {
      return {
        status: 'already_initialized',
      };
    }

    const admin = await this.iam.createInitialAdmin(
      body.adminEmail,
      body.adminPassword,
    );

    return {
      status: 'initialized',
      adminId: admin.id,
    };
  }

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginDto) {
    const user = await this.iam.validateUser(body.email, body.password);
    if (!user) {
      return {
        ok: false,
        error: 'INVALID_CREDENTIALS',
      };
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion ?? 0,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: '15m',
    });

    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, type: 'refresh' },
      {
        expiresIn: '30d',
      },
    );

    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      tokens: {
        accessToken,
        refreshToken,
      },
    };
  }

  @Post('auth/change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Req() req: Request & { user?: any },
    @Body() body: ChangePasswordDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('Unauthorized');
    }
    try {
      await this.iam.changePassword(userId, body.currentPassword, body.newPassword);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'change_password_failed',
      );
    }
    return { ok: true };
  }

  @Post('auth/logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAll(@Req() req: Request & { user?: any }) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('Unauthorized');
    }
    await this.iam.logoutAll(userId);
    return { ok: true };
  }

  @Get('auth/me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  me(@Req() req: Request & { user?: unknown }) {
    return {
      user: req.user,
    };
  }
}
