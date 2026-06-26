import type { Request } from "express";
import type { AuthUser } from "@amber/domain";

/** Signed into the JWT; the guard re-resolves the full AuthUser from it. */
export interface JwtPayload {
  /** User id. */
  sub: string;
  /** Active tenant id (a user may belong to several tenants). */
  tid: string;
  /** Set to true for impersonation tokens minted by POST /admin/impersonate. */
  imp?: boolean;
  /** Tenant slug (carried in impersonation tokens so the recipient can set X-Tenant-Slug). */
  slug?: string;
}

/**
 * Short-lived token issued between the two login steps when a user belongs to
 * several tenants. It carries NO tenant id (none chosen yet) and a `scope`
 * marker so it can't be used as an access token. Redeemed by `selectTenant`.
 */
export interface TicketPayload {
  sub: string;
  scope: "tenant-select";
}

/** Express request after JwtAuthGuard has resolved + attached the current user. */
export interface AuthRequest extends Request {
  authUser: AuthUser;
}
