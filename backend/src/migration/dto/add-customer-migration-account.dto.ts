import { IsNotEmpty, IsString } from 'class-validator';

export class AddCustomerMigrationAccountDto {
  @IsString()
  @IsNotEmpty()
  sourceUsername: string;

  @IsString()
  @IsNotEmpty()
  sourcePrimaryDomain: string;

  @IsString()
  @IsNotEmpty()
  targetServiceId: string;
}
