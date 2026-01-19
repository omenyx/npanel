import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateMigrationJobDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsIn(['cpanel_backup', 'cpanel_live_ssh'])
  sourceType: 'cpanel_backup' | 'cpanel_live_ssh';

  @IsOptional()
  sourceConfig?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
