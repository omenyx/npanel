import { IsEmail, IsOptional, IsString, IsIn } from 'class-validator';

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsIn(['active', 'suspended', 'terminated'])
  status?: 'active' | 'suspended' | 'terminated';
}
