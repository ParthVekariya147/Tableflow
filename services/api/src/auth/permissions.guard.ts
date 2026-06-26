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

/**
 * Declare the permission(s) a route requires:
 *   @RequirePermission("menu.manage")
 * Must be used together with JwtAuthGuard (which populates req.authUser).
 * All listed permissions are required (AND).
 */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const held = req.authUser?.permissions ?? [];
    const ok = required.every((perm) => hasPermission(held, perm));
    if (!ok) {
      throw new ForbiddenException("Insufficient permissions");
    }
    return true;
  }
}
