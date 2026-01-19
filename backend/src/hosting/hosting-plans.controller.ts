import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { HostingService } from './hosting.service';
import { CreateHostingPlanDto } from './dto/create-hosting-plan.dto';
import { JwtAuthGuard } from '../iam/jwt-auth.guard';
import { RolesGuard } from '../iam/roles.guard';
import { Roles } from '../iam/roles.decorator';

@Controller('v1/hosting/plans')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class HostingPlansController {
  constructor(private readonly hosting: HostingService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list() {
    return this.hosting.listPlans();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateHostingPlanDto) {
    return this.hosting.createPlan(body);
  }

  @Delete(':name')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('name') name: string) {
    return this.hosting.deletePlan(name);
  }
}
