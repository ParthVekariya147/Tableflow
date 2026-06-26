import { Module } from "@nestjs/common";
import { TenantModule } from "../tenant/tenant.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { AdminService } from "./admin.service.js";
import { AdminController } from "./admin.controller.js";

@Module({
  imports: [TenantModule, BillingModule, AuthModule],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
