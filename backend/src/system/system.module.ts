import { Module } from '@nestjs/common';
import { ToolResolver } from './tool-resolver';
import { ToolsController } from './tools.controller';
import { HostingModule } from '../hosting/hosting.module';

@Module({
  imports: [HostingModule],
  providers: [ToolResolver],
  controllers: [ToolsController],
  exports: [ToolResolver],
})
export class SystemModule {}
