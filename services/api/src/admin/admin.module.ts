import { Module } from "@nestjs/common";
import { TenantModule } from "../tenant/tenant.module.js";
import { AdminService } from "./admin.service.js";
import { AdminController } from "./admin.controller.js";

@Module({
  imports: [TenantModule],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
