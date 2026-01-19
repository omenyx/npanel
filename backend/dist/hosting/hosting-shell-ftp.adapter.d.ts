import type { AdapterContext, AdapterOperationResult, FtpAdapter, FtpAccountSpec } from './hosting-adapters';
import { ToolResolver } from '../system/tool-resolver';
export declare class ShellFtpAdapter implements FtpAdapter {
    private readonly tools;
    constructor(tools: ToolResolver);
    ensureAccountPresent(context: AdapterContext, spec: FtpAccountSpec): Promise<AdapterOperationResult>;
    ensureAccountAbsent(context: AdapterContext, username: string): Promise<AdapterOperationResult>;
}
