import { ToolResolver } from './tool-resolver';
export declare class SystemController {
    private readonly tools;
    constructor(tools: ToolResolver);
    status(): Promise<{
        tools: any[];
        serverInfo: {
            defaultIpv4: string;
            dnsBackend: string;
            mailBackend: string;
            ftpBackend: string;
        };
    }>;
    getSshKey(): Promise<{
        publicKey: string;
    }>;
}
