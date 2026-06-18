import { Body, Controller, Get, Post } from "@nestjs/common";
import type { Tenant } from "@amber/domain";
import { TenantService } from "../tenant/tenant.service.js";
import { AdminService } from "./admin.service.js";
import { createTenantSchema, type CreateTenantDto } from "./admin.dto.js";

/**
 * Super-admin, cross-tenant operations. Excluded from TenantMiddleware.
 * TODO: protect with an admin auth guard before any real deployment.
 */
@Controller("admin")
export class AdminController {
  constructor(
    private readonly tenants: TenantService,
    private readonly admin: AdminService,
  ) {}

  @Get("tenants")
  list(): Promise<Tenant[]> {
    return this.tenants.list();
  }

  @Post("tenants")
  create(@Body() body: unknown): Promise<Tenant> {
    const dto: CreateTenantDto = createTenantSchema.parse(body);
    return this.admin.createTenant(dto);
  }
}
