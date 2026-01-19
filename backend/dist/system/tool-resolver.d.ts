export type ToolResolutionMethod = 'command_v' | 'which' | 'fallback';
export declare class ToolNotFoundError extends Error {
    readonly toolName: string;
    readonly methods: ToolResolutionMethod[];
    readonly packageHint?: string | undefined;
    constructor(toolName: string, methods: ToolResolutionMethod[], packageHint?: string | undefined);
}
export declare class ToolResolver {
    private readonly cache;
    resolve(binaryName: string, options?: {
        refresh?: boolean;
        packageHint?: string;
    }): Promise<string>;
    statusFor(binaryName: string, options?: {
        refresh?: boolean;
        packageHint?: string;
    }): Promise<{
        name: string;
        available: boolean;
        path?: string;
        method?: ToolResolutionMethod;
        error?: string;
        packageHint?: string;
        methodsTried?: ToolResolutionMethod[];
    }>;
    private isExecutable;
    private resolveViaCommandV;
    private resolveViaWhich;
    private defaultPackageHint;
}
