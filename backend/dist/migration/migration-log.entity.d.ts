import { MigrationJob } from './migration-job.entity';
import { MigrationAccount } from './migration-account.entity';
export declare class MigrationLog {
    id: string;
    job: MigrationJob;
    account: MigrationAccount | null;
    level: 'info' | 'warning' | 'error';
    message: string;
    context: Record<string, any> | null;
    createdAt: Date;
}
