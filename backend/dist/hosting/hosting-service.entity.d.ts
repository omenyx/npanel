export declare class HostingServiceEntity {
    id: string;
    customerId: string;
    primaryDomain: string;
    planName: string | null;
    status: 'provisioning' | 'active' | 'suspended' | 'termination_pending' | 'terminated' | 'error';
    terminationToken: string | null;
    terminationTokenExpiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}
