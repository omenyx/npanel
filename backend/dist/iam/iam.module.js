"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IamModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const iam_controller_1 = require("./iam.controller");
const iam_service_1 = require("./iam.service");
const user_entity_1 = require("./user.entity");
const jwt_1 = require("@nestjs/jwt");
const passport_1 = require("@nestjs/passport");
const jwt_strategy_1 = require("./jwt.strategy");
const roles_guard_1 = require("./roles.guard");
const jwtSecret = process.env.JWT_SECRET ?? '';
if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET is missing or too short; set a strong secret (>=32 chars).');
}
let IamModule = class IamModule {
};
exports.IamModule = IamModule;
exports.IamModule = IamModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([user_entity_1.User]),
            passport_1.PassportModule,
            jwt_1.JwtModule.register({
                secret: jwtSecret,
                signOptions: { issuer: 'npanel' },
            }),
        ],
        controllers: [iam_controller_1.IamController],
        providers: [iam_service_1.IamService, jwt_strategy_1.JwtStrategy, roles_guard_1.RolesGuard],
        exports: [iam_service_1.IamService, roles_guard_1.RolesGuard],
    })
], IamModule);
//# sourceMappingURL=iam.module.js.map