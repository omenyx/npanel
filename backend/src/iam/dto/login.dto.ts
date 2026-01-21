import { IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  email: string; // Can be email format (user@domain) or username (e.g., 'root')

  @IsString()
  password: string;
}
