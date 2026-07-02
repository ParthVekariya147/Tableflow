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

/** Who a stream connection is scoped to — set by the guard, read by the handler. */
export type StreamScope =
  | { kind: "staff" }
  | { kind: "guest"; deviceId: string };

export type StreamRequest = TenantRequest & { streamScope?: StreamScope };

/**
 * Authenticates GET /orders/stream. EventSource can't send headers, so the
 * credential rides in the query string:
 *  - `?token=` → a staff JWT: verified, tenant-matched, and required to hold
 *    `tables.manage` (the stream exposes the whole floor — the same data as
 *    GET /orders, which is `tables.manage`-gated). Full-floor stream.
 *  - `?deviceId=` → a guest device: no account; the handler scopes the stream to
 *    ONLY that device's own sessions (never the whole floor or anyone's PII).
 *  - neither → 401.
 *
 * Doing this in a guard (not inside the observable) matters: a guard rejects
 * BEFORE Nest sends the SSE 200 headers, so a missing/invalid credential gets a
 * proper 401/403 instead of an already-open stream.
 */
@Injectable()
export class OrderStreamGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<StreamRequest>();
    const q = req.query as Record<string, unknown>;
    const token = typeof q.token === "string" ? q.token : undefined;
    const deviceId = typeof q.deviceId === "string" ? q.deviceId : undefined;

    if (token) {
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
      req.streamScope = { kind: "staff" };
      return true;
    }

    if (deviceId) {
      req.streamScope = { kind: "guest", deviceId };
      return true;
    }

    throw new UnauthorizedException("Missing credentials for order stream");
  }
}
