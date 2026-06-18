import { Injectable, NotFoundException } from "@nestjs/common";
import type { Tenant } from "@amber/domain";
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

  /** All tenants (super-admin). */
  async list(): Promise<Tenant[]> {
    const rows = await this.prisma.tenant.findMany({
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDomainTenant);
  }
}
