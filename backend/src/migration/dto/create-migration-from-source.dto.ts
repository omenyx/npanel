import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class MigrationSourceAccountDto {
  @IsString()
  @IsNotEmpty()
  sourceUsername!: string;

  @IsString()
  @IsNotEmpty()
  sourcePrimaryDomain!: string;

  @IsOptional()
  @IsString()
  targetCustomerId?: string;

  @IsOptional()
  @IsString()
  targetServiceId?: string;
}

export class CreateMigrationFromSourceDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsIn(['cpanel_live_ssh'])
  sourceType!: 'cpanel_live_ssh';

  @IsOptional()
  sourceConfig?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MigrationSourceAccountDto)
  accounts!: MigrationSourceAccountDto[];
}

