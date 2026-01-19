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
exports.HostingLog = void 0;
const typeorm_1 = require("typeorm");
let HostingLog = class HostingLog {
    id;
    serviceId;
    adapter;
    operation;
    targetKind;
    targetKey;
    success;
    dryRun;
    details;
    errorMessage;
    createdAt;
};
exports.HostingLog = HostingLog;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], HostingLog.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], HostingLog.prototype, "serviceId", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], HostingLog.prototype, "adapter", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], HostingLog.prototype, "operation", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], HostingLog.prototype, "targetKind", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], HostingLog.prototype, "targetKey", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", Boolean)
], HostingLog.prototype, "success", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", Boolean)
], HostingLog.prototype, "dryRun", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'json', nullable: true }),
    __metadata("design:type", Object)
], HostingLog.prototype, "details", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], HostingLog.prototype, "errorMessage", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], HostingLog.prototype, "createdAt", void 0);
exports.HostingLog = HostingLog = __decorate([
    (0, typeorm_1.Entity)({ name: 'host_logs' })
], HostingLog);
//# sourceMappingURL=hosting-log.entity.js.map