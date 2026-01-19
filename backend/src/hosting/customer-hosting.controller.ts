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
    const mapped = await Promise.all(
      services.map(async (service) => {
        const planName = service.planName ?? 'basic';
        const plan = await this.hosting.getPlan(planName);
        return {
          id: service.id,
          primaryDomain: service.primaryDomain,
          planName,
          status: service.status,
          createdAt: service.createdAt,
          planLimits: plan
            ? {
                diskQuotaMb: plan.diskQuotaMb,
                maxDatabases: plan.maxDatabases,
                maxMailboxes: plan.maxMailboxes,
                mailboxQuotaMb: plan.mailboxQuotaMb,
              }
            : null,
        };
      }),
    );
    return mapped;
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async get(@Req() req: any, @Param('id') id: string) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) {
      throw new UnauthorizedException('Access denied');
    }
    const planName = service.planName ?? 'basic';
    const plan = await this.hosting.getPlan(planName);
    return {
      id: service.id,
      primaryDomain: service.primaryDomain,
      planName,
      status: service.status,
      createdAt: service.createdAt,
      planLimits: plan
        ? {
            diskQuotaMb: plan.diskQuotaMb,
            maxDatabases: plan.maxDatabases,
            maxMailboxes: plan.maxMailboxes,
            mailboxQuotaMb: plan.mailboxQuotaMb,
          }
        : null,
    };
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

  @Post(':id/mailboxes')
  @HttpCode(HttpStatus.CREATED)
  async createMailbox(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { localPart: string; password: string },
  ) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) {
      throw new UnauthorizedException('Access denied');
    }
    const result = await this.hosting.createMailbox(id, body);
    return result;
  }

  @Post(':id/mailboxes/delete')
  @HttpCode(HttpStatus.OK)
  async deleteMailbox(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { address: string },
  ) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) {
      throw new UnauthorizedException('Access denied');
    }
    await this.hosting.deleteMailbox(id, body.address);
    return { success: true };
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

  @Get(':id/databases')
  @HttpCode(HttpStatus.OK)
  async listDatabases(@Req() req: any, @Param('id') id: string) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    const databases = await this.hosting.listDatabases(id);
    return { databases };
  }

  @Post(':id/databases/password')
  @HttpCode(HttpStatus.OK)
  async resetDatabasePassword(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { password: string },
  ) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    await this.hosting.resetDatabasePassword(id, body.password);
    return { success: true };
  }

  @Get(':id/ftp')
  @HttpCode(HttpStatus.OK)
  async getFtpCredentials(@Req() req: any, @Param('id') id: string) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    return this.hosting.getFtpCredentials(id);
  }

  @Post(':id/ftp/password')
  @HttpCode(HttpStatus.OK)
  async resetFtpPassword(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { password: string },
  ) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    await this.hosting.resetFtpPassword(id, body.password);
    return { success: true };
  }

  @Get(':id/dns')
  @HttpCode(HttpStatus.OK)
  async listDnsRecords(@Req() req: any, @Param('id') id: string) {
    const customer = await this.getCustomerForUser(req);
    const service = await this.hosting.get(id);
    if (service.customerId !== customer.id) throw new UnauthorizedException('Access denied');
    const records = await this.hosting.listDnsRecords(id);
    return { records };
  }
}
