import { describe, it, expect, beforeEach } from '@jest/globals';
import { HostingService } from './hosting.service';
import { Repository } from 'typeorm';
import { HostingServiceEntity } from './hosting-service.entity';
import { HostingPlan } from './hosting-plan.entity';
import { HostingLog } from './hosting-log.entity';

function repo<T extends object>() {
  const items: T[] = [] as T[];
  const matches = (item: any, where: any) => {
    if (!where) return false;
    return Object.entries(where).every(([key, value]) => item?.[key] === value);
  };
  const r = {
    findOne: async (opts: any) =>
      items.find((i: any) => matches(i, opts?.where)) || null,
    save: async (e: any) => {
      const idx = items.findIndex((i: any) => i['id'] === e.id);
      if (idx >= 0) items[idx] = e;
      else items.push(e);
      return e;
    },
    create: (e: any) => e,
    count: async (opts: any) => items.filter((i: any) => i['planName'] === opts.where.planName).length,
    delete: async (opts: any) => {
      for (let idx = items.length - 1; idx >= 0; idx -= 1) {
        if (matches(items[idx] as any, opts)) {
          items.splice(idx, 1);
        }
      }
    },
    find: async () => items,
  } as unknown as Repository<T>;
  return { r, items };
}

function adapter() {
  return {
    ensureVhostAbsent: async () => {},
    ensurePoolAbsent: async () => {},
    ensureAccountAbsent: async () => {},
    ensureZoneAbsent: async () => {},
    ensureZonePresent: async () => ({}),
    ensureMailboxAbsent: async () => {},
    ensureAccountPresent: async () => ({ rollback: async () => {} }),
    ensureMailboxPresent: async () => ({ rollback: async () => {} }),
    ensureVhostPresent: async () => ({ rollback: async () => {} }),
    ensurePoolPresent: async () => ({ rollback: async () => {} }),
    ensurePresent: async () => ({ rollback: async () => {} }),
    ensureSuspended: async () => {},
    ensureResumed: async () => {},
    ensureAbsent: async () => {},
    listMailboxes: async () => [],
    listDatabases: async () => [],
    updatePassword: async () => {},
    resetPassword: async () => {},
  };
}

function tools() {
  return {
    statusFor: async (name: string) => ({
      name,
      available: true,
      path: `/bin/${name}`,
      method: 'fallback',
    }),
    resolve: async (name: string) => name,
  };
}

describe('HostingService termination two-phase', () => {
  let service: HostingService;
  let servicesRepo: any;
  let plansRepo: any;
  let logsRepo: any;

  beforeEach(() => {
    process.env.NPANEL_HOSTING_DRY_RUN = '1';
    const s = repo<HostingServiceEntity>();
    const p = repo<HostingPlan>();
    const l = repo<HostingLog>();
    servicesRepo = s;
    plansRepo = p;
    logsRepo = l;
    service = new HostingService(
      s.r as any,
      p.r as any,
      adapter() as any,
      adapter() as any,
      adapter() as any,
      adapter() as any,
      adapter() as any,
      adapter() as any,
      adapter() as any,
      l.r as any,
      { generateDatabasePassword: () => 'a', generateMailboxPassword: () => 'b', generateFtpPassword: () => 'c' } as any,
      {} as any,
      tools() as any,
    );
    (servicesRepo.items as any[]).push({
      id: 'svc1',
      customerId: 'c1',
      primaryDomain: 'example.com',
      planName: 'basic',
      status: 'soft_deleted',
      softDeletedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      hardDeleteEligibleAt: new Date(Date.now() - 60 * 60 * 1000),
      terminationToken: null,
      terminationTokenExpiresAt: null,
    });
  });

  it('prepare sets pending and token', async () => {
    const res = await service.terminatePrepare('svc1');
    expect(res.service.status).toBe('soft_deleted');
    expect(res.token).toBeTruthy();
  });

  it('confirm with wrong token fails', async () => {
    await service.terminatePrepare('svc1');
    await expect(service.terminateConfirm('svc1', 'bad')).rejects.toThrow();
  });

  it('cancel restores active', async () => {
    await service.terminatePrepare('svc1');
    const saved = await service.terminateCancel('svc1');
    expect(saved.status).toBe('soft_deleted');
    expect(saved.terminationToken).toBeNull();
  });

  it('confirm purge removes service record', async () => {
    const web = adapter();
    const php = adapter();
    const mysql = { ...adapter(), listDatabases: async () => ['u_example_db_app'] };
    const dns = adapter();
    const mail = {
      ...adapter(),
      listMailboxes: async () => ['postmaster@example.com', 'a@example.com'],
      ensureMailboxAbsent: async () => {},
    };
    const ftp = adapter();
    const user = adapter();
    service = new HostingService(
      servicesRepo.r as any,
      plansRepo.r as any,
      user as any,
      web as any,
      php as any,
      mysql as any,
      dns as any,
      mail as any,
      ftp as any,
      logsRepo.r as any,
      { generateDatabasePassword: () => 'a', generateMailboxPassword: () => 'b', generateFtpPassword: () => 'c' } as any,
      {} as any,
      tools() as any,
    );
    const prepared = await service.terminatePrepare('svc1');
    const confirmed = await service.terminateConfirm('svc1', prepared.token, { purge: true });
    expect(confirmed.status).toBe('terminated');
    expect((servicesRepo.items as any[]).length).toBe(0);
  });
});

describe('HostingService provisioning', () => {
  let service: HostingService;
  let servicesRepo: any;
  let plansRepo: any;
  let logsRepo: any;

  beforeEach(() => {
    process.env.NPANEL_MAIL_CMD = 'mail_cmd';
    process.env.NPANEL_FTP_CMD = 'ftp_cmd';
    const s = repo<HostingServiceEntity>();
    const p = repo<HostingPlan>();
    const l = repo<HostingLog>();
    servicesRepo = s;
    plansRepo = p;
    logsRepo = l;
    (plansRepo.items as any[]).push({
      name: 'basic',
      diskQuotaMb: 5120,
      maxDatabases: 3,
      phpVersion: '8.2',
      mailboxQuotaMb: 1024,
      maxMailboxes: 5,
      maxFtpAccounts: 1,
    });
    service = new HostingService(
      s.r as any,
      p.r as any,
      adapter() as any,
      adapter() as any,
      adapter() as any,
      adapter() as any,
      adapter() as any,
      adapter() as any,
      adapter() as any,
      l.r as any,
      { generateDatabasePassword: () => 'mysqlPass', generateMailboxPassword: () => 'mailPass', generateFtpPassword: () => 'ftpPass' } as any,
      {} as any,
      tools() as any,
    );
    (servicesRepo.items as any[]).push({
      id: 'svc1',
      customerId: 'c1',
      primaryDomain: 'example.com',
      planName: 'basic',
      status: 'provisioning',
      terminationToken: null,
      terminationTokenExpiresAt: null,
    });
  });

  it('provisionWithCredentials returns credentials and activates service', async () => {
    const res = await service.provisionWithCredentials('svc1');
    expect(res.service.status).toBe('active');
    expect(res.credentials.username).toBeTruthy();
    expect(res.credentials.mysqlPassword).toBe('mysqlPass');
    expect(res.credentials.mailboxPassword).toBe('mailPass');
    expect(res.credentials.ftpPassword).toBe('ftpPass');
  });
});

describe('HostingService create', () => {
  let service: HostingService;
  let servicesRepo: any;
  let plansRepo: any;
  let logsRepo: any;

  beforeEach(() => {
    const s = repo<HostingServiceEntity>();
    const p = repo<HostingPlan>();
    const l = repo<HostingLog>();
    servicesRepo = s;
    plansRepo = p;
    logsRepo = l;
    (plansRepo.items as any[]).push({
      name: 'basic',
      diskQuotaMb: 5120,
      maxDatabases: 3,
      phpVersion: '8.2',
      mailboxQuotaMb: 1024,
      maxMailboxes: 5,
      maxFtpAccounts: 1,
    });
    service = new HostingService(
      s.r as any,
      p.r as any,
      adapter() as any,
      adapter() as any,
      adapter() as any,
      adapter() as any,
      adapter() as any,
      adapter() as any,
      adapter() as any,
      l.r as any,
      { generateDatabasePassword: () => 'a', generateMailboxPassword: () => 'b', generateFtpPassword: () => 'c' } as any,
      {} as any,
      tools() as any,
    );
    (servicesRepo.items as any[]).push({
      id: 'old',
      customerId: 'c1',
      primaryDomain: 'sandbox.ionbytes.net',
      planName: 'basic',
      status: 'terminated',
      terminationToken: null,
      terminationTokenExpiresAt: null,
    });
  });

  it('recreates a terminated service for same domain', async () => {
    const created = await service.create({
      primaryDomain: 'sandbox.ionbytes.net',
      planName: 'basic',
      customerId: 'c1',
      autoProvision: false,
    } as any);
    expect((servicesRepo.items as any[]).length).toBe(1);
    expect((created as any).primaryDomain).toBe('sandbox.ionbytes.net');
    expect((servicesRepo.items as any[])[0].id).not.toBe('old');
  });
});

