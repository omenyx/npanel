import { IamService } from './iam.service';
export type JwtPayload = {
    sub: string;
    email: string;
    role: string;
};
declare const JwtStrategy_base: new (...args: any) => any;
export declare class JwtStrategy extends JwtStrategy_base {
    private readonly iam;
    constructor(iam: IamService);
    validate(payload: JwtPayload): Promise<{
        id: string;
        email: string;
        role: import("./user.entity").UserRole;
    } | null>;
}
export {};
