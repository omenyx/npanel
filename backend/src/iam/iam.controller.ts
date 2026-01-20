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
import { GovernanceService } from '../governance/governance.service';
import type { ActionStep } from '../governance/governance.service';

@Controller('v1')
export class IamController {
  constructor(
    private readonly iam: IamService,
    private readonly jwt: JwtService,
    private readonly governance: GovernanceService,
  ) {}

  @Post('install/init')
  @HttpCode(HttpStatus.CREATED)
  async initialize(@Body() body: InstallInitDto) {
    throw new Error('Install init requires prepare and confirm');
  }

  @Post('install/init/prepare')
  @HttpCode(HttpStatus.OK)
  async initializePrepare(@Body() body: InstallInitDto) {
    const alreadyInitialized = await this.iam.hasAnyUser();
    if (alreadyInitialized) {
      throw new BadRequestException('already_initialized');
    }
    return this.governance.prepare({
      module: 'iam',
      action: 'install_init',
      targetKind: 'system',
      targetKey: 'initial_admin',
      payload: body as any,
      risk: 'high',
      reversibility: 'requires_restore',
      impactedSubsystems: ['control_plane_db', 'auth'],
      actor: { actorRole: 'SYSTEM', actorType: 'bootstrap' },
    });
  }

  @Post('install/init/confirm')
  @HttpCode(HttpStatus.OK)
  async initializeConfirm(@Body() body: { intentId: string; token: string }) {
    const intent = await this.governance.verify(body.intentId, body.token);
    const steps: ActionStep[] = [{ name: 'create_initial_admin', status: 'SUCCESS' }];
    try {
      const alreadyInitialized = await this.iam.hasAnyUser();
      if (alreadyInitialized) {
        steps[0] = { name: 'create_initial_admin', status: 'SKIPPED' };
        return this.governance.recordResult({
          intent,
          status: 'PARTIAL_SUCCESS',
          steps,
          result: { status: 'already_initialized' },
        });
      }
      const payload = intent.payload as any;
      const admin = await this.iam.createInitialAdmin(payload.adminEmail, payload.adminPassword);
      return this.governance.recordResult({
        intent,
        status: 'SUCCESS',
        steps,
        result: { status: 'initialized', adminId: admin.id },
      });
    } catch (e) {
      steps[0] = { name: 'create_initial_admin', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'unknown_error' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
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
    throw new Error('Change password requires prepare and confirm');
  }

  @Post('auth/change-password/prepare')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePasswordPrepare(
    @Req() req: Request & { user?: any },
    @Body() body: ChangePasswordDto & { reason?: string },
  ) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Unauthorized');
    return this.governance.prepare({
      module: 'iam',
      action: 'change_password',
      targetKind: 'user',
      targetKey: userId,
      payload: body as any,
      risk: 'high',
      reversibility: 'requires_restore',
      impactedSubsystems: ['auth'],
      actor: { actorId: userId, actorRole: req.user?.role, actorType: 'user', reason: typeof body?.reason === 'string' ? body.reason : undefined },
    });
  }

  @Post('auth/change-password/confirm')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePasswordConfirm(
    @Req() req: Request & { user?: any },
    @Body() body: { intentId: string; token: string },
  ) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Unauthorized');
    const intent = await this.governance.verify(body.intentId, body.token);
    const steps: ActionStep[] = [{ name: 'change_password', status: 'SUCCESS' }];
    try {
      const payload = intent.payload as any;
      await this.iam.changePassword(userId, payload.currentPassword, payload.newPassword);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result: { ok: true } });
    } catch (e) {
      steps[0] = { name: 'change_password', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'change_password_failed' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
  }

  @Post('auth/logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAll(@Req() req: Request & { user?: any }) {
    throw new Error('Logout all requires prepare and confirm');
  }

  @Post('auth/logout-all/prepare')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAllPrepare(@Req() req: Request & { user?: any }, @Body() body: { reason?: string }) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Unauthorized');
    return this.governance.prepare({
      module: 'iam',
      action: 'logout_all',
      targetKind: 'user',
      targetKey: userId,
      payload: {} as any,
      risk: 'medium',
      reversibility: 'reversible',
      impactedSubsystems: ['auth'],
      actor: { actorId: userId, actorRole: req.user?.role, actorType: 'user', reason: typeof body?.reason === 'string' ? body.reason : undefined },
    });
  }

  @Post('auth/logout-all/confirm')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAllConfirm(@Req() req: Request & { user?: any }, @Body() body: { intentId: string; token: string }) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Unauthorized');
    const intent = await this.governance.verify(body.intentId, body.token);
    const steps: ActionStep[] = [{ name: 'logout_all', status: 'SUCCESS' }];
    try {
      await this.iam.logoutAll(userId);
      return this.governance.recordResult({ intent, status: 'SUCCESS', steps, result: { ok: true } });
    } catch (e) {
      steps[0] = { name: 'logout_all', status: 'FAILED', errorMessage: e instanceof Error ? e.message : 'logout_all_failed' };
      return this.governance.recordResult({ intent, status: 'FAILED', steps, errorMessage: steps[0].errorMessage ?? null });
    }
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
