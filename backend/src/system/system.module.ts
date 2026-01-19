import { Module } from '@nestjs/common';
import { ToolResolver } from './tool-resolver';
import { ToolsController } from './tools.controller';

@Module({
  providers: [ToolResolver],
  controllers: [ToolsController],
  exports: [ToolResolver],
})
export class SystemModule {}
