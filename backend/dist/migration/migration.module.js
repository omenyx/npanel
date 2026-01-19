"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MigrationModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const migration_job_entity_1 = require("./migration-job.entity");
const migration_account_entity_1 = require("./migration-account.entity");
const migration_step_entity_1 = require("./migration-step.entity");
const migration_log_entity_1 = require("./migration-log.entity");
const migration_service_1 = require("./migration.service");
const migration_controller_1 = require("./migration.controller");
const system_module_1 = require("../system/system.module");
const hosting_module_1 = require("../hosting/hosting.module");
let MigrationModule = class MigrationModule {
};
exports.MigrationModule = MigrationModule;
exports.MigrationModule = MigrationModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([
                migration_job_entity_1.MigrationJob,
                migration_account_entity_1.MigrationAccount,
                migration_step_entity_1.MigrationStep,
                migration_log_entity_1.MigrationLog,
            ]),
            system_module_1.SystemModule,
            hosting_module_1.HostingModule,
        ],
        controllers: [migration_controller_1.MigrationController],
        providers: [migration_service_1.MigrationService],
    })
], MigrationModule);
//# sourceMappingURL=migration.module.js.map