import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { RolesService } from "./roles.service.js";
import { RolesController } from "./roles.controller.js";

@Module({
  imports: [AuthModule], // JwtAuthGuard + PermissionsGuard
  providers: [RolesService],
  controllers: [RolesController],
  exports: [RolesService],
})
export class RolesModule {}
