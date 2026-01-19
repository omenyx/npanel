import type { AdapterContext, AdapterOperationResult, DnsAdapter, DnsZoneSpec } from './hosting-adapters';
import { ToolResolver } from '../system/tool-resolver';
export declare class ShellDnsAdapter implements DnsAdapter {
    private readonly tools;
    constructor(tools: ToolResolver);
    ensureZonePresent(context: AdapterContext, spec: DnsZoneSpec): Promise<AdapterOperationResult>;
    ensureZoneAbsent(context: AdapterContext, zoneName: string): Promise<AdapterOperationResult>;
}
