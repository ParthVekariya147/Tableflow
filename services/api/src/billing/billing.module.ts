import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BillingService } from "./billing.service.js";
import { BillingController } from "./billing.controller.js";

@Module({
  imports: [AuthModule],
  providers: [BillingService],
  controllers: [BillingController],
  exports: [BillingService],
})
export class BillingModule {}
