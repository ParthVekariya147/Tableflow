import type { Request } from "express";
import type { Tenant } from "@amber/domain";

/** Express request after TenantMiddleware has resolved the active tenant. */
export interface TenantRequest extends Request {
  tenant: Tenant;
}
