"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HostingCredentialsService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
let HostingCredentialsService = class HostingCredentialsService {
    generateDatabasePassword() {
        return this.generateSecret(24);
    }
    generateMailboxPassword() {
        return this.generateSecret(24);
    }
    generateFtpPassword() {
        return this.generateSecret(24);
    }
    generateSecret(length) {
        const bytes = (0, node_crypto_1.randomBytes)(length);
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+';
        const chars = [];
        for (let i = 0; i < length; i += 1) {
            const index = bytes[i] % alphabet.length;
            chars.push(alphabet[index] ?? 'x');
        }
        return chars.join('');
    }
};
exports.HostingCredentialsService = HostingCredentialsService;
exports.HostingCredentialsService = HostingCredentialsService = __decorate([
    (0, common_1.Injectable)()
], HostingCredentialsService);
//# sourceMappingURL=hosting-credentials.service.js.map