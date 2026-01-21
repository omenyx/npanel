import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IamController } from './iam.controller';
import { IamService } from './iam.service';
import { User } from './user.entity';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';
import { AuthLoginEvent } from './auth-login-event.entity';
import { AccountsModule } from '../accounts/accounts.module';

const jwtSecret = process.env.JWT_SECRET ?? '';
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error(
    'JWT_SECRET is missing or too short; set a strong secret (>=32 chars)',
  );
}

@Module({
  imports: [
    TypeOrmModule.forFeature([User, AuthLoginEvent]),
    AccountsModule,
    PassportModule,
    JwtModule.register({
      secret: jwtSecret,
      signOptions: { issuer: 'npanel' },
    }),
  ],
  controllers: [IamController],
  providers: [IamService, JwtStrategy, RolesGuard],
  exports: [IamService, RolesGuard],
})
export class IamModule {}
