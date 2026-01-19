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
exports.MigrationService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const migration_job_entity_1 = require("./migration-job.entity");
const migration_account_entity_1 = require("./migration-account.entity");
const migration_step_entity_1 = require("./migration-step.entity");
const migration_log_entity_1 = require("./migration-log.entity");
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:fs/promises");
const tool_resolver_1 = require("../system/tool-resolver");
const hosting_service_1 = require("../hosting/hosting.service");
const exec_env_1 = require("../system/exec-env");
let MigrationService = class MigrationService {
    jobs;
    accounts;
    steps;
    logs;
    tools;
    hosting;
    constructor(jobs, accounts, steps, logs, tools, hosting) {
        this.jobs = jobs;
        this.accounts = accounts;
        this.steps = steps;
        this.logs = logs;
        this.tools = tools;
        this.hosting = hosting;
    }
    async createJob(input) {
        const job = this.jobs.create({
            name: input.name,
            sourceType: input.sourceType,
            status: 'pending',
            sourceConfig: input.sourceConfig ?? null,
            dryRun: input.dryRun ?? false,
        });
        const saved = await this.jobs.save(job);
        await this.appendLog(saved, null, 'info', 'job_created', {
            sourceType: saved.sourceType,
            dryRun: saved.dryRun,
        });
        return saved;
    }
    async listJobs() {
        return this.jobs.find({
            order: { createdAt: 'DESC' },
        });
    }
    async getJob(id) {
        const job = await this.jobs.findOne({
            where: { id },
            relations: ['accounts', 'steps'],
        });
        if (!job) {
            throw new common_1.NotFoundException('Migration job not found');
        }
        return job;
    }
    async addAccount(jobId, input) {
        const job = await this.jobs.findOne({ where: { id: jobId } });
        if (!job) {
            throw new common_1.NotFoundException('Migration job not found');
        }
        const account = this.accounts.create({
            job,
            sourceUsername: input.sourceUsername,
            sourcePrimaryDomain: input.sourcePrimaryDomain,
            targetCustomerId: input.targetCustomerId ?? null,
            targetServiceId: input.targetServiceId ?? null,
        });
        const saved = await this.accounts.save(account);
        await this.appendLog(job, saved, 'info', 'account_added', {
            sourceUsername: saved.sourceUsername,
            sourcePrimaryDomain: saved.sourcePrimaryDomain,
        });
        return saved;
    }
    async listSteps(jobId) {
        const job = await this.jobs.findOne({ where: { id: jobId } });
        if (!job) {
            throw new common_1.NotFoundException('Migration job not found');
        }
        return this.steps.find({
            where: { job: { id: job.id } },
            relations: ['account'],
            order: { createdAt: 'ASC' },
        });
    }
    async planJob(jobId) {
        const job = await this.jobs.findOne({
            where: { id: jobId },
            relations: ['accounts', 'steps'],
        });
        if (!job) {
            throw new common_1.NotFoundException('Migration job not found');
        }
        if (job.steps && job.steps.length > 0) {
            return this.steps.find({
                where: { job: { id: job.id } },
                relations: ['account'],
                order: { createdAt: 'ASC' },
            });
        }
        if (job.sourceType === 'cpanel_live_ssh') {
            const steps = await this.planLiveSshJob(job);
            await this.appendLog(job, null, 'info', 'steps_planned', {
                sourceType: job.sourceType,
                stepCount: steps.length,
            });
            return steps;
        }
        throw new common_1.BadRequestException('Planning not implemented for this source type');
    }
    async runNextStep(jobId) {
        const job = await this.jobs.findOne({
            where: { id: jobId },
            relations: ['accounts', 'steps'],
        });
        if (!job) {
            throw new common_1.NotFoundException('Migration job not found');
        }
        if (job.status === 'completed' ||
            job.status === 'failed' ||
            job.status === 'partial') {
            return {
                job,
                step: null,
            };
        }
        if (!job.steps || job.steps.length === 0) {
            await this.planJob(job.id);
        }
        job.status = 'running';
        await this.jobs.save(job);
        let step = await this.steps.findOne({
            where: { job: { id: job.id }, status: 'pending' },
            order: { createdAt: 'ASC' },
            relations: ['account', 'job'],
        });
        if (!step) {
            await this.refreshJobStatus(job);
            const refreshed = await this.jobs.findOne({ where: { id: job.id } });
            return {
                job: refreshed ?? job,
                step: null,
            };
        }
        step.status = 'running';
        step.lastError = null;
        step = await this.steps.save(step);
        await this.appendLog(job, step.account, 'info', 'step_started', {
            stepId: step.id,
            name: step.name,
        });
        try {
            await this.handleStep(step, job);
            step.status = 'completed';
            step = await this.steps.save(step);
            await this.appendLog(job, step.account, 'info', 'step_completed', {
                stepId: step.id,
                name: step.name,
            });
        }
        catch (error) {
            step.status = 'failed';
            const withDetails = error;
            step.lastError = {
                message: withDetails.message ?? error.message,
                details: withDetails.details ?? null,
            };
            step = await this.steps.save(step);
            await this.appendLog(job, step.account, 'error', 'step_failed', {
                stepId: step.id,
                name: step.name,
            });
        }
        await this.refreshJobStatus(job);
        const refreshed = await this.jobs.findOne({ where: { id: job.id } });
        return {
            job: refreshed ?? job,
            step,
        };
    }
    async planLiveSshJob(job) {
        if (!job.accounts || job.accounts.length === 0) {
            throw new common_1.BadRequestException('At least one account is required to plan migration');
        }
        const initialSteps = [];
        const validateStep = this.steps.create({
            job,
            account: null,
            name: 'validate_source_host',
            status: 'pending',
            payload: null,
            lastError: null,
        });
        initialSteps.push(validateStep);
        for (const account of job.accounts) {
            const sourcePath = this.resolveSourceHomePath(job, account);
            const targetPath = this.resolveTargetHomePath(job, account);
            const provisionStep = this.steps.create({
                job,
                account,
                name: 'provision_target_env',
                status: 'pending',
                payload: null,
                lastError: null,
            });
            initialSteps.push(provisionStep);
            const step = this.steps.create({
                job,
                account,
                name: 'rsync_home_directory',
                status: 'pending',
                payload: {
                    sourcePath,
                    targetPath,
                },
                lastError: null,
            });
            initialSteps.push(step);
            const dbStep = this.steps.create({
                job,
                account,
                name: 'import_databases',
                status: 'pending',
                payload: null,
                lastError: null,
            });
            initialSteps.push(dbStep);
        }
        await this.steps.save(initialSteps);
        return this.steps.find({
            where: { job: { id: job.id } },
            relations: ['account'],
            order: { createdAt: 'ASC' },
        });
    }
    resolveSourceHomePath(job, account) {
        const config = job.sourceConfig ?? {};
        const homeRootValue = config['cpanelHome'];
        const homeRoot = typeof homeRootValue === 'string' && homeRootValue.length > 0
            ? homeRootValue
            : '/home';
        const trimmed = homeRoot.endsWith('/') ? homeRoot.slice(0, -1) : homeRoot;
        return `${trimmed}/${account.sourceUsername}`;
    }
    resolveTargetHomePath(job, account) {
        const config = job.sourceConfig ?? {};
        const rootValue = config['targetRoot'];
        const root = typeof rootValue === 'string' && rootValue.length > 0
            ? rootValue
            : process.env.NPANEL_MIGRATION_TARGET_ROOT || '/srv/npanel/migrations';
        const trimmed = root.endsWith('/') ? root.slice(0, -1) : root;
        return `${trimmed}/${job.id}/${account.sourceUsername}`;
    }
    async handleStep(step, job) {
        if (step.name === 'validate_source_host') {
            this.handleValidateSourceHost(job);
            return;
        }
        if (step.name === 'provision_target_env') {
            await this.handleProvisionTargetEnv(step, job);
            return;
        }
        if (step.name === 'rsync_home_directory') {
            await this.handleRsyncHome(step, job);
            return;
        }
        if (step.name === 'import_databases') {
            await this.handleImportDatabases(step, job);
            return;
        }
        step.status = 'skipped';
        await this.steps.save(step);
    }
    handleValidateSourceHost(job) {
        const config = job.sourceConfig ?? {};
        const hostValue = config['host'];
        const sshUserValue = config['sshUser'];
        if (typeof hostValue !== 'string' || hostValue.length === 0) {
            throw new Error('Missing host in sourceConfig');
        }
        if (typeof sshUserValue !== 'string' || sshUserValue.length === 0) {
            throw new Error('Missing sshUser in sourceConfig');
        }
    }
    async handleProvisionTargetEnv(step, job) {
        const account = step.account;
        if (!account) {
            throw new Error('Provision step requires an account');
        }
        const config = job.sourceConfig ?? {};
        const planLimits = config['planLimits'];
        const planNameValue = config['planName'];
        let planName = typeof planNameValue === 'string' && planNameValue.length > 0 ? planNameValue : 'basic';
        if (!planNameValue && planLimits) {
            const stable = JSON.stringify({
                diskQuotaMb: planLimits['diskQuotaMb'],
                maxDatabases: planLimits['maxDatabases'],
                maxMailboxes: planLimits['maxMailboxes'],
                maxFtpAccounts: planLimits['maxFtpAccounts'],
                phpVersion: planLimits['phpVersion'],
            });
            const hash = Buffer.from(stable).toString('hex').slice(0, 12);
            planName = `imported_${hash}`;
            const plans = await this.hosting.listPlans();
            const exists = plans.find((p) => p.name === planName);
            if (!exists) {
                await this.hosting.createPlan({
                    name: planName,
                    diskQuotaMb: Number(planLimits['diskQuotaMb'] ?? 1024),
                    maxDatabases: Number(planLimits['maxDatabases'] ?? 1),
                    phpVersion: String(planLimits['phpVersion'] ?? '8.2'),
                    mailboxQuotaMb: Number(planLimits['mailboxQuotaMb'] ?? 1024),
                    maxMailboxes: Number(planLimits['maxMailboxes'] ?? 1),
                    maxFtpAccounts: Number(planLimits['maxFtpAccounts'] ?? 1),
                });
            }
        }
        let serviceId = account.targetServiceId ?? null;
        if (!serviceId) {
            if (!account.targetCustomerId) {
                throw new Error('Missing targetCustomerId for account');
            }
            const created = await this.hosting.create({
                customerId: account.targetCustomerId,
                primaryDomain: account.sourcePrimaryDomain,
                planName,
            });
            serviceId = created.id ?? (created.service?.id ?? null);
            account.targetServiceId = serviceId;
            account.metadata = {
                ...(account.metadata ?? {}),
                sourceUsername: account.sourceUsername,
                sourcePackageName: planNameValue ?? null,
                addonDomains: Array.isArray(config['addonDomains']) ? config['addonDomains'] : [],
                notes: ['Mailbox passwords reset during migration'],
            };
            await this.accounts.save(account);
        }
        if (!serviceId) {
            throw new Error('Failed to create target service for migration');
        }
        await this.hosting.provision(serviceId);
    }
    async handleImportDatabases(step, job) {
        const account = step.account;
        if (!account || !account.targetServiceId) {
            return;
        }
        const service = await this.hosting.get(account.targetServiceId);
        const plans = await this.hosting.listPlans();
        const plan = plans.find((p) => p.name === (service.planName || 'basic'));
        const maxDbs = Number(plan?.maxDatabases ?? 0);
        const config = job.sourceConfig ?? {};
        const dumps = Array.isArray(config['dbDumps']) ? config['dbDumps'] : [];
        if (dumps.length === 0) {
            return;
        }
        if (maxDbs > 0 && dumps.length > maxDbs) {
            const errorWithDetails = new Error('database_limit_exceeded');
            errorWithDetails.details = { maxDbs, requested: dumps.length };
            throw errorWithDetails;
        }
        const domain = service.primaryDomain.toLowerCase();
        const base = domain.split('.')[0] ?? 'site';
        const safe = base.replace(/[^a-z0-9]/g, '').slice(0, 8) || 'site';
        const username = `u_${safe}`;
        const mysqlUsername = `${username}_db`;
        const mysqlBin = process.env.NPANEL_MYSQL_CMD || 'mysql';
        let mysqlPath;
        try {
            mysqlPath = await this.tools.resolve(mysqlBin, { packageHint: 'mysql client' });
        }
        catch (err) {
            throw err;
        }
        for (const dump of dumps) {
            const dbName = dump.name;
            const createResult = await this.execRsync(mysqlPath, ['-e', `CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`]);
            if (createResult.code !== 0) {
                const errorWithDetails = new Error('db_create_failed');
                errorWithDetails.details = createResult;
                throw errorWithDetails;
            }
            const importArgs = [dbName];
            const importResult = await this.execRsync(mysqlPath, ['-D', dbName, '-e', `source ${dump.path}`]);
            if (importResult.code !== 0) {
                const errorWithDetails = new Error('db_import_failed');
                errorWithDetails.details = importResult;
                throw errorWithDetails;
            }
            const grantSql = `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${mysqlUsername}'@'localhost'; FLUSH PRIVILEGES;`;
            const grantResult = await this.execRsync(mysqlPath, ['-e', grantSql]);
            if (grantResult.code !== 0) {
                const errorWithDetails = new Error('db_grant_failed');
                errorWithDetails.details = grantResult;
                throw errorWithDetails;
            }
        }
    }
    async handleRsyncHome(step, job) {
        const account = step.account;
        if (!account) {
            throw new Error('Rsync step requires an account');
        }
        const config = job.sourceConfig ?? {};
        const hostValue = config['host'];
        const sshUserValue = config['sshUser'];
        const sshPortValue = config['sshPort'];
        const sshKeyPathValue = config['sshKeyPath'];
        if (typeof hostValue !== 'string' || hostValue.length === 0) {
            throw new Error('Missing host in sourceConfig');
        }
        if (typeof sshUserValue !== 'string' || sshUserValue.length === 0) {
            throw new Error('Missing sshUser in sourceConfig');
        }
        const host = hostValue;
        const sshUser = sshUserValue;
        let sshPort = 22;
        if (typeof sshPortValue === 'number' &&
            Number.isInteger(sshPortValue) &&
            sshPortValue > 0) {
            sshPort = sshPortValue;
        }
        const sshKeyPath = typeof sshKeyPathValue === 'string' && sshKeyPathValue.length > 0
            ? sshKeyPathValue
            : null;
        const payload = step.payload ?? {};
        const sourcePathValue = payload['sourcePath'];
        const sourcePath = typeof sourcePathValue === 'string' && sourcePathValue.length > 0
            ? sourcePathValue
            : this.resolveSourceHomePath(job, account);
        const targetPathValue = payload['targetPath'];
        const targetPath = typeof targetPathValue === 'string' && targetPathValue.length > 0
            ? targetPathValue
            : this.resolveTargetHomePath(job, account);
        await (0, promises_1.mkdir)(targetPath, { recursive: true });
        const args = ['-az', '--delete'];
        if (job.dryRun) {
            args.push('--dry-run');
        }
        const sshArgs = ['-o', 'StrictHostKeyChecking=yes'];
        const knownHostsPathValue = config['knownHostsPath'];
        const knownHostsPath = typeof knownHostsPathValue === 'string' && knownHostsPathValue.length > 0
            ? knownHostsPathValue
            : null;
        if (knownHostsPath) {
            sshArgs.push('-o', `UserKnownHostsFile=${knownHostsPath}`);
        }
        if (sshPort) {
            sshArgs.push('-p', String(sshPort));
        }
        if (sshKeyPath) {
            sshArgs.push('-i', sshKeyPath);
        }
        args.push('-e', `ssh ${sshArgs.join(' ')}`);
        args.push(`${sshUser}@${host}:${sourcePath}/`, `${targetPath}/`);
        const rsyncBin = process.env.NPANEL_RSYNC_CMD || 'rsync';
        let rsyncPath;
        try {
            rsyncPath = await this.tools.resolve(rsyncBin, {
                packageHint: 'rsync package',
            });
        }
        catch (err) {
            if (err instanceof tool_resolver_1.ToolNotFoundError) {
                await this.appendLog(job, account, 'error', 'tool_not_found', {
                    tool: err.toolName,
                    feature: 'migration_rsync_home',
                    packageHint: err.packageHint ?? 'rsync package',
                    methodsTried: err.methods,
                });
            }
            throw err;
        }
        const result = await this.execRsync(rsyncPath, args);
        if (result.code !== 0) {
            const errorWithDetails = new Error('rsync_failed');
            errorWithDetails.details = result;
            if (result.stderr.includes('Host key verification failed')) {
                await this.appendLog(job, account, 'error', 'host_key_verification_failed', {
                    hint: knownHostsPath ? 'Verify known_hosts file contains correct host key' : 'Add source host key to known_hosts or provide knownHostsPath',
                    host: host,
                });
            }
            throw errorWithDetails;
        }
    }
    execRsync(command, args) {
        return new Promise((resolve, reject) => {
            const child = (0, node_child_process_1.spawn)(command, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                env: (0, exec_env_1.buildSafeExecEnv)(),
            });
            let stdout = '';
            let stderr = '';
            if (child.stdout) {
                child.stdout.on('data', (chunk) => {
                    stdout += chunk.toString('utf8');
                });
            }
            if (child.stderr) {
                child.stderr.on('data', (chunk) => {
                    stderr += chunk.toString('utf8');
                });
            }
            child.on('error', (error) => {
                reject(error);
            });
            child.on('close', (code) => {
                resolve({
                    code: code ?? -1,
                    stdout,
                    stderr,
                });
            });
        });
    }
    async refreshJobStatus(job) {
        const steps = await this.steps.find({
            where: { job: { id: job.id } },
        });
        if (steps.length === 0) {
            job.status = 'pending';
            await this.jobs.save(job);
            return;
        }
        const anyPending = steps.some((step) => step.status === 'pending' || step.status === 'running');
        const anyFailed = steps.some((step) => step.status === 'failed');
        const anyCompleted = steps.some((step) => step.status === 'completed');
        if (anyPending) {
            job.status = 'running';
        }
        else if (anyFailed && anyCompleted) {
            job.status = 'partial';
        }
        else if (anyFailed) {
            job.status = 'failed';
        }
        else {
            job.status = 'completed';
        }
        await this.jobs.save(job);
    }
    async appendLog(job, account, level, message, context) {
        const log = this.logs.create({
            job,
            account,
            level,
            message,
            context: context ?? null,
        });
        return this.logs.save(log);
    }
};
exports.MigrationService = MigrationService;
exports.MigrationService = MigrationService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(migration_job_entity_1.MigrationJob)),
    __param(1, (0, typeorm_1.InjectRepository)(migration_account_entity_1.MigrationAccount)),
    __param(2, (0, typeorm_1.InjectRepository)(migration_step_entity_1.MigrationStep)),
    __param(3, (0, typeorm_1.InjectRepository)(migration_log_entity_1.MigrationLog)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        tool_resolver_1.ToolResolver,
        hosting_service_1.HostingService])
], MigrationService);
//# sourceMappingURL=migration.service.js.map