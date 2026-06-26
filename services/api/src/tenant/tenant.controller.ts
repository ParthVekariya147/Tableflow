import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import type { Tenant } from "@amber/domain";
import { TenantService } from "./tenant.service.js";
import { CurrentTenant } from "./current-tenant.decorator.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import {
  PermissionsGuard,
  RequirePermission,
} from "../auth/permissions.guard.js";
import { UpdateTenantDto } from "./tenant.dto.js";

@Controller()
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  /** The active tenant (resolved from the X-Tenant-Slug header). */
  @Get("tenant")
  current(@CurrentTenant() tenant: Tenant): Tenant {
    return tenant;
  }

  /**
   * Update the active tenant's own settings (Branding theme / Restaurant
   * Profile). Admin-only via `settings.manage`; scoped to the caller's tenant.
   */
  @Patch("tenant")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("settings.manage")
  update(@CurrentTenant() tenant: Tenant, @Body() body: unknown): Promise<Tenant> {
    const dto = UpdateTenantDto.parse(body);
    return this.tenants.update(tenant.id, dto);
  }

  /** Look up a tenant by slug (used before theme is applied, e.g. splash). */
  @Get("tenants/:slug")
  bySlug(@Param("slug") slug: string): Promise<Tenant> {
    return this.tenants.getBySlug(slug);
  }
}
