import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AddMigrationAccountDto {
  @IsString()
  @IsNotEmpty()
  sourceUsername: string;

  @IsString()
  @IsNotEmpty()
  sourcePrimaryDomain: string;

  @IsOptional()
  @IsString()
  targetCustomerId?: string;

  @IsOptional()
  @IsString()
  targetServiceId?: string;
}
