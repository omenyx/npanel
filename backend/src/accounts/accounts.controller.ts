import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccountsService } from './accounts.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { JwtAuthGuard } from '../iam/jwt-auth.guard';
import { RolesGuard } from '../iam/roles.guard';
import { Roles } from '../iam/roles.decorator';

@Controller('v1/customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list() {
    const customers = await this.accounts.list();
    return customers;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req: Request & { user?: { id?: string } },
    @Body() body: CreateCustomerDto,
  ) {
    const ownerUserId = req.user?.id ?? '';
    const customer = await this.accounts.create(ownerUserId, body);
    return customer;
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async get(@Param('id') id: string) {
    const customer = await this.accounts.get(id);
    return customer;
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() body: UpdateCustomerDto) {
    const customer = await this.accounts.update(id, body);
    return customer;
  }
}
