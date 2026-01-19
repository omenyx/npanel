import { IsEmail, IsNotEmpty, IsOptional, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class InlineCustomerDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEmail()
  @IsNotEmpty()
  email!: string;
}

export class CreateHostingServiceDto {
  @ValidateIf((o) => !o.customer)
  @IsString()
  @IsNotEmpty()
  customerId?: string;

  @IsString()
  @IsNotEmpty()
  primaryDomain: string;

  @IsOptional()
  @IsString()
  planName?: string;

  @ValidateIf((o) => !o.customerId)
  @ValidateNested()
  @Type(() => InlineCustomerDto)
  @IsOptional()
  customer?: InlineCustomerDto;

  @IsOptional()
  autoProvision?: boolean;
}
