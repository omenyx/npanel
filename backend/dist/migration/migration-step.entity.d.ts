import { MigrationJob } from './migration-job.entity';
import { MigrationAccount } from './migration-account.entity';
import type { MigrationStepStatus } from './migration-step-status.enum';
export declare class MigrationStep {
    id: string;
    job: MigrationJob;
    account: MigrationAccount | null;
    name: string;
    status: MigrationStepStatus;
    payload: Record<string, any> | null;
    lastError: Record<string, any> | null;
    createdAt: Date;
    updatedAt: Date;
}
