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
exports.MigrationAccount = void 0;
const typeorm_1 = require("typeorm");
const migration_job_entity_1 = require("./migration-job.entity");
const migration_step_entity_1 = require("./migration-step.entity");
let MigrationAccount = class MigrationAccount {
    id;
    job;
    sourceUsername;
    sourcePrimaryDomain;
    targetCustomerId;
    targetServiceId;
    metadata;
    createdAt;
    steps;
};
exports.MigrationAccount = MigrationAccount;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], MigrationAccount.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => migration_job_entity_1.MigrationJob, (job) => job.accounts, { onDelete: 'CASCADE' }),
    __metadata("design:type", migration_job_entity_1.MigrationJob)
], MigrationAccount.prototype, "job", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], MigrationAccount.prototype, "sourceUsername", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], MigrationAccount.prototype, "sourcePrimaryDomain", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], MigrationAccount.prototype, "targetCustomerId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], MigrationAccount.prototype, "targetServiceId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'json', nullable: true }),
    __metadata("design:type", Object)
], MigrationAccount.prototype, "metadata", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], MigrationAccount.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => migration_step_entity_1.MigrationStep, (step) => step.account),
    __metadata("design:type", Array)
], MigrationAccount.prototype, "steps", void 0);
exports.MigrationAccount = MigrationAccount = __decorate([
    (0, typeorm_1.Entity)({ name: 'migration_accounts' })
], MigrationAccount);
//# sourceMappingURL=migration-account.entity.js.map