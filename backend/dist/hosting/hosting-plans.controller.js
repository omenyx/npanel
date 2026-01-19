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
exports.HostingPlansController = void 0;
const common_1 = require("@nestjs/common");
const hosting_service_1 = require("./hosting.service");
const create_hosting_plan_dto_1 = require("./dto/create-hosting-plan.dto");
const jwt_auth_guard_1 = require("../iam/jwt-auth.guard");
const roles_guard_1 = require("../iam/roles.guard");
const roles_decorator_1 = require("../iam/roles.decorator");
let HostingPlansController = class HostingPlansController {
    hosting;
    constructor(hosting) {
        this.hosting = hosting;
    }
    async list() {
        return this.hosting.listPlans();
    }
    async create(body) {
        return this.hosting.createPlan(body);
    }
    async remove(name) {
        return this.hosting.deletePlan(name);
    }
};
exports.HostingPlansController = HostingPlansController;
__decorate([
    (0, common_1.Get)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HostingPlansController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_hosting_plan_dto_1.CreateHostingPlanDto]),
    __metadata("design:returntype", Promise)
], HostingPlansController.prototype, "create", null);
__decorate([
    (0, common_1.Delete)(':name'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('name')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], HostingPlansController.prototype, "remove", null);
exports.HostingPlansController = HostingPlansController = __decorate([
    (0, common_1.Controller)('v1/hosting/plans'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __metadata("design:paramtypes", [hosting_service_1.HostingService])
], HostingPlansController);
//# sourceMappingURL=hosting-plans.controller.js.map