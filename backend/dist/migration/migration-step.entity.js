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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MigrationStep = void 0;
const typeorm_1 = require("typeorm");
const migration_job_entity_1 = require("./migration-job.entity");
const migration_account_entity_1 = require("./migration-account.entity");
let MigrationStep = class MigrationStep {
    id;
    job;
    account;
    name;
    status;
    payload;
    lastError;
    createdAt;
    updatedAt;
};
exports.MigrationStep = MigrationStep;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], MigrationStep.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => migration_job_entity_1.MigrationJob, (job) => job.steps, { onDelete: 'CASCADE' }),
    __metadata("design:type", migration_job_entity_1.MigrationJob)
], MigrationStep.prototype, "job", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => migration_account_entity_1.MigrationAccount, (account) => account.steps, {
        nullable: true,
        onDelete: 'CASCADE',
    }),
    __metadata("design:type", Object)
], MigrationStep.prototype, "account", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], MigrationStep.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 32 }),
    __metadata("design:type", String)
], MigrationStep.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'json', nullable: true }),
    __metadata("design:type", Object)
], MigrationStep.prototype, "payload", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'json', nullable: true }),
    __metadata("design:type", Object)
], MigrationStep.prototype, "lastError", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], MigrationStep.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], MigrationStep.prototype, "updatedAt", void 0);
exports.MigrationStep = MigrationStep = __decorate([
    (0, typeorm_1.Entity)({ name: 'migration_steps' })
], MigrationStep);
//# sourceMappingURL=migration-step.entity.js.map