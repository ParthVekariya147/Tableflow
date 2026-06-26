import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { AuthRequest } from "./auth-request.js";

/**
 * Run after AuthGuard. Requires the resolved User to be a super-admin.
 * Impersonation tokens are explicitly rejected here — impersonating a tenant
 * must never escalate into admin-panel access, or the master-password
 * convenience would defeat its own scoping.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (req.impersonation) {
      throw new ForbiddenException("Impersonation tokens cannot access admin routes");
    }
    if (!req.user?.isSuperAdmin) {
      throw new ForbiddenException("Super-admin access required");
    }
    return true;
  }
}
