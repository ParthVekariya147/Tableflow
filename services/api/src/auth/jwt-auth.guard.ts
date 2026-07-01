import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "./auth.service.js";
import type { AuthRequest, JwtPayload } from "./auth.types.js";

/**
 * Authenticates a request from its `Authorization: Bearer <jwt>` header:
 * verifies the token, re-resolves the current AuthUser (identity + role +
 * permissions) and attaches it as `req.authUser`. Use with `@CurrentUser()` and
 * pair with PermissionsGuard for capability checks.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const header = req.header("authorization");
    const token = header?.startsWith("Bearer ")
      ? header.slice(7).trim()
      : undefined;
    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }

    // Impersonation tokens (minted by POST /admin/impersonate) carry imp:true.
    // They bypass the membership check and synthesize a full-access user so
    // platform support can navigate the tenant's admin panel.
    if (payload.imp) {
      req.authUser = await this.auth.resolveImpersonationUser(payload.tid, payload.slug ?? "");
      return true;
    }

    // Re-resolve on every request so role/permission changes apply immediately
    // (also throws 401 if the membership was revoked).
    req.authUser = await this.auth.resolveAuthUser(payload.tid, payload.sub);
    return true;
  }
}
