import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { validateEnvironment } from './config/env.validation';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  // Validate environment before starting app
  validateEnvironment();
  
  // Ensure database directory exists and is writable
  const dbPath = process.env.DATABASE_PATH || './npanel.sqlite';
  const dbDir = path.dirname(dbPath);
  
  if (dbDir !== '.' && dbDir !== './') {
    try {
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true, mode: 0o755 });
        console.log(`[DATABASE] Created directory: ${dbDir}`);
      }
      // Verify directory is writable
      fs.accessSync(dbDir, fs.constants.W_OK);
      console.log(`[DATABASE] Using SQLite database at: ${dbPath}`);
    } catch (error) {
      console.error(`[DATABASE] Error setting up database directory: ${error}`);
      throw error;
    }
  }
  
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  const corsOriginsEnv =
    process.env.NPANEL_CORS_ORIGINS ||
    'http://127.0.0.1:3001,http://localhost:3001,http://127.0.0.1:8080,http://localhost:8080';
  const corsOrigins = corsOriginsEnv
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) return callback(null, true);
      if (corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('CORS_BLOCKED'), false);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const server = await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
  
  // Graceful shutdown handlers
  const gracefulShutdown = async (signal: string) => {
    console.log(`\n[SHUTDOWN] ${signal} signal received`);
    console.log('[SHUTDOWN] Gracefully shutting down HTTP server...');
    
    // Stop accepting new connections and wait for in-flight requests
    server.close(async () => {
      console.log('[SHUTDOWN] HTTP server closed, stopping NestJS app...');
      await app.close();
      console.log('[SHUTDOWN] NestJS application closed');
      process.exit(0);
    });
    
    // Force shutdown after 30 seconds to prevent hanging
    const forceTimeout = setTimeout(() => {
      console.error('[SHUTDOWN] ⚠️  Forced shutdown after 30s timeout');
      process.exit(1);
    }, 30000);
    
    forceTimeout.unref();
  };
  
  // Register signal handlers for graceful shutdown
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

void (async () => {
  try {
    await bootstrap();
  } catch (error) {
    console.error('Bootstrap error:', error);
    process.exit(1);
  }
})();
