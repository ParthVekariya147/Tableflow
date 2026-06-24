import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { TenantService } from "./tenant.service.js";
import { TenantController } from "./tenant.controller.js";

@Module({
  imports: [AuthModule], // JwtAuthGuard + PermissionsGuard for PATCH /tenant
  providers: [TenantService],
  controllers: [TenantController],
  exports: [TenantService],
})
export class TenantModule {}
