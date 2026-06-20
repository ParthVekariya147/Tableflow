import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import type { FloorTable, Table, Tenant } from "@amber/domain";
import { TablesService } from "./tables.service.js";
import { CurrentTenant } from "../tenant/current-tenant.decorator.js";
import { createTableSchema, updateTableSchema } from "./tables.dto.js";

@Controller("tables")
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  /** Floor view: tables + live sessions + status. */
  @Get()
  list(@CurrentTenant() tenant: Tenant): Promise<FloorTable[]> {
    return this.tables.listFloor(tenant.id);
  }

  /** Customer entry: resolve a table by its QR token. */
  @Get("qr/:token")
  byQrToken(
    @CurrentTenant() tenant: Tenant,
    @Param("token") token: string,
  ): Promise<Table> {
    return this.tables.byQrToken(tenant.id, token);
  }

  @Post()
  create(
    @CurrentTenant() tenant: Tenant,
    @Body() body: unknown,
  ): Promise<Table> {
    return this.tables.create(tenant.id, createTableSchema.parse(body));
  }

  @Patch(":id")
  update(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<Table> {
    return this.tables.update(tenant.id, id, updateTableSchema.parse(body));
  }

  @Post(":id/qr")
  regenerateQr(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
  ): Promise<Table> {
    return this.tables.regenerateQr(tenant.id, id);
  }

  @Delete(":id")
  async remove(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
  ): Promise<{ ok: true }> {
    await this.tables.remove(tenant.id, id);
    return { ok: true };
  }
}
