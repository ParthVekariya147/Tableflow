import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasPermission, type Permission } from "@amber/domain";
import type { AuthRequest } from "./auth.types.js";

export const PERMISSIONS_KEY = "required_permissions";
export const ANY_PERMISSIONS_KEY = "required_any_permissions";

/**
 * Declare the permission(s) a route requires:
 *   @RequirePermission("menu.manage")
 * Must be used together with JwtAuthGuard (which populates req.authUser).
 * All listed permissions are required (AND).
 */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Declare that a route requires AT LEAST ONE of the listed permissions (OR).
 * For endpoints shared by two capabilities — e.g. item status advance is used
 * by both the KDS (`kds.use`) and floor session management (`tables.manage`),
 * and the analytics endpoint feeds both the Dashboard (`dashboard.view`) and
 * the Analytics page (`analytics.view`). Combine with @RequirePermission if a
 * route needs both an AND-set and an OR-set.
 */
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const required =
      this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets) ??
      [];
    const requiredAny =
      this.reflector.getAllAndOverride<Permission[]>(
        ANY_PERMISSIONS_KEY,
        targets,
      ) ?? [];
    if (required.length === 0 && requiredAny.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const held = req.authUser?.permissions ?? [];
    const okAll = required.every((perm) => hasPermission(held, perm));
    const okAny =
      requiredAny.length === 0 ||
      requiredAny.some((perm) => hasPermission(held, perm));
    if (!okAll || !okAny) {
      throw new ForbiddenException("Insufficient permissions");
    }
    return true;
  }
}
