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
exports.AccountsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const customer_entity_1 = require("./customer.entity");
let AccountsService = class AccountsService {
    customers;
    constructor(customers) {
        this.customers = customers;
    }
    async list() {
        return this.customers.find({ order: { createdAt: 'DESC' } });
    }
    async create(ownerUserId, input) {
        const entity = this.customers.create({
            name: input.name,
            email: input.email,
            company: input.company ?? null,
            phone: input.phone ?? null,
            ownerUserId,
            status: 'active',
        });
        return this.customers.save(entity);
    }
    async get(id) {
        const customer = await this.customers.findOne({ where: { id } });
        if (!customer) {
            throw new common_1.NotFoundException('Customer not found');
        }
        return customer;
    }
    async update(id, input) {
        const customer = await this.get(id);
        if (input.name !== undefined) {
            customer.name = input.name;
        }
        if (input.email !== undefined) {
            customer.email = input.email;
        }
        if (input.company !== undefined) {
            customer.company = input.company;
        }
        if (input.phone !== undefined) {
            customer.phone = input.phone;
        }
        if (input.status !== undefined) {
            customer.status = input.status;
        }
        return this.customers.save(customer);
    }
};
exports.AccountsService = AccountsService;
exports.AccountsService = AccountsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(customer_entity_1.Customer)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], AccountsService);
//# sourceMappingURL=accounts.service.js.map