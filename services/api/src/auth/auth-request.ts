import type { Request } from "express";
import type { AuthUser } from "@amber/domain";

/** Raw claims from a verified Supabase session JWT, before a Prisma User exists. */
export interface SupabaseClaims {
  sub: string;
  email?: string;
}

/**
 * Request shape after AuthGuard runs. `user` is set once a matching Prisma
 * `User` row is found (by supabaseId, or by id for impersonation tokens);
 * `authClaims` is set whenever the bearer was a verified Supabase session,
 * even before `POST /auth/sync-profile` has created the row (sync-profile
 * itself needs the claims, not the row). `impersonation` is set only when
 * the bearer was our own impersonation JWT — see PLATFORM_PLAN.md.
 */
export interface AuthRequest extends Request {
  user?: AuthUser;
  authClaims?: SupabaseClaims;
  impersonation?: { tenantId: string; tenantSlug: string };
}
