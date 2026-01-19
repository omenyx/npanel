import type { AdapterContext, AdapterOperationResult, PhpFpmAdapter, PhpFpmPoolSpec } from './hosting-adapters';
import { ToolResolver } from '../system/tool-resolver';
export declare class ShellPhpFpmAdapter implements PhpFpmAdapter {
    private readonly tools;
    private readonly poolRoot;
    constructor(tools: ToolResolver);
    ensurePoolPresent(context: AdapterContext, spec: PhpFpmPoolSpec): Promise<AdapterOperationResult>;
    ensurePoolAbsent(context: AdapterContext, name: string): Promise<AdapterOperationResult>;
}
