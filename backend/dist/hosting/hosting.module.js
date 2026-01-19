"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HostingModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const hosting_service_entity_1 = require("./hosting-service.entity");
const hosting_service_1 = require("./hosting.service");
const hosting_controller_1 = require("./hosting.controller");
const hosting_plans_controller_1 = require("./hosting-plans.controller");
const system_controller_1 = require("../system/system.controller");
const accounts_module_1 = require("../accounts/accounts.module");
const hosting_adapters_1 = require("./hosting-adapters");
const hosting_shell_user_adapter_1 = require("./hosting-shell-user.adapter");
const hosting_log_entity_1 = require("./hosting-log.entity");
const hosting_plan_entity_1 = require("./hosting-plan.entity");
const hosting_shell_web_adapter_1 = require("./hosting-shell-web.adapter");
const hosting_shell_php_fpm_adapter_1 = require("./hosting-shell-php-fpm.adapter");
const hosting_shell_mysql_adapter_1 = require("./hosting-shell-mysql.adapter");
const tool_resolver_1 = require("../system/tool-resolver");
const hosting_shell_dns_adapter_1 = require("./hosting-shell-dns.adapter");
const hosting_shell_mail_adapter_1 = require("./hosting-shell-mail.adapter");
const hosting_shell_ftp_adapter_1 = require("./hosting-shell-ftp.adapter");
const hosting_credentials_service_1 = require("./hosting-credentials.service");
let HostingModule = class HostingModule {
};
exports.HostingModule = HostingModule;
exports.HostingModule = HostingModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([hosting_service_entity_1.HostingServiceEntity, hosting_log_entity_1.HostingLog, hosting_plan_entity_1.HostingPlan]),
            accounts_module_1.AccountsModule,
        ],
        providers: [
            hosting_credentials_service_1.HostingCredentialsService,
            tool_resolver_1.ToolResolver,
            hosting_service_1.HostingService,
            {
                provide: hosting_adapters_1.USER_ADAPTER,
                useClass: process.env.NPANEL_HOSTING_USER_ADAPTER === 'shell'
                    ? hosting_shell_user_adapter_1.ShellUserAdapter
                    : hosting_adapters_1.NoopUserAdapter,
            },
            {
                provide: hosting_adapters_1.WEB_SERVER_ADAPTER,
                useClass: process.env.NPANEL_HOSTING_WEB_ADAPTER === 'shell'
                    ? hosting_shell_web_adapter_1.ShellWebServerAdapter
                    : hosting_adapters_1.NoopWebServerAdapter,
            },
            {
                provide: hosting_adapters_1.PHP_FPM_ADAPTER,
                useClass: process.env.NPANEL_HOSTING_PHP_FPM_ADAPTER === 'shell'
                    ? hosting_shell_php_fpm_adapter_1.ShellPhpFpmAdapter
                    : hosting_adapters_1.NoopPhpFpmAdapter,
            },
            {
                provide: hosting_adapters_1.MYSQL_ADAPTER,
                useClass: process.env.NPANEL_HOSTING_MYSQL_ADAPTER === 'shell'
                    ? hosting_shell_mysql_adapter_1.ShellMysqlAdapter
                    : hosting_adapters_1.NoopMysqlAdapter,
            },
            {
                provide: hosting_adapters_1.DNS_ADAPTER,
                useClass: process.env.NPANEL_HOSTING_DNS_ADAPTER === 'shell'
                    ? hosting_shell_dns_adapter_1.ShellDnsAdapter
                    : hosting_adapters_1.NoopDnsAdapter,
            },
            {
                provide: hosting_adapters_1.MAIL_ADAPTER,
                useClass: process.env.NPANEL_HOSTING_MAIL_ADAPTER === 'shell'
                    ? hosting_shell_mail_adapter_1.ShellMailAdapter
                    : hosting_adapters_1.NoopMailAdapter,
            },
            {
                provide: hosting_adapters_1.FTP_ADAPTER,
                useClass: process.env.NPANEL_HOSTING_FTP_ADAPTER === 'shell'
                    ? hosting_shell_ftp_adapter_1.ShellFtpAdapter
                    : hosting_adapters_1.NoopFtpAdapter,
            },
        ],
        controllers: [hosting_controller_1.HostingController, hosting_plans_controller_1.HostingPlansController, system_controller_1.SystemController],
        exports: [hosting_service_1.HostingService],
    })
], HostingModule);
//# sourceMappingURL=hosting.module.js.map