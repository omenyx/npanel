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
exports.MigrationJob = void 0;
const typeorm_1 = require("typeorm");
const migration_account_entity_1 = require("./migration-account.entity");
const migration_step_entity_1 = require("./migration-step.entity");
let MigrationJob = class MigrationJob {
    id;
    name;
    sourceType;
    status;
    sourceConfig;
    dryRun;
    createdAt;
    updatedAt;
    accounts;
    steps;
};
exports.MigrationJob = MigrationJob;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], MigrationJob.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], MigrationJob.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 32 }),
    __metadata("design:type", String)
], MigrationJob.prototype, "sourceType", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 32 }),
    __metadata("design:type", String)
], MigrationJob.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'json', nullable: true }),
    __metadata("design:type", Object)
], MigrationJob.prototype, "sourceConfig", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], MigrationJob.prototype, "dryRun", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], MigrationJob.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], MigrationJob.prototype, "updatedAt", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => migration_account_entity_1.MigrationAccount, (account) => account.job),
    __metadata("design:type", Array)
], MigrationJob.prototype, "accounts", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => migration_step_entity_1.MigrationStep, (step) => step.job),
    __metadata("design:type", Array)
], MigrationJob.prototype, "steps", void 0);
exports.MigrationJob = MigrationJob = __decorate([
    (0, typeorm_1.Entity)({ name: 'migration_jobs' })
], MigrationJob);
//# sourceMappingURL=migration-job.entity.js.map