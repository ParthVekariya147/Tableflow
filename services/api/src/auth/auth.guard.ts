import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuthService } from "./auth.service.js";
import type { AuthRequest } from "./auth-request.js";

/**
 * Supabase session guard — used for routes the super-admin app calls with its
 * Supabase access token. Verifies the token via the Supabase Admin API
 * (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) and populates:
 *   req.authClaims  — always set on a valid token (even if the User row is new)
 *   req.user        — set if a matching isSuperAdmin Prisma User row exists
 *
 * Pair with SuperAdminGuard for endpoints that need an established account.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
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

    const claims = await this.auth.verifySupabaseToken(token);
    req.authClaims = claims;

    // Best-effort user lookup (may not exist yet — sync-profile creates the row).
    const user = await this.prisma.user
      .findUnique({ where: { supabaseId: claims.sub } })
      .catch(() => null);
    if (user?.isSuperAdmin) {
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        isSuperAdmin: true,
        tenantId: "",
        tenantSlug: "",
        roleId: "",
        roleName: "super-admin",
        roleProtected: true,
        permissions: [],
        mustChangePassword: false,
      };
    }

    return true;
  }
}
