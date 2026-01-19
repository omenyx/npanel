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
exports.HostingService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const hosting_service_entity_1 = require("./hosting-service.entity");
const hosting_plan_entity_1 = require("./hosting-plan.entity");
const hosting_adapters_1 = require("./hosting-adapters");
const hosting_log_entity_1 = require("./hosting-log.entity");
const hosting_credentials_service_1 = require("./hosting-credentials.service");
const accounts_service_1 = require("../accounts/accounts.service");
const tool_resolver_1 = require("../system/tool-resolver");
const node_crypto_1 = require("node:crypto");
let HostingService = class HostingService {
    services;
    plans;
    userAdapter;
    webServerAdapter;
    phpFpmAdapter;
    mysqlAdapter;
    dnsAdapter;
    mailAdapter;
    ftpAdapter;
    logs;
    credentials;
    accounts;
    tools;
    constructor(services, plans, userAdapter, webServerAdapter, phpFpmAdapter, mysqlAdapter, dnsAdapter, mailAdapter, ftpAdapter, logs, credentials, accounts, tools) {
        this.services = services;
        this.plans = plans;
        this.userAdapter = userAdapter;
        this.webServerAdapter = webServerAdapter;
        this.phpFpmAdapter = phpFpmAdapter;
        this.mysqlAdapter = mysqlAdapter;
        this.dnsAdapter = dnsAdapter;
        this.mailAdapter = mailAdapter;
        this.ftpAdapter = ftpAdapter;
        this.logs = logs;
        this.credentials = credentials;
        this.accounts = accounts;
        this.tools = tools;
    }
    async onModuleInit() {
        const count = await this.plans.count();
        if (count === 0) {
            await this.plans.save({
                name: 'basic',
                diskQuotaMb: 5120,
                maxDatabases: 3,
                phpVersion: '8.2',
                mailboxQuotaMb: 1024,
                maxMailboxes: 5,
                maxFtpAccounts: 1,
            });
        }
    }
    async listPlans() {
        return this.plans.find({ order: { name: 'ASC' } });
    }
    async createPlan(input) {
        const exists = await this.plans.findOne({ where: { name: input.name } });
        if (exists) {
            throw new common_1.BadRequestException(`Hosting plan '${input.name}' already exists`);
        }
        const plan = this.plans.create(input);
        return this.plans.save(plan);
    }
    async deletePlan(name) {
        const plan = await this.plans.findOne({ where: { name } });
        if (!plan) {
            throw new common_1.NotFoundException('Hosting plan not found');
        }
        const inUse = await this.services.count({ where: { planName: name } });
        if (inUse > 0) {
            throw new common_1.BadRequestException(`Cannot delete plan '${name}' because it is used by ${inUse} service(s)`);
        }
        await this.plans.delete({ name });
        return { deleted: true };
    }
    async list() {
        return this.services.find({ order: { createdAt: 'DESC' } });
    }
    async create(input) {
        const planName = input.planName ?? 'basic';
        const plan = await this.plans.findOne({ where: { name: planName } });
        if (!plan) {
            throw new common_1.BadRequestException(`Hosting plan '${planName}' not found`);
        }
        const existsForDomain = await this.services.findOne({ where: { primaryDomain: input.primaryDomain } });
        if (existsForDomain) {
            throw new common_1.BadRequestException(`Hosting service for domain '${input.primaryDomain}' already exists`);
        }
        if (!input.customerId && !input.customer) {
            throw new common_1.BadRequestException('Either customerId or customer must be provided');
        }
        let customerId = input.customerId ?? null;
        if (!customerId && input.customer) {
            const created = await this.accounts.create('operator', { name: input.customer.name, email: input.customer.email });
            customerId = created.id;
        }
        if (!customerId) {
            throw new common_1.BadRequestException('Customer creation failed');
        }
        const entity = this.services.create({
            customerId,
            primaryDomain: input.primaryDomain,
            planName: plan.name,
            status: 'provisioning',
        });
        const saved = await this.services.save(entity);
        if (input.autoProvision === true) {
            const readiness = await this.checkToolReadinessForProvision();
            if (readiness.missing.length > 0) {
                throw new common_1.BadRequestException(`Auto-provision blocked; missing tools: ${readiness.missing.join(', ')}`);
            }
            const provisioned = await this.provisionWithCredentials(saved.id);
            return provisioned;
        }
        return saved;
    }
    async get(id) {
        const service = await this.services.findOne({ where: { id } });
        if (!service) {
            throw new common_1.NotFoundException('Hosting service not found');
        }
        return service;
    }
    async listLogs(serviceId) {
        return this.logs.find({
            where: { serviceId },
            order: { createdAt: 'DESC' },
            take: 100,
        });
    }
    async listAllLogs() {
        return this.logs.find({
            order: { createdAt: 'DESC' },
            take: 200,
        });
    }
    async provision(id) {
        const service = await this.get(id);
        if (service.status !== 'provisioning' &&
            service.status !== 'error' &&
            service.status !== 'active') {
            throw new common_1.BadRequestException('Provisioning is only allowed for new or failed services');
        }
        if (service.status === 'active') {
            return service;
        }
        const planName = service.planName ?? 'basic';
        const plan = await this.plans.findOne({ where: { name: planName } });
        if (!plan) {
            throw new common_1.BadRequestException(`Hosting plan '${planName}' not found for service ${service.id}`);
        }
        if (plan.maxMailboxes < 1) {
            throw new common_1.BadRequestException(`Plan '${plan.name}' does not allow mailboxes (limit: ${plan.maxMailboxes})`);
        }
        if (plan.maxFtpAccounts < 1) {
            throw new common_1.BadRequestException(`Plan '${plan.name}' does not allow FTP accounts (limit: ${plan.maxFtpAccounts})`);
        }
        if (plan.diskQuotaMb <= 0) {
            throw new common_1.BadRequestException(`Plan '${plan.name}' has invalid disk quota (must be > 0)`);
        }
        const supportedPhp = ['7.4', '8.0', '8.1', '8.2', '8.3'];
        if (!supportedPhp.includes(plan.phpVersion)) {
            throw new common_1.BadRequestException(`Plan '${plan.name}' requests unsupported PHP version '${plan.phpVersion}' (supported: ${supportedPhp.join(', ')})`);
        }
        const context = this.buildAdapterContext(service);
        const username = this.deriveSystemUsername(service);
        const homeDirectory = `/home/${username}`;
        const documentRoot = `${homeDirectory}/public_html`;
        const phpPoolName = username;
        const mysqlUsername = `${username}_db`;
        const mysqlPassword = this.credentials.generateDatabasePassword();
        const mailboxPassword = this.credentials.generateMailboxPassword();
        const ftpPassword = this.credentials.generateFtpPassword();
        const traceId = context.traceId ?? null;
        const rollbackFns = [];
        const registerRollback = (fn) => {
            if (fn) {
                rollbackFns.push(fn);
            }
        };
        try {
            service.status = 'provisioning';
            await this.services.save(service);
            const userResult = await this.userAdapter.ensurePresent(context, {
                username,
                homeDirectory,
                primaryGroup: username,
                shell: '/bin/bash',
                quotaMb: plan.diskQuotaMb,
            });
            registerRollback(userResult.rollback);
            const phpResult = await this.phpFpmAdapter.ensurePoolPresent(context, {
                name: phpPoolName,
                user: username,
                group: username,
                listen: `/run/php-fpm-${username}.sock`,
                phpVersion: plan.phpVersion,
            });
            registerRollback(phpResult.rollback);
            const webResult = await this.webServerAdapter.ensureVhostPresent(context, {
                domain: service.primaryDomain,
                documentRoot,
                phpFpmPool: phpPoolName,
                sslCertificateId: null,
            });
            registerRollback(webResult.rollback);
            const mysqlResult = await this.mysqlAdapter.ensureAccountPresent(context, {
                username: mysqlUsername,
                password: mysqlPassword,
                databases: [],
            });
            registerRollback(mysqlResult.rollback);
            const dnsRecords = this.buildDefaultDnsRecords(service.primaryDomain);
            const dnsResult = await this.dnsAdapter.ensureZonePresent(context, {
                zoneName: service.primaryDomain,
                records: dnsRecords,
            });
            registerRollback(dnsResult.rollback);
            const mailResult = await this.mailAdapter.ensureMailboxPresent(context, {
                address: `postmaster@${service.primaryDomain}`,
                password: mailboxPassword,
                quotaMb: plan.mailboxQuotaMb,
            });
            registerRollback(mailResult.rollback);
            const ftpResult = await this.ftpAdapter.ensureAccountPresent(context, {
                username,
                password: ftpPassword,
                homeDirectory,
            });
            registerRollback(ftpResult.rollback);
            service.status = 'active';
            const saved = await this.services.save(service);
            await context.log({
                adapter: 'hosting',
                operation: 'update',
                targetKind: 'web_vhost',
                targetKey: service.id,
                success: true,
                dryRun: context.dryRun,
                details: {
                    action: 'provision',
                    traceId,
                },
                errorMessage: null,
            });
            return saved;
        }
        catch (error) {
            const contextAfter = this.buildAdapterContext(service);
            for (let index = rollbackFns.length - 1; index >= 0; index -= 1) {
                const fn = rollbackFns[index];
                try {
                    await fn();
                }
                catch {
                    await contextAfter.log({
                        adapter: 'hosting',
                        operation: 'update',
                        targetKind: 'web_vhost',
                        targetKey: service.id,
                        success: false,
                        dryRun: contextAfter.dryRun,
                        details: {
                            action: 'rollback_failed',
                            traceId,
                        },
                        errorMessage: 'Rollback handler failed',
                    });
                }
            }
            service.status = 'error';
            await this.services.save(service);
            await contextAfter.log({
                adapter: 'hosting',
                operation: 'update',
                targetKind: 'web_vhost',
                targetKey: service.id,
                success: false,
                dryRun: contextAfter.dryRun,
                details: {
                    action: 'provision_failed',
                    traceId,
                },
                errorMessage: error instanceof Error ? error.message : 'Unknown provisioning error',
            });
            throw error;
        }
    }
    async provisionWithCredentials(id) {
        const service = await this.get(id);
        const planName = service.planName ?? 'basic';
        const plan = await this.plans.findOne({ where: { name: planName } });
        if (!plan) {
            throw new common_1.BadRequestException(`Hosting plan '${planName}' not found for service ${service.id}`);
        }
        const context = this.buildAdapterContext(service);
        const username = this.deriveSystemUsername(service);
        const homeDirectory = `/home/${username}`;
        const documentRoot = `${homeDirectory}/public_html`;
        const phpPoolName = username;
        const mysqlUsername = `${username}_db`;
        const mysqlPassword = this.credentials.generateDatabasePassword();
        const mailboxPassword = this.credentials.generateMailboxPassword();
        const ftpPassword = this.credentials.generateFtpPassword();
        await this.userAdapter.ensurePresent(context, {
            username,
            homeDirectory,
            primaryGroup: username,
            shell: '/bin/bash',
            quotaMb: plan.diskQuotaMb,
        });
        await this.phpFpmAdapter.ensurePoolPresent(context, {
            name: phpPoolName,
            user: username,
            group: username,
            listen: `/run/php-fpm-${username}.sock`,
            phpVersion: plan.phpVersion,
        });
        await this.webServerAdapter.ensureVhostPresent(context, {
            domain: service.primaryDomain,
            documentRoot,
            phpFpmPool: phpPoolName,
            sslCertificateId: null,
        });
        await this.mysqlAdapter.ensureAccountPresent(context, {
            username: mysqlUsername,
            password: mysqlPassword,
            databases: [],
        });
        const dnsRecords = this.buildDefaultDnsRecords(service.primaryDomain);
        await this.dnsAdapter.ensureZonePresent(context, {
            zoneName: service.primaryDomain,
            records: dnsRecords,
        });
        await this.mailAdapter.ensureMailboxPresent(context, {
            address: `postmaster@${service.primaryDomain}`,
            password: mailboxPassword,
            quotaMb: plan.mailboxQuotaMb,
        });
        await this.ftpAdapter.ensureAccountPresent(context, {
            username,
            password: ftpPassword,
            homeDirectory,
        });
        service.status = 'active';
        const saved = await this.services.save(service);
        return {
            service: saved,
            credentials: {
                username,
                mysqlUsername,
                mysqlPassword,
                mailboxPassword,
                ftpPassword,
            },
        };
    }
    async initCredentials(id, input) {
        const service = await this.get(id);
        const readiness = await this.checkToolReadinessForProvision();
        const missingMail = readiness.missing.includes('mail_cmd');
        const missingFtp = readiness.missing.includes('ftp_cmd');
        if (missingMail || missingFtp) {
            throw new common_1.BadRequestException(`Cannot set credentials; missing tools: ${[missingMail ? 'mail_cmd' : null, missingFtp ? 'ftp_cmd' : null]
                .filter(Boolean)
                .join(', ')}`);
        }
        const context = this.buildAdapterContext(service);
        const username = this.deriveSystemUsername(service);
        const mailboxPassword = input.mailboxPassword || this.credentials.generateMailboxPassword();
        const ftpPassword = input.ftpPassword || this.credentials.generateFtpPassword();
        await this.mailAdapter.ensureMailboxPresent(context, {
            address: `postmaster@${service.primaryDomain}`,
            password: mailboxPassword,
            quotaMb: null,
        });
        await this.ftpAdapter.ensureAccountPresent(context, {
            username,
            password: ftpPassword,
            homeDirectory: `/home/${username}`,
        });
        return { service, mailboxPassword, ftpPassword };
    }
    async suspend(id) {
        const service = await this.get(id);
        if (service.status !== 'active') {
            return service;
        }
        const context = this.buildAdapterContext(service);
        const username = this.deriveSystemUsername(service);
        await this.userAdapter.ensureSuspended(context, username);
        await this.webServerAdapter.ensureVhostSuspended(context, service.primaryDomain);
        service.status = 'suspended';
        const saved = await this.services.save(service);
        await context.log({
            adapter: 'hosting',
            operation: 'update',
            targetKind: 'web_vhost',
            targetKey: service.id,
            success: true,
            dryRun: context.dryRun,
            details: {
                action: 'suspend',
            },
            errorMessage: null,
        });
        return saved;
    }
    async unsuspend(id) {
        const service = await this.get(id);
        if (service.status !== 'suspended') {
            return service;
        }
        const context = this.buildAdapterContext(service);
        const username = this.deriveSystemUsername(service);
        await this.userAdapter.ensureResumed(context, username);
        const plan = await this.plans.findOne({ where: { name: service.planName || 'basic' } });
        if (plan) {
            await this.webServerAdapter.ensureVhostPresent(context, {
                domain: service.primaryDomain,
                documentRoot: `/home/${username}/public_html`,
                phpFpmPool: username,
                sslCertificateId: null,
            });
        }
        service.status = 'active';
        const saved = await this.services.save(service);
        await context.log({
            adapter: 'hosting',
            operation: 'update',
            targetKind: 'web_vhost',
            targetKey: service.id,
            success: true,
            dryRun: context.dryRun,
            details: {
                action: 'unsuspend',
            },
            errorMessage: null,
        });
        return saved;
    }
    async terminate(id) {
        throw new common_1.BadRequestException('Termination requires prepare and confirm');
    }
    async terminatePrepare(id) {
        const service = await this.get(id);
        if (service.status === 'terminated') {
            throw new common_1.BadRequestException('Service already terminated');
        }
        service.status = 'termination_pending';
        const token = (0, node_crypto_1.randomBytes)(24).toString('hex');
        service.terminationToken = token;
        service.terminationTokenExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
        const saved = await this.services.save(service);
        const context = this.buildAdapterContext(saved);
        await context.log({
            adapter: 'hosting',
            operation: 'update',
            targetKind: 'web_vhost',
            targetKey: saved.primaryDomain,
            success: true,
            dryRun: context.dryRun,
            details: { action: 'termination_prepare' },
            errorMessage: null,
        });
        return { token, service: saved };
    }
    async terminateConfirm(id, token) {
        const service = await this.get(id);
        if (service.status !== 'termination_pending') {
            throw new common_1.BadRequestException('Termination is not pending');
        }
        if (!service.terminationToken || !service.terminationTokenExpiresAt) {
            throw new common_1.BadRequestException('Missing termination token');
        }
        if (service.terminationToken !== token) {
            throw new common_1.BadRequestException('Invalid termination token');
        }
        if (service.terminationTokenExpiresAt.getTime() < Date.now()) {
            throw new common_1.BadRequestException('Termination token expired');
        }
        const context = this.buildAdapterContext(service);
        const username = this.deriveSystemUsername(service);
        const homeDirectory = `/home/${username}`;
        const phpPoolName = username;
        const mysqlUsername = `${username}_db`;
        await this.webServerAdapter.ensureVhostAbsent(context, service.primaryDomain);
        await this.phpFpmAdapter.ensurePoolAbsent(context, phpPoolName);
        await this.mysqlAdapter.ensureAccountAbsent(context, mysqlUsername);
        await this.dnsAdapter.ensureZoneAbsent(context, service.primaryDomain);
        await this.mailAdapter.ensureMailboxAbsent(context, `postmaster@${service.primaryDomain}`);
        await this.ftpAdapter.ensureAccountAbsent(context, username);
        await this.userAdapter.ensureAbsent(context, username);
        await context.log({
            adapter: 'hosting',
            operation: 'delete',
            targetKind: 'web_vhost',
            targetKey: service.primaryDomain,
            success: true,
            dryRun: context.dryRun,
            details: { action: 'terminate', homeDirectory },
            errorMessage: null,
        });
        service.status = 'terminated';
        service.terminationToken = null;
        service.terminationTokenExpiresAt = null;
        return this.services.save(service);
    }
    async terminateCancel(id) {
        const service = await this.get(id);
        if (service.status !== 'termination_pending') {
            return service;
        }
        service.status = 'active';
        service.terminationToken = null;
        service.terminationTokenExpiresAt = null;
        const saved = await this.services.save(service);
        const context = this.buildAdapterContext(saved);
        await context.log({
            adapter: 'hosting',
            operation: 'update',
            targetKind: 'web_vhost',
            targetKey: saved.primaryDomain,
            success: true,
            dryRun: context.dryRun,
            details: { action: 'termination_cancel' },
            errorMessage: null,
        });
        return saved;
    }
    buildAdapterContext(service) {
        const dryRun = process.env.NPANEL_HOSTING_DRY_RUN === '1';
        const traceId = service.id;
        const logsRepo = this.logs;
        return {
            dryRun,
            serviceId: service.id,
            traceId,
            log: async (entry) => {
                const safeEntry = {
                    ...entry,
                    details: entry.details ?? {},
                };
                const payload = {
                    ...safeEntry,
                    serviceId: service.id,
                };
                const entity = logsRepo.create({
                    serviceId: service.id,
                    adapter: safeEntry.adapter,
                    operation: safeEntry.operation,
                    targetKind: safeEntry.targetKind,
                    targetKey: safeEntry.targetKey,
                    success: safeEntry.success,
                    dryRun: safeEntry.dryRun,
                    details: safeEntry.details,
                    errorMessage: safeEntry.errorMessage ?? null,
                });
                await logsRepo.save(entity);
                if (process.env.NPANEL_HOSTING_LOG !== 'json') {
                    console.log('[hosting]', payload);
                    return;
                }
                console.log(JSON.stringify(payload));
            },
        };
    }
    async checkToolReadinessForProvision() {
        const required = ['useradd', 'nginx', 'php-fpm', 'mysql'];
        const missing = [];
        for (const name of required) {
            const status = await this.tools.statusFor(name);
            if (!status.available) {
                missing.push(name);
            }
        }
        if (!process.env.NPANEL_MAIL_CMD) {
            missing.push('mail_cmd');
        }
        else {
            const mailStatus = await this.tools.statusFor(process.env.NPANEL_MAIL_CMD);
            if (!mailStatus.available)
                missing.push('mail_cmd');
        }
        if (!process.env.NPANEL_FTP_CMD) {
            missing.push('ftp_cmd');
        }
        else {
            const ftpStatus = await this.tools.statusFor(process.env.NPANEL_FTP_CMD);
            if (!ftpStatus.available)
                missing.push('ftp_cmd');
        }
        return { missing };
    }
    deriveSystemUsername(service) {
        const domain = service.primaryDomain.toLowerCase();
        const base = domain.split('.')[0] ?? 'site';
        const safe = base.replace(/[^a-z0-9]/g, '').slice(0, 8) || 'site';
        return `u_${safe}`;
    }
    buildDefaultDnsRecords(domain) {
        const ipv4 = process.env.NPANEL_HOSTING_DEFAULT_IPV4 || '127.0.0.1';
        const fqdn = domain.endsWith('.') ? domain : `${domain}.`;
        return [
            {
                name: '@',
                type: 'A',
                data: ipv4,
            },
            {
                name: '@',
                type: 'MX',
                data: `10 ${fqdn}`,
            },
            {
                name: '@',
                type: 'TXT',
                data: '"v=spf1 mx ~all"',
            },
        ];
    }
};
exports.HostingService = HostingService;
exports.HostingService = HostingService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(hosting_service_entity_1.HostingServiceEntity)),
    __param(1, (0, typeorm_1.InjectRepository)(hosting_plan_entity_1.HostingPlan)),
    __param(2, (0, common_1.Inject)(hosting_adapters_1.USER_ADAPTER)),
    __param(3, (0, common_1.Inject)(hosting_adapters_1.WEB_SERVER_ADAPTER)),
    __param(4, (0, common_1.Inject)(hosting_adapters_1.PHP_FPM_ADAPTER)),
    __param(5, (0, common_1.Inject)(hosting_adapters_1.MYSQL_ADAPTER)),
    __param(6, (0, common_1.Inject)(hosting_adapters_1.DNS_ADAPTER)),
    __param(7, (0, common_1.Inject)(hosting_adapters_1.MAIL_ADAPTER)),
    __param(8, (0, common_1.Inject)(hosting_adapters_1.FTP_ADAPTER)),
    __param(9, (0, typeorm_1.InjectRepository)(hosting_log_entity_1.HostingLog)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository, Object, Object, Object, Object, Object, Object, Object, typeorm_2.Repository,
        hosting_credentials_service_1.HostingCredentialsService,
        accounts_service_1.AccountsService,
        tool_resolver_1.ToolResolver])
], HostingService);
//# sourceMappingURL=hosting.service.js.map