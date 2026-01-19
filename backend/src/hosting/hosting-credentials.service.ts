import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

@Injectable()
export class HostingCredentialsService {
  generateDatabasePassword(): string {
    return this.generateSecret(24);
  }

  generateMailboxPassword(): string {
    return this.generateSecret(24);
  }

  generateFtpPassword(): string {
    return this.generateSecret(24);
  }

  private generateSecret(length: number): string {
    const bytes = randomBytes(length);
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+';
    const chars: string[] = [];
    for (let i = 0; i < length; i += 1) {
      const index = bytes[i] % alphabet.length;
      chars.push(alphabet[index] ?? 'x');
    }
    return chars.join('');
  }
}
