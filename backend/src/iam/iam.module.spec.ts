import { describe, it, expect, beforeEach } from '@jest/globals';

describe('IamModule JWT secret', () => {
  const path = '../../src/iam/iam.module';

  beforeEach(() => {
    jest.resetModules();
    delete process.env.JWT_SECRET;
  });

  it('throws when JWT_SECRET is missing', async () => {
    await expect(async () => {
      await import(path);
    }).rejects.toThrow(/JWT_SECRET is missing or too short/);
  });

  it('throws when JWT_SECRET is too short', async () => {
    process.env.JWT_SECRET = 'short';
    await expect(async () => {
      await import(path);
    }).rejects.toThrow(/too short/);
  });

  it('succeeds with strong secret', async () => {
    process.env.JWT_SECRET = 'x'.repeat(32);
    const mod = await import(path);
    expect(mod.IamModule).toBeDefined();
  });
});
