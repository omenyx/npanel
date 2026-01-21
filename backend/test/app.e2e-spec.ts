import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'x'.repeat(48);
    const { AppModule } = await import('../src/app.module');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/v1/health')
      .expect(200)
      .expect({ status: 'ok' });
  });
});
