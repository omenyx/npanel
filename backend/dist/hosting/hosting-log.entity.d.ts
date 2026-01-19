export declare class HostingLog {
    id: string;
    serviceId: string;
    adapter: string;
    operation: string;
    targetKind: string;
    targetKey: string;
    success: boolean;
    dryRun: boolean;
    details: Record<string, unknown> | null;
    errorMessage: string | null;
    createdAt: Date;
}
