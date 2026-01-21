import { Logger } from '@nestjs/common';

/**
 * Environment variable validation
 * Ensures all required env vars are set before application starts
 * Fails fast with clear error messages
 */

interface EnvVar {
  name: string;
  required: boolean;
  defaultValue?: string;
  validator?: (value: string) => boolean;
  errorMessage?: string;
}

const REQUIRED_ENV_VARS: EnvVar[] = [
  {
    name: 'NODE_ENV',
    required: true,
    defaultValue: 'production',
    validator: (val) => ['development', 'staging', 'production'].includes(val),
    errorMessage: 'NODE_ENV must be: development, staging, or production',
  },
  {
    name: 'PORT',
    required: true,
    defaultValue: '3000',
    validator: (val) => /^\d+$/.test(val) && parseInt(val) > 0,
    errorMessage: 'PORT must be a positive number',
  },
  {
    name: 'JWT_SECRET',
    required: true,
    validator: (val) => val.length >= 32,
    errorMessage: 'JWT_SECRET must be at least 32 characters long (generate with: openssl rand -hex 32)',
  },
  {
    name: 'LOG_LEVEL',
    required: false,
    defaultValue: 'info',
    validator: (val) => ['debug', 'info', 'warn', 'error'].includes(val),
    errorMessage: 'LOG_LEVEL must be: debug, info, warn, or error',
  },
];

export function validateEnvironment(): void {
  const logger = new Logger('EnvValidation');
  const errors: string[] = [];
  const warnings: string[] = [];

  logger.log('🔍 Validating environment configuration...');

  // Check each environment variable
  for (const envVar of REQUIRED_ENV_VARS) {
    const value = process.env[envVar.name] || envVar.defaultValue;

    if (!value && envVar.required) {
      errors.push(`Missing required environment variable: ${envVar.name}`);
      continue;
    }

    if (value && envVar.validator && !envVar.validator(value)) {
      errors.push(`Invalid ${envVar.name}: ${envVar.errorMessage}`);
      continue;
    }

    if (envVar.name === 'JWT_SECRET' && value === 'CHANGEME') {
      errors.push(`JWT_SECRET still has placeholder value. Generate with: openssl rand -hex 32`);
      continue;
    }

    logger.debug(`✓ ${envVar.name}=${value.substring(0, 10)}...`);
  }

  // Production-specific checks
  if (process.env.NODE_ENV === 'production') {
    if (process.env.LOG_LEVEL === 'debug') {
      warnings.push('LOG_LEVEL=debug in production - consider setting to "warn" or "error"');
    }

    if (!process.env.TLS_ENABLED || process.env.TLS_ENABLED === 'false') {
      warnings.push('TLS is disabled in production - enable with TLS_ENABLED=true for HTTPS');
    }
  }

  // Report errors (fail fast)
  if (errors.length > 0) {
    logger.error('❌ ENVIRONMENT VALIDATION FAILED');
    logger.error('');
    logger.error('Missing or invalid environment variables:');
    errors.forEach((error, index) => {
      logger.error(`  ${index + 1}. ${error}`);
    });
    logger.error('');
    logger.error('See backend/.env.example for required configuration.');
    logger.error('Or run: cp backend/.env.example backend/.env && nano backend/.env');
    logger.error('');
    process.exit(1);
  }

  // Report warnings (non-fatal)
  if (warnings.length > 0) {
    logger.warn('⚠️  ENVIRONMENT WARNINGS');
    warnings.forEach((warning) => {
      logger.warn(`  ⚠️  ${warning}`);
    });
  }

  logger.log('✅ Environment validation passed');
}
