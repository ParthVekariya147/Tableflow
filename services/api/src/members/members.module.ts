import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { MembersService } from "./members.service.js";
import { MembersController } from "./members.controller.js";

@Module({
  imports: [AuthModule], // JwtAuthGuard + PermissionsGuard
  providers: [MembersService],
  controllers: [MembersController],
  exports: [MembersService],
})
export class MembersModule {}
