import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateHostingPlanDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  diskQuotaMb?: number;

  @IsInt()
  @Min(-1)
  @IsOptional()
  maxDatabases?: number;

  @IsString()
  @IsOptional()
  phpVersion?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  mailboxQuotaMb?: number;

  @IsInt()
  @Min(-1)
  @IsOptional()
  maxMailboxes?: number;

  @IsInt()
  @Min(-1)
  @IsOptional()
  maxFtpAccounts?: number;
}
