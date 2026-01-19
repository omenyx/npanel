import { ToolResolver } from '../system/tool-resolver';
import type { AdapterContext, AdapterOperationResult, UserAdapter, UserSpec } from './hosting-adapters';
export declare class ShellUserAdapter implements UserAdapter {
    private readonly tools;
    constructor(tools: ToolResolver);
    ensurePresent(context: AdapterContext, spec: UserSpec): Promise<AdapterOperationResult>;
    ensureSuspended(context: AdapterContext, username: string): Promise<AdapterOperationResult>;
    ensureResumed(context: AdapterContext, username: string): Promise<AdapterOperationResult>;
    ensureAbsent(context: AdapterContext, username: string): Promise<AdapterOperationResult>;
}
