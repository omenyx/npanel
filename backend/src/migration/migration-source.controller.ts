import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../iam/jwt-auth.guard';
import { RolesGuard } from '../iam/roles.guard';
import { Roles } from '../iam/roles.decorator';
import { MigrationService } from './migration.service';
import { SourceConnectionDto } from './dto/source-connection.dto';

@Controller('v1/migrations/source')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class MigrationSourceController {
  constructor(private readonly migrations: MigrationService) {}

  @Post('preflight')
  @HttpCode(HttpStatus.OK)
  async preflight(@Body() body: SourceConnectionDto) {
    return this.migrations.sourcePreflight(body as any);
  }

  @Post('accounts')
  @HttpCode(HttpStatus.OK)
  async listAccounts(@Body() body: SourceConnectionDto) {
    return this.migrations.discoverSourceAccounts(body as any);
  }
}
