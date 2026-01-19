import { MigrationService } from './migration.service';
import { CreateMigrationJobDto } from './dto/create-migration-job.dto';
import { AddMigrationAccountDto } from './dto/add-migration-account.dto';
export declare class MigrationController {
    private readonly migrations;
    constructor(migrations: MigrationService);
    createJob(body: CreateMigrationJobDto): Promise<{
        id: string;
        name: string;
        status: import("./migration-job-status.enum").MigrationJobStatus;
        sourceType: "cpanel_backup" | "cpanel_live_ssh";
        dryRun: boolean;
        createdAt: Date;
    }>;
    listJobs(): Promise<import("./migration-job.entity").MigrationJob[]>;
    getJob(id: string): Promise<import("./migration-job.entity").MigrationJob>;
    addAccount(id: string, body: AddMigrationAccountDto): Promise<import("./migration-account.entity").MigrationAccount>;
    listSteps(id: string): Promise<import("./migration-step.entity").MigrationStep[]>;
    planJob(id: string): Promise<import("./migration-step.entity").MigrationStep[]>;
    runNext(id: string): Promise<{
        job: import("./migration-job.entity").MigrationJob;
        step: import("./migration-step.entity").MigrationStep | null;
    }>;
}
