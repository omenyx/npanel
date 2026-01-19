import type { Request } from 'express';
import { IamService } from './iam.service';
import { InstallInitDto } from './dto/install-init.dto';
import { LoginDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';
export declare class IamController {
    private readonly iam;
    private readonly jwt;
    constructor(iam: IamService, jwt: JwtService);
    initialize(body: InstallInitDto): Promise<{
        status: string;
        adminId?: undefined;
    } | {
        status: string;
        adminId: string;
    }>;
    login(body: LoginDto): Promise<{
        ok: boolean;
        error: string;
        user?: undefined;
        tokens?: undefined;
    } | {
        ok: boolean;
        user: {
            id: string;
            email: string;
            role: import("./user.entity").UserRole;
        };
        tokens: {
            accessToken: string;
            refreshToken: string;
        };
        error?: undefined;
    }>;
    me(req: Request & {
        user?: unknown;
    }): {
        user: unknown;
    };
}
