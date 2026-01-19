import { MigrationAccount } from './migration-account.entity';
import { MigrationStep } from './migration-step.entity';
import type { MigrationJobStatus } from './migration-job-status.enum';
export declare class MigrationJob {
    id: string;
    name: string;
    sourceType: 'cpanel_backup' | 'cpanel_live_ssh';
    status: MigrationJobStatus;
    sourceConfig: Record<string, any> | null;
    dryRun: boolean;
    createdAt: Date;
    updatedAt: Date;
    accounts: MigrationAccount[];
    steps: MigrationStep[];
}
