export declare class Customer {
    id: string;
    name: string;
    email: string;
    company: string | null;
    phone: string | null;
    status: 'active' | 'suspended' | 'terminated';
    ownerUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
}
