"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShellDnsAdapter = void 0;
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const tool_resolver_1 = require("../system/tool-resolver");
const exec_env_1 = require("../system/exec-env");
function execCommand(command, args) {
    return new Promise((resolve) => {
        const child = (0, node_child_process_1.spawn)(command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: (0, exec_env_1.buildSafeExecEnv)(),
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('close', (code) => {
            resolve({
                code: code ?? -1,
                stdout,
                stderr,
            });
        });
    });
}
function getArgsFromEnv(baseEnvName, defaultArgs) {
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
function getDnsBackendName() {
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
function buildBindZoneFile(zoneName, records) {
    const ttl = Number.parseInt(process.env.NPANEL_BIND_DEFAULT_TTL || '300', 10) || 300;
    const primaryNs = process.env.NPANEL_BIND_DEFAULT_NS || `ns1.${zoneName}.`.toLowerCase();
    const hostmaster = process.env.NPANEL_BIND_HOSTMASTER ||
        `hostmaster.${zoneName}.`.toLowerCase();
    const serial = Number.parseInt(new Date()
        .toISOString()
        .replace(/[-:T.Z]/g, '')
        .slice(0, 10), 10);
    const lines = [];
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
function buildPowerDnsRecord(zoneName, record) {
    const type = record.type.toUpperCase();
    const data = record.data.trim();
    if (!data) {
        return null;
    }
    const ttl = Number.parseInt(process.env.NPANEL_POWERDNS_DEFAULT_TTL || '300', 10) ||
        300;
    let owner;
    if (!record.name || record.name === '@') {
        owner = zoneName;
    }
    else if (record.name.endsWith('.')) {
        owner = record.name;
    }
    else {
        owner = `${record.name}.${zoneName}`;
    }
    return { name: owner, type, ttl, data };
}
class ShellDnsAdapter {
    tools;
    constructor(tools) {
        this.tools = tools;
    }
    async ensureZonePresent(context, spec) {
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
            const zonePath = (0, node_path_1.join)(zoneRoot, `${spec.zoneName}.zone`);
            await (0, promises_1.mkdir)((0, node_path_1.dirname)(zonePath), { recursive: true });
            const zoneFile = buildBindZoneFile(spec.zoneName, spec.records);
            await (0, promises_1.writeFile)(zonePath, zoneFile, { mode: 0o640 });
            const rndcBin = process.env.NPANEL_BIND_RNDC_CMD || 'rndc';
            let rndcPath;
            try {
                rndcPath = await this.tools.resolve(rndcBin, {
                    packageHint: 'bind or bind-utils package',
                });
            }
            catch (err) {
                if (err instanceof tool_resolver_1.ToolNotFoundError) {
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
            const cliArgs = [...rndcArgs, 'reload', spec.zoneName];
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
        }
        else if (backend === 'powerdns') {
            const pdnsBin = process.env.NPANEL_POWERDNS_PDNSUTIL_CMD || 'pdnsutil';
            let pdnsPath;
            try {
                pdnsPath = await this.tools.resolve(pdnsBin, {
                    packageHint: 'pdns-server and pdns-backend package',
                });
            }
            catch (err) {
                if (err instanceof tool_resolver_1.ToolNotFoundError) {
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
            const listResult = await execCommand(pdnsPath, [
                ...baseArgs,
                'list-zone',
                spec.zoneName,
            ]);
            if (listResult.code !== 0) {
                const ns = process.env.NPANEL_POWERDNS_DEFAULT_NS ||
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
            const entries = spec.records;
            for (const record of entries) {
                const recordArgs = buildPowerDnsRecord(spec.zoneName, record);
                if (!recordArgs) {
                    continue;
                }
                const recordResult = await execCommand(pdnsPath, [
                    ...baseArgs,
                    'add-record',
                    spec.zoneName,
                    recordArgs.name,
                    recordArgs.type,
                    String(recordArgs.ttl),
                    recordArgs.data,
                ]);
                if (recordResult.code !== 0) {
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
                            args: [
                                ...baseArgs,
                                'add-record',
                                spec.zoneName,
                                recordArgs.name,
                                recordArgs.type,
                                String(recordArgs.ttl),
                                recordArgs.data,
                            ],
                            stdout: recordResult.stdout,
                            stderr: recordResult.stderr,
                        },
                        errorMessage: 'dns_powerdns_add_record_failed',
                    });
                    throw new Error('dns_powerdns_add_record_failed');
                }
            }
        }
        else {
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
    async ensureZoneAbsent(context, zoneName) {
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
            const zonePath = (0, node_path_1.join)(zoneRoot, `${zoneName}.zone`);
            await (0, promises_1.unlink)(zonePath).catch(() => { });
            const rndcBin = process.env.NPANEL_BIND_RNDC_CMD || 'rndc';
            let rndcPath;
            try {
                rndcPath = await this.tools.resolve(rndcBin, {
                    packageHint: 'bind or bind-utils package',
                });
            }
            catch (err) {
                if (err instanceof tool_resolver_1.ToolNotFoundError) {
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
            const cliArgs = [...rndcArgs, 'reload', zoneName];
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
        }
        else if (backend === 'powerdns') {
            const pdnsBin = process.env.NPANEL_POWERDNS_PDNSUTIL_CMD || 'pdnsutil';
            let pdnsPath;
            try {
                pdnsPath = await this.tools.resolve(pdnsBin, {
                    packageHint: 'pdns-server and pdns-backend package',
                });
            }
            catch (err) {
                if (err instanceof tool_resolver_1.ToolNotFoundError) {
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
        }
        else {
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
}
exports.ShellDnsAdapter = ShellDnsAdapter;
//# sourceMappingURL=hosting-shell-dns.adapter.js.map