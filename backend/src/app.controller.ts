import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getWelcome() {
    return {
      message: 'Npanel Backend API',
      version: '1.0.0',
      status: 'running',
      endpoints: {
        health: 'GET /health',
        login: 'POST /v1/auth/login',
        health_details: 'GET /health',
      },
    };
  }
}
