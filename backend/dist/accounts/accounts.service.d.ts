import { Repository } from 'typeorm';
import { Customer } from './customer.entity';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
export declare class AccountsService {
    private readonly customers;
    constructor(customers: Repository<Customer>);
    list(): Promise<Customer[]>;
    create(ownerUserId: string, input: CreateCustomerDto): Promise<Customer>;
    get(id: string): Promise<Customer>;
    update(id: string, input: UpdateCustomerDto): Promise<Customer>;
}
