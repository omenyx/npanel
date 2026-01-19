import type { AdapterContext, AdapterOperationResult, WebServerAdapter, WebVhostSpec } from './hosting-adapters';
import { ToolResolver } from '../system/tool-resolver';
export declare class ShellWebServerAdapter implements WebServerAdapter {
    private readonly tools;
    private readonly availableRoot;
    private readonly enabledRoot;
    constructor(tools: ToolResolver);
    ensureVhostPresent(context: AdapterContext, spec: WebVhostSpec): Promise<AdapterOperationResult>;
    ensureVhostSuspended(context: AdapterContext, domain: string): Promise<AdapterOperationResult>;
    ensureVhostAbsent(context: AdapterContext, domain: string): Promise<AdapterOperationResult>;
}
