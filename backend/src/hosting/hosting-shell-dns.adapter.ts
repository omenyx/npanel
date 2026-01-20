import { mkdir, unlink, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  AdapterContext,
  AdapterOperationResult,
  DnsAdapter,
  DnsRecordSpec,
  DnsZoneSpec,
} from './hosting-adapters';
import { ToolResolver, ToolNotFoundError } from '../system/tool-resolver';
import { execCommand, type ExecResult } from '../system/exec-command';

function getArgsFromEnv(baseEnvName: string, defaultArgs: string[]): string[] {
  const argsValue = process.env[`${baseEnvName}_ARGS`];
  if (!argsValue) {
    return defaultArgs;
  }
  const parts = argsValue
    .split(' ')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts : defaultArgs;
}

function getDnsBackendName(): string | null {
  const raw = process.env.NPANEL_DNS_BACKEND;
  if (!raw) {
    return null;
  }
  const lowered = raw.toLowerCase();
  if (lowered === 'bind' || lowered === 'powerdns') {
    return lowered;
  }
  return raw;
}

function buildBindZoneFile(zoneName: string, records: DnsRecordSpec[]): string {
  const ttl =
    Number.parseInt(process.env.NPANEL_BIND_DEFAULT_TTL || '300', 10) || 300;
  const primaryNs =
    process.env.NPANEL_BIND_DEFAULT_NS || `ns1.${zoneName}.`.toLowerCase();
  const hostmaster =
    process.env.NPANEL_BIND_HOSTMASTER ||
    `hostmaster.${zoneName}.`.toLowerCase();
  const serial = Number.parseInt(
    new Date()
      .toISOString()
      .replace(/[-:T.Z]/g, '')
      .slice(0, 10),
    10,
  );
  const lines: string[] = [];
  lines.push(`$TTL ${ttl}`);
  lines.push(`@ IN SOA ${primaryNs} ${hostmaster} (`);
  lines.push(`  ${Number.isNaN(serial) ? 1 : serial}`);
  lines.push('  3600');
  lines.push('  900');
  lines.push('  1209600');
  lines.push('  300');
  lines.push(')');
  lines.push(`@ IN NS ${primaryNs}`);
  for (const record of records) {
    const owner = !record.name || record.name === '@' ? '@' : record.name;
    const type = record.type.toUpperCase();
    const data = record.data.trim();
    if (!data) {
      continue;
    }
    lines.push(`${owner} IN ${type} ${data}`);
  }
  return `${lines.join('\n')}\n`;
}

function buildPowerDnsRecord(
  zoneName: string,
  record: DnsRecordSpec,
): { name: string; type: string; ttl: number; data: string } | null {
  const type = record.type.toUpperCase();
  const data = record.data.trim();
  if (!data) {
    return null;
  }
  const ttl =
    Number.parseInt(process.env.NPANEL_POWERDNS_DEFAULT_TTL || '300', 10) ||
    300;
  let owner: string;
  if (!record.name || record.name === '@') {
    owner = zoneName;
  } else if (record.name.endsWith('.')) {
    owner = record.name;
  } else {
    owner = `${record.name}.${zoneName}`;
  }
  return { name: owner, type, ttl, data };
}

export class ShellDnsAdapter implements DnsAdapter {
  constructor(private readonly tools: ToolResolver) {}

  async ensureZonePresent(
    context: AdapterContext,
    spec: DnsZoneSpec,
  ): Promise<AdapterOperationResult> {
    const backend = getDnsBackendName();
    if (!backend) {
      await context.log({
        adapter: 'dns_shell',
        operation: 'create',
        targetKind: 'dns_zone',
        targetKey: spec.zoneName,
        success: false,
        dryRun: context.dryRun,
        details: {},
        errorMessage: 'dns_backend_not_configured',
      });
      if (!context.dryRun) {
        throw new Error('dns_backend_not_configured');
      }
      return {};
    }
    if (context.dryRun) {
      await context.log({
        adapter: 'dns_shell',
        operation: 'create',
        targetKind: 'dns_zone',
        targetKey: spec.zoneName,
        success: true,
        dryRun: true,
        details: {
          backend,
        },
        errorMessage: null,
      });
      return {};
    }
    if (backend === 'bind') {
      const zoneRoot = process.env.NPANEL_BIND_ZONE_ROOT || '/etc/named';
      const zonePath = join(zoneRoot, `${spec.zoneName}.zone`);
      await mkdir(dirname(zonePath), { recursive: true });
      const zoneFile = buildBindZoneFile(spec.zoneName, spec.records);
      await writeFile(zonePath, zoneFile, { mode: 0o640 });
      const rndcBin = process.env.NPANEL_BIND_RNDC_CMD || 'rndc';
      let rndcPath: string;
      try {
        rndcPath = await this.tools.resolve(rndcBin, {
          packageHint: 'bind or bind-utils package',
        });
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
          await context.log({
            adapter: 'dns_shell',
            operation: 'create',
            targetKind: 'dns_zone',
            targetKey: spec.zoneName,
            success: false,
            dryRun: false,
            details: {
              backend,
              tool: err.toolName,
              feature: 'dns_bind_rndc',
              packageHint: err.packageHint ?? null,
              methodsTried: err.methods,
            },
            errorMessage: 'tool_not_found',
          });
        }
        throw err;
      }
      const rndcArgs = getArgsFromEnv('NPANEL_BIND_RNDC', []);
      const cliArgs: string[] = [...rndcArgs, 'reload', spec.zoneName];
      const result = await execCommand(rndcPath, cliArgs);
      if (result.code !== 0) {
        await context.log({
          adapter: 'dns_shell',
          operation: 'create',
          targetKind: 'dns_zone',
          targetKey: spec.zoneName,
          success: false,
          dryRun: false,
          details: {
            backend: backend ?? null,
            command: rndcPath,
            args: cliArgs,
            stdout: result.stdout,
            stderr: result.stderr,
          },
          errorMessage: 'dns_bind_apply_failed',
        });
        throw new Error('dns_bind_apply_failed');
      }
    } else if (backend === 'powerdns') {
      const pdnsBin = process.env.NPANEL_POWERDNS_PDNSUTIL_CMD || 'pdnsutil';
      let pdnsPath: string;
      try {
        pdnsPath = await this.tools.resolve(pdnsBin, {
          packageHint: 'pdns-server and pdns-backend package',
        });
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
          await context.log({
            adapter: 'dns_shell',
            operation: 'create',
            targetKind: 'dns_zone',
            targetKey: spec.zoneName,
            success: false,
            dryRun: false,
            details: {
              backend,
              tool: err.toolName,
              feature: 'dns_powerdns_pdnsutil',
              packageHint: err.packageHint ?? null,
              methodsTried: err.methods,
            },
            errorMessage: 'tool_not_found',
          });
        }
        throw err;
      }
      const baseArgs = getArgsFromEnv('NPANEL_POWERDNS_PDNSUTIL', []);
      
      // Ensure zone exists
      const listResult = await execCommand(pdnsPath, [
        ...baseArgs,
        'list-zone',
        spec.zoneName,
      ]);
      if (listResult.code !== 0) {
        const ns =
          process.env.NPANEL_POWERDNS_DEFAULT_NS ||
          `ns1.${spec.zoneName}`.toLowerCase();
        const createResult = await execCommand(pdnsPath, [
          ...baseArgs,
          'create-zone',
          spec.zoneName,
          ns,
        ]);
        if (createResult.code !== 0) {
          await context.log({
            adapter: 'dns_shell',
            operation: 'create',
            targetKind: 'dns_zone',
            targetKey: spec.zoneName,
            success: false,
            dryRun: false,
            details: {
              backend,
              command: pdnsPath,
              args: [...baseArgs, 'create-zone', spec.zoneName, ns],
              stdout: createResult.stdout,
              stderr: createResult.stderr,
            },
            errorMessage: 'dns_powerdns_zone_create_failed',
          });
          throw new Error('dns_powerdns_zone_create_failed');
        }
      }

      // Use load-zone to sync records
      const zoneContent = buildBindZoneFile(spec.zoneName, spec.records);
      const tmpFile = join('/tmp', `npanel-dns-${spec.zoneName}-${Date.now()}.zone`);
      await writeFile(tmpFile, zoneContent, { mode: 0o644 });

      const loadResult = await execCommand(pdnsPath, [
        ...baseArgs,
        'load-zone',
        spec.zoneName,
        tmpFile,
      ]);

      await unlink(tmpFile).catch(() => {});

      if (loadResult.code !== 0) {
        await context.log({
          adapter: 'dns_shell',
          operation: 'create',
          targetKind: 'dns_zone',
          targetKey: spec.zoneName,
          success: false,
          dryRun: false,
          details: {
            backend,
            command: pdnsPath,
            args: [...baseArgs, 'load-zone', spec.zoneName, tmpFile],
            stdout: loadResult.stdout,
            stderr: loadResult.stderr,
          },
          errorMessage: 'dns_powerdns_load_zone_failed',
        });
        throw new Error('dns_powerdns_load_zone_failed');
      }
    } else {
      await context.log({
        adapter: 'dns_shell',
        operation: 'create',
        targetKind: 'dns_zone',
        targetKey: spec.zoneName,
        success: false,
        dryRun: false,
        details: {
          backend,
        },
        errorMessage: 'dns_backend_unsupported',
      });
      throw new Error('dns_backend_unsupported');
    }
    await context.log({
      adapter: 'dns_shell',
      operation: 'create',
      targetKind: 'dns_zone',
      targetKey: spec.zoneName,
      success: true,
      dryRun: context.dryRun,
      details: backend ? { backend } : {},
      errorMessage: null,
    });
    return {};
  }

  async ensureZoneAbsent(
    context: AdapterContext,
    zoneName: string,
  ): Promise<AdapterOperationResult> {
    const backend = getDnsBackendName();
    if (!backend) {
      await context.log({
        adapter: 'dns_shell',
        operation: 'delete',
        targetKind: 'dns_zone',
        targetKey: zoneName,
        success: false,
        dryRun: context.dryRun,
        details: {},
        errorMessage: 'dns_backend_not_configured',
      });
      if (!context.dryRun) {
        throw new Error('dns_backend_not_configured');
      }
      return {};
    }
    if (context.dryRun) {
      await context.log({
        adapter: 'dns_shell',
        operation: 'delete',
        targetKind: 'dns_zone',
        targetKey: zoneName,
        success: true,
        dryRun: true,
        details: {
          backend,
        },
        errorMessage: null,
      });
      return {};
    }
    if (backend === 'bind') {
      const zoneRoot = process.env.NPANEL_BIND_ZONE_ROOT || '/etc/named';
      const zonePath = join(zoneRoot, `${zoneName}.zone`);
      await unlink(zonePath).catch(() => {});
      const rndcBin = process.env.NPANEL_BIND_RNDC_CMD || 'rndc';
      let rndcPath: string;
      try {
        rndcPath = await this.tools.resolve(rndcBin, {
          packageHint: 'bind or bind-utils package',
        });
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
          await context.log({
            adapter: 'dns_shell',
            operation: 'delete',
            targetKind: 'dns_zone',
            targetKey: zoneName,
            success: false,
            dryRun: false,
            details: {
              backend,
              tool: err.toolName,
              feature: 'dns_bind_rndc',
              packageHint: err.packageHint ?? null,
              methodsTried: err.methods,
            },
            errorMessage: 'tool_not_found',
          });
        }
        throw err;
      }
      const rndcArgs = getArgsFromEnv('NPANEL_BIND_RNDC', []);
      const cliArgs: string[] = [...rndcArgs, 'reload', zoneName];
      const result = await execCommand(rndcPath, cliArgs);
      if (result.code !== 0) {
        await context.log({
          adapter: 'dns_shell',
          operation: 'delete',
          targetKind: 'dns_zone',
          targetKey: zoneName,
          success: false,
          dryRun: false,
          details: {
            backend,
            command: rndcPath,
            args: cliArgs,
            stdout: result.stdout,
            stderr: result.stderr,
          },
          errorMessage: 'dns_bind_delete_failed',
        });
        throw new Error('dns_bind_delete_failed');
      }
    } else if (backend === 'powerdns') {
      const pdnsBin = process.env.NPANEL_POWERDNS_PDNSUTIL_CMD || 'pdnsutil';
      let pdnsPath: string;
      try {
        pdnsPath = await this.tools.resolve(pdnsBin, {
          packageHint: 'pdns-server and pdns-backend package',
        });
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
          await context.log({
            adapter: 'dns_shell',
            operation: 'delete',
            targetKind: 'dns_zone',
            targetKey: zoneName,
            success: false,
            dryRun: false,
            details: {
              backend,
              tool: err.toolName,
              feature: 'dns_powerdns_pdnsutil',
              packageHint: err.packageHint ?? null,
              methodsTried: err.methods,
            },
            errorMessage: 'tool_not_found',
          });
        }
        throw err;
      }
      const baseArgs = getArgsFromEnv('NPANEL_POWERDNS_PDNSUTIL', []);
      const result = await execCommand(pdnsPath, [
        ...baseArgs,
        'delete-zone',
        zoneName,
      ]);
      if (result.code !== 0) {
        await context.log({
          adapter: 'dns_shell',
          operation: 'delete',
          targetKind: 'dns_zone',
          targetKey: zoneName,
          success: false,
          dryRun: false,
          details: {
            backend,
            command: pdnsPath,
            args: [...baseArgs, 'delete-zone', zoneName],
            stdout: result.stdout,
            stderr: result.stderr,
          },
          errorMessage: 'dns_powerdns_delete_failed',
        });
        throw new Error('dns_powerdns_delete_failed');
      }
    } else {
      await context.log({
        adapter: 'dns_shell',
        operation: 'delete',
        targetKind: 'dns_zone',
        targetKey: zoneName,
        success: false,
        dryRun: false,
        details: {
          backend,
        },
        errorMessage: 'dns_backend_unsupported',
      });
      throw new Error('dns_backend_unsupported');
    }
    await context.log({
      adapter: 'dns_shell',
      operation: 'delete',
      targetKind: 'dns_zone',
      targetKey: zoneName,
      success: true,
      dryRun: context.dryRun,
      details: backend ? { backend } : {},
      errorMessage: null,
    });
    return {};
  }

  async listRecords(
    context: AdapterContext,
    zoneName: string,
  ): Promise<DnsRecordSpec[]> {
    const backend = getDnsBackendName();
    if (!backend) {
      return [];
    }

    if (backend === 'powerdns') {
      const pdnsBin = process.env.NPANEL_POWERDNS_PDNSUTIL_CMD || 'pdnsutil';
      const pdnsPath = await this.tools.resolve(pdnsBin);
      const baseArgs = getArgsFromEnv('NPANEL_POWERDNS_PDNSUTIL', []);
      const result = await execCommand(pdnsPath, [
        ...baseArgs,
        'list-zone',
        zoneName,
      ]);

      if (result.code !== 0) {
        return [];
      }

      const records: DnsRecordSpec[] = [];
      const lines = result.stdout.split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) {
          continue;
        }
        const fqdn = parts[0].replace(/\.$/, '');
        const type = parts[3];
        const data = parts.slice(4).join(' ');

        let relativeName = fqdn;
        if (fqdn === zoneName) {
          relativeName = '@';
        } else if (fqdn.endsWith(`.${zoneName}`)) {
          relativeName = fqdn.substring(0, fqdn.length - zoneName.length - 1);
        }

        records.push({
          name: relativeName,
          type,
          data,
        });
      }
      return records;
    }
    return [];
  }

  async listZones(context: AdapterContext): Promise<string[]> {
    const backend = getDnsBackendName();
    if (!backend) {
      return [];
    }
    if (backend === 'powerdns') {
      const pdnsBin = process.env.NPANEL_POWERDNS_PDNSUTIL_CMD || 'pdnsutil';
      const pdnsPath = await this.tools.resolve(pdnsBin);
      const baseArgs = getArgsFromEnv('NPANEL_POWERDNS_PDNSUTIL', []);
      const result = await execCommand(pdnsPath, [...baseArgs, 'list-all-zones']);
      if (result.code !== 0) {
        return [];
      }
      return result.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    } else if (backend === 'bind') {
      const zoneRoot = process.env.NPANEL_BIND_ZONE_ROOT || '/etc/named';
      try {
        const files = await readdir(zoneRoot);
        return files
          .filter((f) => f.endsWith('.zone'))
          .map((f) => f.substring(0, f.length - 5));
      } catch {
        return [];
      }
    }
    return [];
  }
}
