import { Repository } from 'typeorm';
import { User } from './user.entity';
export declare class IamService {
    private readonly users;
    constructor(users: Repository<User>);
    hasAnyUser(): Promise<boolean>;
    createInitialAdmin(email: string, password: string): Promise<User>;
    validateUser(email: string, password: string): Promise<User | null>;
    findById(id: string): Promise<User | null>;
}
