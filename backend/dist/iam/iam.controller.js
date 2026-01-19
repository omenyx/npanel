"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IamController = void 0;
const common_1 = require("@nestjs/common");
const iam_service_1 = require("./iam.service");
const install_init_dto_1 = require("./dto/install-init.dto");
const login_dto_1 = require("./dto/login.dto");
const jwt_1 = require("@nestjs/jwt");
const jwt_auth_guard_1 = require("./jwt-auth.guard");
let IamController = class IamController {
    iam;
    jwt;
    constructor(iam, jwt) {
        this.iam = iam;
        this.jwt = jwt;
    }
    async initialize(body) {
        const alreadyInitialized = await this.iam.hasAnyUser();
        if (alreadyInitialized) {
            return {
                status: 'already_initialized',
            };
        }
        const admin = await this.iam.createInitialAdmin(body.adminEmail, body.adminPassword);
        return {
            status: 'initialized',
            adminId: admin.id,
        };
    }
    async login(body) {
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
        };
        const accessToken = await this.jwt.signAsync(payload, {
            expiresIn: '15m',
        });
        const refreshToken = await this.jwt.signAsync({ sub: user.id, type: 'refresh' }, {
            expiresIn: '30d',
        });
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
    me(req) {
        return {
            user: req.user,
        };
    }
};
exports.IamController = IamController;
__decorate([
    (0, common_1.Post)('install/init'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [install_init_dto_1.InstallInitDto]),
    __metadata("design:returntype", Promise)
], IamController.prototype, "initialize", null);
__decorate([
    (0, common_1.Post)('auth/login'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [login_dto_1.LoginDto]),
    __metadata("design:returntype", Promise)
], IamController.prototype, "login", null);
__decorate([
    (0, common_1.Get)('auth/me'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], IamController.prototype, "me", null);
exports.IamController = IamController = __decorate([
    (0, common_1.Controller)('v1'),
    __metadata("design:paramtypes", [iam_service_1.IamService,
        jwt_1.JwtService])
], IamController);
//# sourceMappingURL=iam.controller.js.map