import { Module } from "@nestjs/common";
import { TablesService } from "./tables.service.js";
import { TablesController } from "./tables.controller.js";

@Module({
  providers: [TablesService],
  controllers: [TablesController],
})
export class TablesModule {}
