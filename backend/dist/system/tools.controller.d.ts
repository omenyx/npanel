import { ToolResolver } from './tool-resolver';
export declare class ToolsController {
    private readonly tools;
    constructor(tools: ToolResolver);
    status(): Promise<{
        tools: any[];
    }>;
}
