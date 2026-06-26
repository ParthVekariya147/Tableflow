import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthService } from "./auth.service.js";
import { AuthController } from "./auth.controller.js";
import { JwtAuthGuard } from "./jwt-auth.guard.js";
import { PermissionsGuard } from "./permissions.guard.js";
import { SupabaseAuthGuard } from "./auth.guard.js";
import { SuperAdminGuard } from "./super-admin.guard.js";

/**
 * Auth + RBAC. Issues/verifies JWTs (HS256) and resolves the current user's
 * role + effective permissions. JwtAuthGuard + PermissionsGuard are exported so
 * any tenant-scoped controller can gate routes with @RequirePermission(...).
 *
 * JWT_SECRET must be set in services/api/.env in production; a dev fallback
 * keeps local boot working. Tokens last 12h (a manager's shift).
 */
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? "dev-only-insecure-secret-change-me",
      signOptions: { expiresIn: "12h" },
    }),
  ],
  providers: [AuthService, JwtAuthGuard, PermissionsGuard, SupabaseAuthGuard, SuperAdminGuard],
  controllers: [AuthController],
  exports: [AuthService, JwtAuthGuard, PermissionsGuard, SupabaseAuthGuard, SuperAdminGuard, JwtModule],
})
export class AuthModule {}
