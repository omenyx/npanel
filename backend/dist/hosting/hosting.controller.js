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
exports.HostingController = void 0;
const common_1 = require("@nestjs/common");
const hosting_service_1 = require("./hosting.service");
const create_hosting_service_dto_1 = require("./dto/create-hosting-service.dto");
const jwt_auth_guard_1 = require("../iam/jwt-auth.guard");
const roles_guard_1 = require("../iam/roles.guard");
const roles_decorator_1 = require("../iam/roles.decorator");
let HostingController = class HostingController {
    hosting;
    constructor(hosting) {
        this.hosting = hosting;
    }
    async list() {
        const services = await this.hosting.list();
        return services;
    }
    async create(body) {
        const result = await this.hosting.create(body);
        return result;
    }
    async allLogs() {
        return this.hosting.listAllLogs();
    }
    async get(id) {
        const service = await this.hosting.get(id);
        return service;
    }
    async logs(id) {
        const entries = await this.hosting.listLogs(id);
        return entries;
    }
    async provision(id) {
        const service = await this.hosting.provision(id);
        return service;
    }
    async suspend(id) {
        const service = await this.hosting.suspend(id);
        return service;
    }
    async unsuspend(id) {
        const service = await this.hosting.unsuspend(id);
        return service;
    }
    async terminate(id) {
        throw new Error('Termination requires prepare and confirm');
    }
    async terminatePrepare(id) {
        const result = await this.hosting.terminatePrepare(id);
        return result;
    }
    async terminateConfirm(id, body) {
        const token = typeof body?.token === 'string' ? body.token : '';
        const service = await this.hosting.terminateConfirm(id, token);
        return service;
    }
    async terminateCancel(id) {
        const service = await this.hosting.terminateCancel(id);
        return service;
    }
    async initCredentials(id, body) {
        const result = await this.hosting.initCredentials(id, {
            mailboxPassword: typeof body?.mailboxPassword === 'string' ? body.mailboxPassword : undefined,
            ftpPassword: typeof body?.ftpPassword === 'string' ? body.ftpPassword : undefined,
        });
        return result;
    }
};
exports.HostingController = HostingController;
__decorate([
    (0, common_1.Get)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HostingController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_hosting_service_dto_1.CreateHostingServiceDto]),
    __metadata("design:returntype", Promise)
], HostingController.prototype, "create", null);
__decorate([
    (0, common_1.Get)('logs'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HostingController.prototype, "allLogs", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], HostingController.prototype, "get", null);
__decorate([
    (0, common_1.Get)(':id/logs'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], HostingController.prototype, "logs", null);
__decorate([
    (0, common_1.Post)(':id/provision'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], HostingController.prototype, "provision", null);
__decorate([
    (0, common_1.Post)(':id/suspend'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], HostingController.prototype, "suspend", null);
__decorate([
    (0, common_1.Post)(':id/unsuspend'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], HostingController.prototype, "unsuspend", null);
__decorate([
    (0, common_1.Post)(':id/terminate'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], HostingController.prototype, "terminate", null);
__decorate([
    (0, common_1.Post)(':id/terminate/prepare'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], HostingController.prototype, "terminatePrepare", null);
__decorate([
    (0, common_1.Post)(':id/terminate/confirm'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], HostingController.prototype, "terminateConfirm", null);
__decorate([
    (0, common_1.Post)(':id/terminate/cancel'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], HostingController.prototype, "terminateCancel", null);
__decorate([
    (0, common_1.Post)(':id/credentials/init'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], HostingController.prototype, "initCredentials", null);
exports.HostingController = HostingController = __decorate([
    (0, common_1.Controller)('v1/hosting/services'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __metadata("design:paramtypes", [hosting_service_1.HostingService])
], HostingController);
//# sourceMappingURL=hosting.controller.js.map