import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { Role, Tenant } from "@amber/domain";
import { CurrentTenant } from "../tenant/current-tenant.decorator.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import {
  PermissionsGuard,
  RequirePermission,
} from "../auth/permissions.guard.js";
import { RolesService } from "./roles.service.js";
import { CreateRoleDto, UpdateRoleDto } from "./roles.dto.js";

/** Custom-role management. Admin-only (team.manage). */
@Controller("roles")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission("team.manage")
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list(@CurrentTenant() tenant: Tenant): Promise<Role[]> {
    return this.roles.list(tenant.id);
  }

  @Post()
  create(
    @CurrentTenant() tenant: Tenant,
    @Body() body: unknown,
  ): Promise<Role> {
    const dto = CreateRoleDto.parse(body);
    return this.roles.create(tenant.id, dto);
  }

  @Patch(":id")
  update(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<Role> {
    const dto = UpdateRoleDto.parse(body);
    return this.roles.update(tenant.id, id, dto);
  }

  @Delete(":id")
  remove(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
  ): Promise<{ ok: true }> {
    return this.roles.remove(tenant.id, id);
  }
}
