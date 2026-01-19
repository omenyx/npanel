export type UserRole = 'ADMIN' | 'RESELLER' | 'CUSTOMER' | 'SUPPORT';
export declare class User {
    id: string;
    email: string;
    passwordHash: string;
    role: UserRole;
    createdAt: Date;
}
