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
import type { Membership, Tenant } from "@amber/domain";
import { CurrentTenant } from "../tenant/current-tenant.decorator.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import {
  PermissionsGuard,
  RequirePermission,
} from "../auth/permissions.guard.js";
import { MembersService } from "./members.service.js";
import { AddMemberDto, UpdateMemberDto } from "./members.dto.js";

/** Team/user management. Admin-only (team.manage). */
@Controller("members")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission("team.manage")
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(@CurrentTenant() tenant: Tenant): Promise<Membership[]> {
    return this.members.list(tenant.id);
  }

  @Post()
  add(@CurrentTenant() tenant: Tenant, @Body() body: unknown): Promise<Membership> {
    const dto = AddMemberDto.parse(body);
    return this.members.add(tenant.id, dto);
  }

  @Patch(":id")
  update(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<Membership> {
    const dto = UpdateMemberDto.parse(body);
    return this.members.update(tenant.id, id, dto);
  }

  @Delete(":id")
  remove(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
  ): Promise<{ ok: true }> {
    return this.members.remove(tenant.id, id);
  }
}
