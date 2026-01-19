import { MigrationJob } from './migration-job.entity';
import { MigrationStep } from './migration-step.entity';
export declare class MigrationAccount {
    id: string;
    job: MigrationJob;
    sourceUsername: string;
    sourcePrimaryDomain: string;
    targetCustomerId: string | null;
    targetServiceId: string | null;
    metadata: Record<string, any> | null;
    createdAt: Date;
    steps: MigrationStep[];
}
