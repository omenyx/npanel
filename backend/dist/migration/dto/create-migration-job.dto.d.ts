export declare class CreateMigrationJobDto {
    name: string;
    sourceType: 'cpanel_backup' | 'cpanel_live_ssh';
    sourceConfig?: Record<string, any>;
    dryRun?: boolean;
}
