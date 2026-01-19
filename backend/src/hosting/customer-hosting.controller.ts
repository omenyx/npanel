import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { HostingService } from './hosting.service';
import { AccountsService } from '../accounts/accounts.service';
import { JwtAuthGuard } from '../iam/jwt-auth.guard';
import { RolesGuard } from '../iam/roles.guard';
import { Roles } from '../iam/roles.decorator';

@Controller('v1/customer/hosting/services')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class CustomerHostingController {
  constructor(
    private readonly hosting: HostingService,
    private readonly accounts: AccountsService,
  ) {}

  private async getCustomerForUser(req: any) {
    const userId = req.user.id;
    const customer = await this.accounts.findByOwnerUserId(userId);
    if (!customer) {
      throw new UnauthorizedException('No customer account linked to user');
    }
    return customer;
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@Req() req: any) {
    const customer = await this.getCustomerForUser(req);
    const services = await this.hosting.listForCustomer(customer.id);
    // Filter sensitive fields if necessary (though entity structure seems safe for now)
    return services;
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async get(@Req() req: any, @Param('id') id: string) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) {
      throw new UnauthorizedException('Access denied');
    }
    return service;
  }

  @Get(':id/mailboxes')
  @HttpCode(HttpStatus.OK)
  async listMailboxes(@Req() req: any, @Param('id') id: string) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) {
      throw new UnauthorizedException('Access denied');
    }
    return this.hosting.listMailboxes(id);
  }

  @Post(':id/mailboxes/password')
  @HttpCode(HttpStatus.OK)
  async updatePassword(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { address: string; password: string },
  ) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) {
      throw new UnauthorizedException('Access denied');
    }
    await this.hosting.updateMailboxPassword(id, body.address, body.password);
    return { success: true };
  }
}
