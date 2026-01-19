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
exports.MigrationController = void 0;
const common_1 = require("@nestjs/common");
const migration_service_1 = require("./migration.service");
const create_migration_job_dto_1 = require("./dto/create-migration-job.dto");
const add_migration_account_dto_1 = require("./dto/add-migration-account.dto");
let MigrationController = class MigrationController {
    migrations;
    constructor(migrations) {
        this.migrations = migrations;
    }
    async createJob(body) {
        const job = await this.migrations.createJob(body);
        return {
            id: job.id,
            name: job.name,
            status: job.status,
            sourceType: job.sourceType,
            dryRun: job.dryRun,
            createdAt: job.createdAt,
        };
    }
    async listJobs() {
        const jobs = await this.migrations.listJobs();
        return jobs;
    }
    async getJob(id) {
        const job = await this.migrations.getJob(id);
        return job;
    }
    async addAccount(id, body) {
        const account = await this.migrations.addAccount(id, body);
        return account;
    }
    async listSteps(id) {
        const steps = await this.migrations.listSteps(id);
        return steps;
    }
    async planJob(id) {
        const steps = await this.migrations.planJob(id);
        return steps;
    }
    async runNext(id) {
        const result = await this.migrations.runNextStep(id);
        return result;
    }
};
exports.MigrationController = MigrationController;
__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_migration_job_dto_1.CreateMigrationJobDto]),
    __metadata("design:returntype", Promise)
], MigrationController.prototype, "createJob", null);
__decorate([
    (0, common_1.Get)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], MigrationController.prototype, "listJobs", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MigrationController.prototype, "getJob", null);
__decorate([
    (0, common_1.Post)(':id/accounts'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, add_migration_account_dto_1.AddMigrationAccountDto]),
    __metadata("design:returntype", Promise)
], MigrationController.prototype, "addAccount", null);
__decorate([
    (0, common_1.Get)(':id/steps'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MigrationController.prototype, "listSteps", null);
__decorate([
    (0, common_1.Post)(':id/plan'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MigrationController.prototype, "planJob", null);
__decorate([
    (0, common_1.Post)(':id/run-next'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], MigrationController.prototype, "runNext", null);
exports.MigrationController = MigrationController = __decorate([
    (0, common_1.Controller)('v1/migrations'),
    __metadata("design:paramtypes", [migration_service_1.MigrationService])
], MigrationController);
//# sourceMappingURL=migration.controller.js.map