import { OnModuleInit } from '@nestjs/common';
import { Repository } from 'typeorm';
import { HostingServiceEntity } from './hosting-service.entity';
import { HostingPlan } from './hosting-plan.entity';
import { CreateHostingServiceDto } from './dto/create-hosting-service.dto';
import type { DnsAdapter, FtpAdapter, MailAdapter, MysqlAdapter, PhpFpmAdapter, UserAdapter, WebServerAdapter } from './hosting-adapters';
import { HostingLog } from './hosting-log.entity';
import { HostingCredentialsService } from './hosting-credentials.service';
import { AccountsService } from '../accounts/accounts.service';
import { ToolResolver } from '../system/tool-resolver';
export declare class HostingService implements OnModuleInit {
    private readonly services;
    private readonly plans;
    private readonly userAdapter;
    private readonly webServerAdapter;
    private readonly phpFpmAdapter;
    private readonly mysqlAdapter;
    private readonly dnsAdapter;
    private readonly mailAdapter;
    private readonly ftpAdapter;
    private readonly logs;
    private readonly credentials;
    private readonly accounts;
    private readonly tools;
    constructor(services: Repository<HostingServiceEntity>, plans: Repository<HostingPlan>, userAdapter: UserAdapter, webServerAdapter: WebServerAdapter, phpFpmAdapter: PhpFpmAdapter, mysqlAdapter: MysqlAdapter, dnsAdapter: DnsAdapter, mailAdapter: MailAdapter, ftpAdapter: FtpAdapter, logs: Repository<HostingLog>, credentials: HostingCredentialsService, accounts: AccountsService, tools: ToolResolver);
    onModuleInit(): Promise<void>;
    listPlans(): Promise<HostingPlan[]>;
    createPlan(input: any): Promise<HostingPlan>;
    deletePlan(name: string): Promise<{
        deleted: boolean;
    }>;
    list(): Promise<HostingServiceEntity[]>;
    create(input: CreateHostingServiceDto): Promise<HostingServiceEntity | {
        service: HostingServiceEntity;
        credentials: {
            username: string;
            mysqlUsername: string;
            mysqlPassword: string;
            mailboxPassword: string;
            ftpPassword: string;
        };
    }>;
    get(id: string): Promise<HostingServiceEntity>;
    listLogs(serviceId: string): Promise<HostingLog[]>;
    listAllLogs(): Promise<HostingLog[]>;
    provision(id: string): Promise<HostingServiceEntity>;
    provisionWithCredentials(id: string): Promise<{
        service: HostingServiceEntity;
        credentials: {
            username: string;
            mysqlUsername: string;
            mysqlPassword: string;
            mailboxPassword: string;
            ftpPassword: string;
        };
    }>;
    initCredentials(id: string, input: {
        mailboxPassword?: string;
        ftpPassword?: string;
    }): Promise<{
        service: HostingServiceEntity;
        mailboxPassword: string;
        ftpPassword: string;
    }>;
    suspend(id: string): Promise<HostingServiceEntity>;
    unsuspend(id: string): Promise<HostingServiceEntity>;
    terminate(id: string): Promise<HostingServiceEntity>;
    terminatePrepare(id: string): Promise<{
        token: string;
        service: HostingServiceEntity;
    }>;
    terminateConfirm(id: string, token: string): Promise<HostingServiceEntity>;
    terminateCancel(id: string): Promise<HostingServiceEntity>;
    private buildAdapterContext;
    private checkToolReadinessForProvision;
    private deriveSystemUsername;
    private buildDefaultDnsRecords;
}
