import { Module } from "@nestjs/common";
import { LoyaltyService } from "./loyalty.service.js";
import { LoyaltyController } from "./loyalty.controller.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  providers: [LoyaltyService],
  controllers: [LoyaltyController],
})
export class LoyaltyModule {}
