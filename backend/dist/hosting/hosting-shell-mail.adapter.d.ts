import type { AdapterContext, AdapterOperationResult, MailAdapter, MailboxSpec } from './hosting-adapters';
import { ToolResolver } from '../system/tool-resolver';
export declare class ShellMailAdapter implements MailAdapter {
    private readonly tools;
    constructor(tools: ToolResolver);
    ensureMailboxPresent(context: AdapterContext, spec: MailboxSpec): Promise<AdapterOperationResult>;
    ensureMailboxAbsent(context: AdapterContext, address: string): Promise<AdapterOperationResult>;
}
