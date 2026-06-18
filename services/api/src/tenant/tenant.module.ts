import { Module } from "@nestjs/common";
import { TenantService } from "./tenant.service.js";
import { TenantController } from "./tenant.controller.js";

@Module({
  providers: [TenantService],
  controllers: [TenantController],
  exports: [TenantService],
})
export class TenantModule {}
