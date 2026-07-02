import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Tenant } from "@amber/domain";
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
    // req.tenant is populated by TenantMiddleware (which runs before guards) on
    // every tenant-scoped route; it is absent on auth/* (excluded from the
    // middleware, not tenant-scoped).
    const req = ctx
      .switchToHttp()
      .getRequest<AuthRequest & { tenant?: Tenant }>();
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
    } else {
      // Re-resolve on every request so role/permission changes apply immediately
      // (also throws 401 if the membership was revoked).
      req.authUser = await this.auth.resolveAuthUser(payload.tid, payload.sub);
    }

    // Tenant-isolation guard. The tenant a request operates on comes from the
    // client-controlled X-Tenant-Slug header (resolved into req.tenant); the
    // tenant the caller is actually entitled to comes from the signed token
    // (authUser.tenantId). These MUST match — otherwise a valid user of tenant A
    // could set X-Tenant-Slug: B and have the handler act on tenant B's data,
    // since the token only proves identity, not which tenant's rows may be
    // touched. Skipped when there is no req.tenant (auth/* isn't tenant-scoped).
    // Super-admins are exempt: they legitimately operate across tenants.
    if (
      req.tenant &&
      !req.authUser.isSuperAdmin &&
      req.authUser.tenantId !== req.tenant.id
    ) {
      throw new ForbiddenException("Token is not valid for this tenant");
    }

    return true;
  }
}
