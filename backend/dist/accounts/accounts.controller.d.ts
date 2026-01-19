import type { Request } from 'express';
import { AccountsService } from './accounts.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
export declare class AccountsController {
    private readonly accounts;
    constructor(accounts: AccountsService);
    list(): Promise<import("./customer.entity").Customer[]>;
    create(req: Request & {
        user?: {
            id?: string;
        };
    }, body: CreateCustomerDto): Promise<import("./customer.entity").Customer>;
    get(id: string): Promise<import("./customer.entity").Customer>;
    update(id: string, body: UpdateCustomerDto): Promise<import("./customer.entity").Customer>;
}
