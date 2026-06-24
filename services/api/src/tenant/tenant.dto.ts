import { updateTenantRequestSchema } from "@amber/domain";

/** Validates PATCH /tenant bodies (Branding / Restaurant Profile updates). */
export const UpdateTenantDto = updateTenantRequestSchema;
