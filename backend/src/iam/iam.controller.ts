import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { IamService } from './iam.service';
import { InstallInitDto } from './dto/install-init.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GovernanceService } from '../governance/governance.service';
import type { ActionStep } from '../governance/governance.service';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { AccountsService } from '../accounts/accounts.service';

@Controller('v1')
export class IamController {
  constructor(
    private readonly iam: IamService,
    private readonly jwt: JwtService,
    private readonly governance: GovernanceService,
    private readonly accounts: AccountsService,
  ) {}

  private getRequestIp(req: Request): string | null {
    const direct =
      (req as any)?.ip ?? (req as any)?.socket?.remoteAddress ?? null;
    const proxiesEnv = process.env.NPANEL_TRUSTED_PROXIES || '';
    const trusted = proxiesEnv
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const isTrustedProxy =
      typeof direct === 'string' && trusted.includes(direct);
    if (isTrustedProxy) {
      const xf = req.get('x-forwarded-for');
      if (xf && typeof xf === 'string') {
        const first = xf.split(',')[0]?.trim();
        if (first) return first;
      }
    }
    return typeof direct === 'string' && direct.length > 0 ? direct : null;
  }

  @Post('install/init')
  @HttpCode(HttpStatus.CREATED)
  initialize() {
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
    const steps: ActionStep[] = [
      { name: 'create_initial_admin', status: 'SUCCESS' },
    ];
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
      const admin = await this.iam.createInitialAdmin(
        payload.adminEmail,
        payload.adminPassword,
      );
      return this.governance.recordResult({
        intent,
        status: 'SUCCESS',
        steps,
        result: { status: 'initialized', adminId: admin.id },
      });
    } catch (e) {
      steps[0] = {
        name: 'create_initial_admin',
        status: 'FAILED',
        errorMessage: e instanceof Error ? e.message : 'unknown_error',
      };
      return this.governance.recordResult({
        intent,
        status: 'FAILED',
        steps,
        errorMessage: steps[0].errorMessage ?? null,
      });
    }
  }

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = await this.iam.validateUser(body.email, body.password);
    if (!user) {
      return {
        ok: false,
        error: 'INVALID_CREDENTIALS',
      };
    }

    const sessionId = randomUUID();
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion ?? 0,
      sid: sessionId,
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

    const sourceIp = this.getRequestIp(req);
    const userAgent = req.get('user-agent') ?? null;
    let customerId: string | null = null;
    if (user.role === 'CUSTOMER') {
      const customer = await this.accounts.findByOwnerUserId(user.id);
      customerId = customer?.id ?? null;
    }
    await this.iam.recordLoginEvent({
      loginType: 'password',
      sessionId,
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      customerId,
      impersonatorId: null,
      impersonatorEmail: null,
      sourceIp,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const csrfToken = randomUUID();
    const secure = process.env.NODE_ENV === 'production';
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
      path: '/',
    });
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    res.cookie('csrf_token', csrfToken, {
      httpOnly: false,
      secure,
      sameSite: 'lax',
      maxAge: 30 * 60 * 1000,
      path: '/',
    });

    return res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  }

  private getActor(req: Request & { user?: any }, reason?: string) {
    const imp = req.user?.impersonation ?? null;
    if (imp?.active) {
      return {
        actorId: imp.adminId,
        actorRole: 'ADMIN',
        actorType: 'impersonation',
        reason: typeof reason === 'string' ? reason : undefined,
      };
    }
    return {
      actorId: req.user?.id,
      actorRole: req.user?.role,
      actorType: 'user',
      reason: typeof reason === 'string' ? reason : undefined,
    };
  }

  @Post('auth/impersonation/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  async startImpersonation(
    @Req() req: Request & { user?: any },
    @Body() body: { customerId: string },
    @Res() res: Response,
  ) {
    if (req.user?.impersonation?.active) {
      throw new BadRequestException('already_impersonating');
    }
    const adminId = req.user?.id;
    const adminEmail = req.user?.email;
    if (!adminId || !adminEmail) {
      throw new BadRequestException('Unauthorized');
    }
    const customerId =
      typeof body?.customerId === 'string' ? body.customerId : '';
    if (!customerId) {
      throw new BadRequestException('customerId_required');
    }
    const customer = await this.accounts.get(customerId);
    if (customer.status !== 'active') {
      throw new BadRequestException('customer_not_active');
    }

    const admin = await this.iam.findById(adminId);
    if (!admin || admin.role !== 'ADMIN') {
      throw new BadRequestException('admin_required');
    }

    const sessionId = randomUUID();
    const issuedAt = new Date();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const sourceIp = this.getRequestIp(req as any);
    const userAgent = (req as any)?.get?.('user-agent') ?? null;

    await this.iam.recordLoginEvent({
      loginType: 'impersonation',
      sessionId,
      userId: admin.id,
      userEmail: admin.email,
      userRole: 'ADMIN',
      customerId: customer.id,
      impersonatorId: admin.id,
      impersonatorEmail: admin.email,
      sourceIp,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
      expiresAt,
    });

    const accessToken = await this.jwt.signAsync(
      {
        sub: admin.id,
        email: admin.email,
        role: 'CUSTOMER',
        tokenVersion: admin.tokenVersion ?? 0,
        sid: sessionId,
        impersonation: {
          adminId: admin.id,
          adminEmail: admin.email,
          customerId: customer.id,
          issuedAt: issuedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      },
      { expiresIn: '5m' },
    );
    const csrfToken = randomUUID();
    const secure = process.env.NODE_ENV === 'production';
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000,
      path: '/',
    });
    res.cookie('csrf_token', csrfToken, {
      httpOnly: false,
      secure,
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
      path: '/',
    });
    return res.json({
      ok: true,
      impersonation: {
        sessionId,
        adminId: admin.id,
        adminEmail: admin.email,
        customerId: customer.id,
        customerEmail: customer.email,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    });
  }

  @Post('auth/impersonation/end')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async endImpersonation(
    @Req() req: Request & { user?: any },
    @Res() res: Response,
  ) {
    const sessionId = req.user?.sessionId;
    const impersonation = req.user?.impersonation;
    if (!impersonation?.active || !sessionId) {
      throw new BadRequestException('not_impersonating');
    }
    await this.iam.endSession(sessionId);
    const secure = process.env.NODE_ENV === 'production';
    res.clearCookie('access_token', { path: '/', secure, sameSite: 'lax' });
    res.clearCookie('csrf_token', { path: '/', secure, sameSite: 'lax' });
    return res.json({ ok: true });
  }

  @Get('auth/login-events/me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async myLoginEvents(
    @Req() req: Request & { user?: any },
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 25;
    const impersonatedCustomerId = req.user?.impersonation?.customerId ?? null;
    if (impersonatedCustomerId) {
      const events = await this.iam.listLoginEventsForCustomer(
        impersonatedCustomerId,
        limit,
      );
      return { scope: 'customer', customerId: impersonatedCustomerId, events };
    }
    if (req.user?.role === 'CUSTOMER') {
      const customer = await this.accounts.findByOwnerUserId(req.user.id);
      if (!customer) {
        return { scope: 'customer', customerId: null, events: [] };
      }
      const events = await this.iam.listLoginEventsForCustomer(
        customer.id,
        limit,
      );
      return { scope: 'customer', customerId: customer.id, events };
    }
    const events = await this.iam.listLoginEventsForUser(req.user.id, limit);
    return { scope: 'user', userId: req.user.id, events };
  }

  @Get('auth/login-events/customer/:customerId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  async customerLoginEvents(
    @Param('customerId') customerId: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 25;
    const events = await this.iam.listLoginEventsForCustomer(customerId, limit);
    return { customerId, events };
  }

  @Post('auth/change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  changePassword() {
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
      actor: this.getActor(req, body?.reason),
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
    const intent = await this.governance.verifyWithActor(
      body.intentId,
      body.token,
      this.getActor(req),
    );
    const steps: ActionStep[] = [
      { name: 'change_password', status: 'SUCCESS' },
    ];
    try {
      const payload = intent.payload as any;
      await this.iam.changePassword(
        userId,
        payload.currentPassword,
        payload.newPassword,
      );
      return this.governance.recordResult({
        intent,
        status: 'SUCCESS',
        steps,
        result: { ok: true },
      });
    } catch (e) {
      steps[0] = {
        name: 'change_password',
        status: 'FAILED',
        errorMessage: e instanceof Error ? e.message : 'change_password_failed',
      };
      return this.governance.recordResult({
        intent,
        status: 'FAILED',
        steps,
        errorMessage: steps[0].errorMessage ?? null,
      });
    }
  }

  @Post('auth/logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  logoutAll() {
    throw new Error('Logout all requires prepare and confirm');
  }

  @Post('auth/logout-all/prepare')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAllPrepare(
    @Req() req: Request & { user?: any },
    @Body() body: { reason?: string },
  ) {
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
      actor: this.getActor(req, body?.reason),
    });
  }

  @Post('auth/logout-all/confirm')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAllConfirm(
    @Req() req: Request & { user?: any },
    @Body() body: { intentId: string; token: string },
  ) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Unauthorized');
    const intent = await this.governance.verifyWithActor(
      body.intentId,
      body.token,
      this.getActor(req),
    );
    const steps: ActionStep[] = [{ name: 'logout_all', status: 'SUCCESS' }];
    try {
      await this.iam.logoutAll(userId);
      return this.governance.recordResult({
        intent,
        status: 'SUCCESS',
        steps,
        result: { ok: true },
      });
    } catch (e) {
      steps[0] = {
        name: 'logout_all',
        status: 'FAILED',
        errorMessage: e instanceof Error ? e.message : 'logout_all_failed',
      };
      return this.governance.recordResult({
        intent,
        status: 'FAILED',
        steps,
        errorMessage: steps[0].errorMessage ?? null,
      });
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
