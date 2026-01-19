import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from './customer.entity';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
  ) {}

  async list(): Promise<Customer[]> {
    return this.customers.find({ order: { createdAt: 'DESC' } });
  }

  async create(
    ownerUserId: string,
    input: CreateCustomerDto,
  ): Promise<Customer> {
    const entity = this.customers.create({
      name: input.name,
      email: input.email,
      company: input.company ?? null,
      phone: input.phone ?? null,
      ownerUserId,
      status: 'active',
    });
    return this.customers.save(entity);
  }

  async get(id: string): Promise<Customer> {
    const customer = await this.customers.findOne({ where: { id } });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  async update(id: string, input: UpdateCustomerDto): Promise<Customer> {
    const customer = await this.get(id);
    if (input.name !== undefined) {
      customer.name = input.name;
    }
    if (input.email !== undefined) {
      customer.email = input.email;
    }
    if (input.company !== undefined) {
      customer.company = input.company;
    }
    if (input.phone !== undefined) {
      customer.phone = input.phone;
    }
    if (input.status !== undefined) {
      customer.status = input.status;
    }
    return this.customers.save(customer);
  }
}
