declare class InlineCustomerDto {
    name: string;
    email: string;
}
export declare class CreateHostingServiceDto {
    customerId?: string;
    primaryDomain: string;
    planName?: string;
    customer?: InlineCustomerDto;
    autoProvision?: boolean;
}
export {};
