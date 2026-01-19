import { HostingService } from './hosting.service';
import { CreateHostingPlanDto } from './dto/create-hosting-plan.dto';
export declare class HostingPlansController {
    private readonly hosting;
    constructor(hosting: HostingService);
    list(): Promise<import("./hosting-plan.entity").HostingPlan[]>;
    create(body: CreateHostingPlanDto): Promise<import("./hosting-plan.entity").HostingPlan>;
    remove(name: string): Promise<{
        deleted: boolean;
    }>;
}
