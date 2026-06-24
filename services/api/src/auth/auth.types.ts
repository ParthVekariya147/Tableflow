import type { Request } from "express";
import type { AuthUser } from "@amber/domain";

/** Signed into the JWT; the guard re-resolves the full AuthUser from it. */
export interface JwtPayload {
  /** User id. */
  sub: string;
  /** Active tenant id (a user may belong to several tenants). */
  tid: string;
}

/** Express request after JwtAuthGuard has resolved + attached the current user. */
export interface AuthRequest extends Request {
  authUser: AuthUser;
}
