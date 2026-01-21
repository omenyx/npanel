import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import request from 'supertest';
import { User } from '../src/iam/user.entity';
import { Customer } from '../src/accounts/customer.entity';
import { HostingServiceEntity } from '../src/hosting/hosting-service.entity';
import { AuthLoginEvent } from '../src/iam/auth-login-event.entity';
import * as bcrypt from 'bcryptjs';

describe('Impersonation (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;
  let customers: Repository<Customer>;
  let services: Repository<HostingServiceEntity>;
  let loginEvents: Repository<AuthLoginEvent>;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'x'.repeat(48);

    const { IamModule } = await import('../src/iam/iam.module');
    const { HealthModule } = await import('../src/health/health.module');
    const { MigrationModule } = await import('../src/migration/migration.module');
    const { AccountsModule } = await import('../src/accounts/accounts.module');
    const { HostingModule } = await import('../src/hosting/hosting.module');
    const { SystemModule } = await import('../src/system/system.module');
    const { GovernanceModule } = await import('../src/governance/governance.module');

    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [__dirname + '/../src/**/*.entity{.ts,.js}'],
          synchronize: true,
        }),
        IamModule,
        HealthModule,
        MigrationModule,
        AccountsModule,
        HostingModule,
        SystemModule,
        GovernanceModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    users = moduleRef.get(getRepositoryToken(User));
    customers = moduleRef.get(getRepositoryToken(Customer));
    services = moduleRef.get(getRepositoryToken(HostingServiceEntity));
    const dataSource = moduleRef.get(DataSource);
    loginEvents = dataSource.getRepository(AuthLoginEvent);

    const admin = users.create({
      email: 'admin@example.com',
      passwordHash: await bcrypt.hash('password123', 12),
      role: 'ADMIN',
      tokenVersion: 0,
    });
    await users.save(admin);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('creates audited admin→customer impersonation session and blocks admin routes', async () => {
    const ip = '203.0.113.10';
    const ua = 'jest-e2e';

    const loginRes = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .set('x-forwarded-for', ip)
      .set('user-agent', ua)
      .send({ email: 'admin@example.com', password: 'password123' })
      .expect(200);

    expect(loginRes.body.ok).toBe(true);
    const adminToken = loginRes.body.tokens.accessToken as string;

    const customer = await customers.save(
      customers.create({
        name: 'Acme',
        email: 'customer@example.com',
        status: 'active',
        ownerUserId: null,
      }),
    );
    await services.save(
      services.create({
        customerId: customer.id,
        primaryDomain: 'example.com',
        planName: 'basic',
        status: 'active',
        provisioningPhase: null,
        provisioningCompletedPhasesJson: '[]',
        provisioningFailedPhase: null,
        provisioningErrorJson: null,
        provisioningUpdatedAt: null,
        systemUsername: 'u_test',
        mysqlUsername: 'u_test_db',
        mysqlPasswordEnc: null,
        mailboxPasswordEnc: null,
        ftpPasswordEnc: null,
        softDeletedAt: null,
        hardDeleteEligibleAt: null,
      } as any),
    );

    const impStart = await request(app.getHttpServer())
      .post('/v1/auth/impersonation/start')
      .set('authorization', `Bearer ${adminToken}`)
      .set('x-forwarded-for', ip)
      .set('user-agent', ua)
      .send({ customerId: customer.id })
      .expect(200);

    expect(impStart.body.ok).toBe(true);
    const impToken = impStart.body.tokens.accessToken as string;
    const sessionId = impStart.body.impersonation.sessionId as string;
    expect(sessionId).toBeTruthy();

    await request(app.getHttpServer())
      .get('/v1/customers')
      .set('authorization', `Bearer ${impToken}`)
      .expect(403);

    const customerServices = await request(app.getHttpServer())
      .get('/v1/customer/hosting/services')
      .set('authorization', `Bearer ${impToken}`)
      .expect(200);

    expect(Array.isArray(customerServices.body)).toBe(true);
    expect(customerServices.body.length).toBe(1);

    await request(app.getHttpServer())
      .get('/v1/customer/hosting/services')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(403);

    const event = await loginEvents.findOne({ where: { sessionId } });
    expect(event).toBeTruthy();
    expect(event?.loginType).toBe('impersonation');
    expect(event?.customerId).toBe(customer.id);
    expect(event?.impersonatorEmail).toBe('admin@example.com');
    expect(event?.sourceIp).toBe(ip);
    expect(event?.userAgent).toBe(ua);
    expect(event?.logoutAt).toBeNull();

    await request(app.getHttpServer())
      .post('/v1/auth/impersonation/end')
      .set('authorization', `Bearer ${impToken}`)
      .expect(200);

    const revoked = await loginEvents.findOne({ where: { sessionId } });
    expect(revoked?.logoutAt).toBeTruthy();

    await request(app.getHttpServer())
      .get('/v1/customer/hosting/services')
      .set('authorization', `Bearer ${impToken}`)
      .expect(401);
  });
});
