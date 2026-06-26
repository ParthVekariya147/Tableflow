import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from "@nestjs/common";
import type { AuthRequest, SupabaseClaims } from "./auth-request.js";

/**
 * Injects the verified Supabase claims AuthGuard attached — available even
 * before a matching Prisma User row exists, unlike @CurrentUser(). Used by
 * POST /auth/sync-profile, which creates that row.
 */
export const CurrentAuthClaims = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SupabaseClaims => {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    if (!req.authClaims) {
      throw new UnauthorizedException("No verified Supabase session on request");
    }
    return req.authClaims;
  },
);
