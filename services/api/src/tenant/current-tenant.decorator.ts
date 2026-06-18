import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Tenant } from "@amber/domain";
import type { TenantRequest } from "./tenant-request.js";

/**
 * Injects the tenant resolved by TenantMiddleware into a controller handler:
 *   findMenu(@CurrentTenant() tenant: Tenant) { ... }
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Tenant => {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    return req.tenant;
  },
);
