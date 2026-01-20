import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class SourceConnectionDto {
  @IsString()
  @IsNotEmpty()
  host!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  sshPort?: number;

  @IsString()
  @IsNotEmpty()
  sshUser!: string;

  @IsOptional()
  @IsIn(['system', 'password', 'key'])
  authMethod?: 'system' | 'password' | 'key';

  @IsOptional()
  @IsString()
  sshPassword?: string;

  @IsOptional()
  @IsString()
  sshKey?: string;

  @IsOptional()
  @IsString()
  cpanelHome?: string;
}

