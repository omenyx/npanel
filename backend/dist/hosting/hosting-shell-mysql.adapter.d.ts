import type { AdapterContext, AdapterOperationResult, MysqlAdapter, MysqlAccountSpec } from './hosting-adapters';
import { ToolResolver } from '../system/tool-resolver';
export declare class ShellMysqlAdapter implements MysqlAdapter {
    private readonly tools;
    constructor(tools: ToolResolver);
    ensureAccountPresent(context: AdapterContext, spec: MysqlAccountSpec): Promise<AdapterOperationResult>;
    ensureAccountAbsent(context: AdapterContext, username: string): Promise<AdapterOperationResult>;
}
