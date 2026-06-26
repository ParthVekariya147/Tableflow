import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Tenant, UpdateTenantRequest } from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import { toDomainTenant } from "./tenant.mapper.js";

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve an active tenant by slug, or throw 404. */
  async getBySlug(slug: string): Promise<Tenant> {
    const row = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!row || !row.active) {
      throw new NotFoundException(`Unknown tenant: ${slug}`);
    }
    return toDomainTenant(row);
  }

  /**
   * Update a tenant's own settings (Branding theme / Restaurant Profile). Only
   * the provided fields change; `theme` is stored as JSON.
   */
  async update(tenantId: string, input: UpdateTenantRequest): Promise<Tenant> {
    const data: Prisma.TenantUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.taxRate !== undefined) data.taxRate = input.taxRate;
    if (input.gstNumber !== undefined) data.gstNumber = input.gstNumber || null;
    if (input.upiId !== undefined) data.upiId = input.upiId || null;
    if (input.upiMobile !== undefined) data.upiMobile = input.upiMobile || null;
    if (input.theme !== undefined) data.theme = input.theme as Prisma.InputJsonValue;
    const row = await this.prisma.tenant.update({ where: { id: tenantId }, data });
    return toDomainTenant(row);
  }

  /** All tenants (super-admin). */
  async list(): Promise<Tenant[]> {
    const rows = await this.prisma.tenant.findMany({
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDomainTenant);
  }
}
