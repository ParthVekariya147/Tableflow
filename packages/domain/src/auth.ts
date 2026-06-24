import { z } from "zod";
import { authUserSchema } from "./user.js";

/** Login request: email + password, scoped to the tenant in X-Tenant-Slug. */
export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Login response: a bearer token + the resolved current user. */
export const loginResponseSchema = z.object({
  token: z.string().min(1),
  user: authUserSchema,
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
