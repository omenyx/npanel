import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MigrationService } from './migration.service';
import { Repository } from 'typeorm';
import { MigrationJob } from './migration-job.entity';
import { MigrationAccount } from './migration-account.entity';
import { MigrationStep } from './migration-step.entity';
import { MigrationLog } from './migration-log.entity';

function repo<T extends object>() {
  const items: T[] = [] as T[];
  const r = {
    findOne: async (opts: any) => items.find((i: any) => i.id === opts.where.id) || null,
    save: async (e: any) => { items.push(e); return e; },
    create: (e: any) => e,
    find: async () => items,
  } as unknown as Repository<T>;
  return { r, items };
}

describe('MigrationService SSH host key verification', () => {
  let service: MigrationService;
  let jobsRepo: any;
  let accountsRepo: any;
  let stepsRepo: any;
  let logsRepo: any;

  beforeEach(() => {
    const j = repo<MigrationJob>();
    const a = repo<MigrationAccount>();
    const s = repo<MigrationStep>();
    const l = repo<MigrationLog>();
    jobsRepo = j; accountsRepo = a; stepsRepo = s; logsRepo = l;
    service = new MigrationService(
      j.r as any,
      a.r as any,
      s.r as any,
      l.r as any,
      { resolve: async () => 'rsync' } as any,
      {} as any,
    );
  });

  it('builds SSH args with StrictHostKeyChecking=yes', async () => {
    const job = await jobsRepo.r.save({ id: 'j1', name: 'job', sourceType: 'cpanel_live_ssh', status: 'pending', sourceConfig: { host: 'h', sshUser: 'u' }, dryRun: false });
    const acct = await accountsRepo.r.save({ id: 'a1', job, sourceUsername: 'user', sourcePrimaryDomain: 'd' });
    const step = await stepsRepo.r.save({ id: 's1', job, account: acct, name: 'rsync_home_directory', status: 'pending', payload: { sourcePath: '/home/user', targetPath: '/tmp/user' } });
    const spy = jest.spyOn(service as any, 'execRsync').mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    await (service as any).handleRsyncHome(step, job);
    const args = spy.mock.calls[0][1] as string[];
    const eIdx = args.indexOf('-e');
    const sshCfg = args[eIdx + 1];
    expect(sshCfg).toContain('StrictHostKeyChecking=yes');
  });
});

