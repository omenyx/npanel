import { HostingService } from './hosting.service';
import { CreateHostingServiceDto } from './dto/create-hosting-service.dto';
export declare class HostingController {
    private readonly hosting;
    constructor(hosting: HostingService);
    list(): Promise<import("./hosting-service.entity").HostingServiceEntity[]>;
    create(body: CreateHostingServiceDto): Promise<import("./hosting-service.entity").HostingServiceEntity | {
        service: import("./hosting-service.entity").HostingServiceEntity;
        credentials: {
            username: string;
            mysqlUsername: string;
            mysqlPassword: string;
            mailboxPassword: string;
            ftpPassword: string;
        };
    }>;
    allLogs(): Promise<import("./hosting-log.entity").HostingLog[]>;
    get(id: string): Promise<import("./hosting-service.entity").HostingServiceEntity>;
    logs(id: string): Promise<import("./hosting-log.entity").HostingLog[]>;
    provision(id: string): Promise<import("./hosting-service.entity").HostingServiceEntity>;
    suspend(id: string): Promise<import("./hosting-service.entity").HostingServiceEntity>;
    unsuspend(id: string): Promise<import("./hosting-service.entity").HostingServiceEntity>;
    terminate(id: string): Promise<void>;
    terminatePrepare(id: string): Promise<{
        token: string;
        service: import("./hosting-service.entity").HostingServiceEntity;
    }>;
    terminateConfirm(id: string, body: any): Promise<import("./hosting-service.entity").HostingServiceEntity>;
    terminateCancel(id: string): Promise<import("./hosting-service.entity").HostingServiceEntity>;
    initCredentials(id: string, body: any): Promise<{
        service: import("./hosting-service.entity").HostingServiceEntity;
        mailboxPassword: string;
        ftpPassword: string;
    }>;
}
