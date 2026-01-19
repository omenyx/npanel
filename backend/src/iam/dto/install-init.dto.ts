import { IsEmail, IsString, MinLength } from 'class-validator';

export class InstallInitDto {
  @IsEmail()
  adminEmail: string;

  @IsString()
  @MinLength(8)
  adminPassword: string;
}
