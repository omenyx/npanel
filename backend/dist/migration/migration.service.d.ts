import { Repository } from 'typeorm';
import { MigrationJob } from './migration-job.entity';
import { MigrationAccount } from './migration-account.entity';
import { MigrationStep } from './migration-step.entity';
import { MigrationLog } from './migration-log.entity';
import { CreateMigrationJobDto } from './dto/create-migration-job.dto';
import { AddMigrationAccountDto } from './dto/add-migration-account.dto';
import { ToolResolver } from '../system/tool-resolver';
import { HostingService } from '../hosting/hosting.service';
export declare class MigrationService {
    private readonly jobs;
    private readonly accounts;
    private readonly steps;
    private readonly logs;
    private readonly tools;
    private readonly hosting;
    constructor(jobs: Repository<MigrationJob>, accounts: Repository<MigrationAccount>, steps: Repository<MigrationStep>, logs: Repository<MigrationLog>, tools: ToolResolver, hosting: HostingService);
    createJob(input: CreateMigrationJobDto): Promise<MigrationJob>;
    listJobs(): Promise<MigrationJob[]>;
    getJob(id: string): Promise<MigrationJob>;
    addAccount(jobId: string, input: AddMigrationAccountDto): Promise<MigrationAccount>;
    listSteps(jobId: string): Promise<MigrationStep[]>;
    planJob(jobId: string): Promise<MigrationStep[]>;
    runNextStep(jobId: string): Promise<{
        job: MigrationJob;
        step: MigrationStep | null;
    }>;
    private planLiveSshJob;
    private resolveSourceHomePath;
    private resolveTargetHomePath;
    private handleStep;
    private handleValidateSourceHost;
    private handleProvisionTargetEnv;
    private handleImportDatabases;
    private handleRsyncHome;
    private execRsync;
    private refreshJobStatus;
    appendLog(job: MigrationJob, account: MigrationAccount | null, level: 'info' | 'warning' | 'error', message: string, context?: Record<string, any>): Promise<MigrationLog>;
}
