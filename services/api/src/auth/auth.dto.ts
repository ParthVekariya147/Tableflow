import { loginRequestSchema } from "@amber/domain";

/** Validates POST /auth/login bodies (re-exports the domain schema). */
export const LoginDto = loginRequestSchema;
