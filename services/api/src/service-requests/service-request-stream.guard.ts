import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { hasPermission } from "@amber/domain";
import type { TenantRequest } from "../tenant/tenant-request.js";
import { AuthService } from "../auth/auth.service.js";
import type { JwtPayload } from "../auth/auth.types.js";

/**
 * Authenticates GET /service-requests/stream — a STAFF-ONLY feed (the guest app
 * only posts requests, it never subscribes). EventSource can't set headers, so
 * the staff JWT rides in `?token=`; it's verified, tenant-matched, and required
 * to hold `tables.manage` (the same permission gating GET /service-requests and
 * the status PATCH). Missing/invalid credential → 401/403, so the feed is no
 * longer public. Auth in a guard (not the observable) so rejection happens
 * before the SSE 200 headers are sent.
 */
@Injectable()
export class ServiceRequestStreamGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    const q = req.query as Record<string, unknown>;
    const token = typeof q.token === "string" ? q.token : undefined;
    if (!token) {
      throw new UnauthorizedException("Missing token for service-request stream");
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
    const authUser = payload.imp
      ? await this.auth.resolveImpersonationUser(payload.tid, payload.slug ?? "")
      : await this.auth.resolveAuthUser(payload.tid, payload.sub);
    if (!authUser.isSuperAdmin && authUser.tenantId !== req.tenant.id) {
      throw new ForbiddenException("Token is not valid for this tenant");
    }
    if (
      !authUser.isSuperAdmin &&
      !hasPermission(authUser.permissions, "tables.manage")
    ) {
      throw new ForbiddenException("Insufficient permissions");
    }
    return true;
  }
}
