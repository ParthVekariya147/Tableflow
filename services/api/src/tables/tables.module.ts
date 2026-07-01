import { Module } from "@nestjs/common";
import { TablesService } from "./tables.service.js";
import { TablesController } from "./tables.controller.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  providers: [TablesService],
  controllers: [TablesController],
})
export class TablesModule {}
