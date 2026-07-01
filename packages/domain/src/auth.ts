import { z } from "zod";
import { idSchema } from "./common.js";
import { authUserSchema } from "./user.js";

/**
 * Login request: email + password only — **not** tenant-scoped. The server
 * identifies the user globally, then resolves which tenant(s) they belong to
 * (email-first login, so the admin panel no longer hardcodes one restaurant).
 */
export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Login response: a bearer token + the resolved current user. */
export const loginResponseSchema = z.object({
  token: z.string().min(1),
  user: authUserSchema,
});

/** One restaurant a user can sign into, shown in the post-login tenant picker. */
export const tenantOptionSchema = z.object({
  id: idSchema,
  slug: z.string().min(1),
  name: z.string().min(1),
});

/**
 * Result of `POST /auth/login`. Email-first login has two outcomes:
 * - `authenticated`: the user belongs to exactly one restaurant → straight in
 *   (token + user).
 * - `select_tenant`: the user belongs to several → no token yet; the client shows
 *   a picker and calls `POST /auth/select-tenant` with the short-lived `ticket`
 *   (proves the password was already verified) + the chosen tenant id.
 */
export const loginResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("authenticated"),
    token: z.string().min(1),
    user: authUserSchema,
  }),
  z.object({
    kind: z.literal("select_tenant"),
    ticket: z.string().min(1),
    tenants: z.array(tenantOptionSchema).min(2),
  }),
]);

/** Second step of a multi-tenant login: redeem the ticket for the chosen tenant. */
export const selectTenantRequestSchema = z.object({
  ticket: z.string().min(1),
  tenantId: idSchema,
});

/**
 * Self-service password change. `currentPassword` is required even when the
 * caller is on the forced `mustChangePassword` default (`changeme123`) — it's
 * still a real credential check, not just an allowed-to-proceed check.
 */
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type TenantOption = z.infer<typeof tenantOptionSchema>;
export type LoginResult = z.infer<typeof loginResultSchema>;
export type SelectTenantRequest = z.infer<typeof selectTenantRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
