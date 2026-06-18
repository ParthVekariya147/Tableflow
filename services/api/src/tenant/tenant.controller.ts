import { Controller, Get, Param } from "@nestjs/common";
import type { Tenant } from "@amber/domain";
import { TenantService } from "./tenant.service.js";
import { CurrentTenant } from "./current-tenant.decorator.js";

@Controller()
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  /** The active tenant (resolved from the X-Tenant-Slug header). */
  @Get("tenant")
  current(@CurrentTenant() tenant: Tenant): Tenant {
    return tenant;
  }

  /** Look up a tenant by slug (used before theme is applied, e.g. splash). */
  @Get("tenants/:slug")
  bySlug(@Param("slug") slug: string): Promise<Tenant> {
    return this.tenants.getBySlug(slug);
  }
}
