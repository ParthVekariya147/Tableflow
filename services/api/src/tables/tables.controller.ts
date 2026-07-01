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
import type { FloorTable, Table, Tenant } from "@amber/domain";
import { TablesService } from "./tables.service.js";
import { CurrentTenant } from "../tenant/current-tenant.decorator.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { createTableSchema, updateTableSchema } from "./tables.dto.js";

@Controller("tables")
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  /** Staff-only floor view: tables + live sessions + status. */
  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentTenant() tenant: Tenant): Promise<FloorTable[]> {
    return this.tables.listFloor(tenant.id);
  }

  /** Public — customer entry: resolve a table by its QR token. */
  @Get("qr/:token")
  byQrToken(
    @CurrentTenant() tenant: Tenant,
    @Param("token") token: string,
  ): Promise<Table> {
    return this.tables.byQrToken(tenant.id, token);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @CurrentTenant() tenant: Tenant,
    @Body() body: unknown,
  ): Promise<Table> {
    return this.tables.create(tenant.id, createTableSchema.parse(body));
  }

  @UseGuards(JwtAuthGuard)
  @Patch(":id")
  update(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<Table> {
    return this.tables.update(tenant.id, id, updateTableSchema.parse(body));
  }

  @UseGuards(JwtAuthGuard)
  @Post(":id/qr")
  regenerateQr(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
  ): Promise<Table> {
    return this.tables.regenerateQr(tenant.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(":id")
  async remove(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
  ): Promise<{ ok: true }> {
    await this.tables.remove(tenant.id, id);
    return { ok: true };
  }
}
