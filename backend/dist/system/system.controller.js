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
exports.SystemController = void 0;
const common_1 = require("@nestjs/common");
const tool_resolver_1 = require("./tool-resolver");
const jwt_auth_guard_1 = require("../iam/jwt-auth.guard");
const roles_guard_1 = require("../iam/roles.guard");
const roles_decorator_1 = require("../iam/roles.decorator");
const promises_1 = require("fs/promises");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
let SystemController = class SystemController {
    tools;
    constructor(tools) {
        this.tools = tools;
    }
    async status() {
        const toolNames = [
            'id',
            'useradd',
            'usermod',
            'userdel',
            'nginx',
            'php-fpm',
            'mysql',
            'mysqladmin',
            'rndc',
            'pdnsutil',
            'rsync',
        ];
        const results = [];
        for (const name of toolNames) {
            try {
                const status = await this.tools.statusFor(name);
                results.push(status);
            }
            catch (e) {
                results.push({ name, path: null, status: 'missing', error: 'not_checked' });
            }
        }
        return {
            tools: results,
            serverInfo: {
                defaultIpv4: process.env.NPANEL_HOSTING_DEFAULT_IPV4 || 'Unknown',
                dnsBackend: process.env.NPANEL_HOSTING_DNS_ADAPTER === 'shell' ? 'PowerDNS (Shell)' : 'None',
                mailBackend: process.env.NPANEL_HOSTING_MAIL_ADAPTER === 'shell' ? 'Available' : 'None',
                ftpBackend: process.env.NPANEL_HOSTING_FTP_ADAPTER === 'shell' ? 'Available' : 'None',
            }
        };
    }
    async getSshKey() {
        const sshDir = (0, path_1.join)((0, os_1.homedir)(), '.ssh');
        const privateKeyPath = (0, path_1.join)(sshDir, 'id_rsa');
        const publicKeyPath = (0, path_1.join)(sshDir, 'id_rsa.pub');
        try {
            try {
                await (0, promises_1.access)(publicKeyPath, fs_1.constants.R_OK);
            }
            catch {
                await (0, promises_1.mkdir)(sshDir, { recursive: true, mode: 0o700 });
                try {
                    await (0, promises_1.access)(privateKeyPath, fs_1.constants.F_OK);
                    await execAsync(`ssh-keygen -y -f "${privateKeyPath}" > "${publicKeyPath}"`);
                }
                catch {
                    await execAsync(`ssh-keygen -t rsa -b 4096 -N "" -f "${privateKeyPath}"`);
                }
            }
            const keyContent = await (0, promises_1.readFile)(publicKeyPath, 'utf8');
            return { publicKey: keyContent.trim() };
        }
        catch (error) {
            throw new common_1.InternalServerErrorException(`Failed to retrieve or generate SSH key: ${error.message}`);
        }
    }
};
exports.SystemController = SystemController;
__decorate([
    (0, common_1.Get)('status'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "status", null);
__decorate([
    (0, common_1.Get)('ssh-key'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SystemController.prototype, "getSshKey", null);
exports.SystemController = SystemController = __decorate([
    (0, common_1.Controller)('system/tools'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __metadata("design:paramtypes", [tool_resolver_1.ToolResolver])
], SystemController);
//# sourceMappingURL=system.controller.js.map