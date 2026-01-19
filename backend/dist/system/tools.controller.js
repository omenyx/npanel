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
exports.ToolsController = void 0;
const common_1 = require("@nestjs/common");
const tool_resolver_1 = require("./tool-resolver");
let ToolsController = class ToolsController {
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
        ];
        const results = [];
        for (const name of toolNames) {
            const status = await this.tools.statusFor(name);
            results.push(status);
        }
        return {
            tools: results,
        };
    }
};
exports.ToolsController = ToolsController;
__decorate([
    (0, common_1.Get)('status'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ToolsController.prototype, "status", null);
exports.ToolsController = ToolsController = __decorate([
    (0, common_1.Controller)('system/tools'),
    __metadata("design:paramtypes", [tool_resolver_1.ToolResolver])
], ToolsController);
//# sourceMappingURL=tools.controller.js.map