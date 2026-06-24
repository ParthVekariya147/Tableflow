import { loginRequestSchema, selectTenantRequestSchema } from "@amber/domain";

/** Validates POST /auth/login bodies (re-exports the domain schema). */
export const LoginDto = loginRequestSchema;

/** Validates POST /auth/select-tenant bodies. */
export const SelectTenantDto = selectTenantRequestSchema;
