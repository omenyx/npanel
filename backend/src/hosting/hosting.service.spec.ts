import { describe, it, expect, beforeEach } from '@jest/globals';
import { HostingService } from './hosting.service';
import { Repository } from 'typeorm';
import { HostingServiceEntity } from './hosting-service.entity';
import { HostingPlan } from './hosting-plan.entity';
import { HostingLog } from './hosting-log.entity';

function repo<T extends object>() {
  const items: T[] = [] as T[];
  const r = {
    findOne: async (opts: any) => items.find((i: any) => i.id === opts.where.id || i['name'] === opts.where.name) || null,
    save: async (e: any) => {
      const idx = items.findIndex((i: any) => i['id'] === e.id);
      if (idx >= 0) items[idx] = e;
      else items.push(e);
      return e;
    },
    create: (e: any) => e,
    count: async (opts: any) => items.filter((i: any) => i['planName'] === opts.where.planName).length,
    delete: async (opts: any) => {
      const idx = items.findIndex((i: any) => (i as any).name === opts.name);
      if (idx >= 0) items.splice(idx, 1);
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
    ensureMailboxAbsent: async () => {},
    ensureAccountPresent: async () => ({ rollback: async () => {} }),
    ensureMailboxPresent: async () => ({ rollback: async () => {} }),
    ensureVhostPresent: async () => ({ rollback: async () => {} }),
    ensurePoolPresent: async () => ({ rollback: async () => {} }),
    ensurePresent: async () => ({ rollback: async () => {} }),
    ensureSuspended: async () => {},
    ensureResumed: async () => {},
    ensureAbsent: async () => {},
  };
}

describe('HostingService termination two-phase', () => {
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
      {} as any,
    );
    (servicesRepo.items as any[]).push({ id: 'svc1', customerId: 'c1', primaryDomain: 'example.com', planName: 'basic', status: 'active', terminationToken: null, terminationTokenExpiresAt: null });
  });

  it('prepare sets pending and token', async () => {
    const res = await service.terminatePrepare('svc1');
    expect(res.service.status).toBe('termination_pending');
    expect(res.token).toBeTruthy();
  });

  it('confirm with wrong token fails', async () => {
    await service.terminatePrepare('svc1');
    await expect(service.terminateConfirm('svc1', 'bad')).rejects.toThrow();
  });

  it('cancel restores active', async () => {
    await service.terminatePrepare('svc1');
    const saved = await service.terminateCancel('svc1');
    expect(saved.status).toBe('active');
    expect(saved.terminationToken).toBeNull();
  });
});

