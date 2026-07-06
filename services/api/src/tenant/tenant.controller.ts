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
import { toPublicDomainTenant } from "./tenant.mapper.js";

@Controller()
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  /**
   * The active tenant (resolved from the X-Tenant-Slug header). Signed-in
   * staff only — the full object carries print-agent credentials
   * (`printer.agentSecret`), so it must not be reachable pre-auth.
   */
  @Get("tenant")
  @UseGuards(JwtAuthGuard)
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

  /**
   * Look up a tenant by slug (used before theme is applied, e.g. splash).
   * Unauthenticated by design — returns a redacted tenant (no print-agent
   * credentials); the full object is only served to signed-in staff via
   * GET /tenant.
   */
  @Get("tenants/:slug")
  async bySlug(@Param("slug") slug: string): Promise<Tenant> {
    const tenant = await this.tenants.getBySlug(slug);
    return toPublicDomainTenant(tenant);
  }
}
