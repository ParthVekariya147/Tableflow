import { ConflictException, Injectable } from "@nestjs/common";
import type { Tenant } from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import { toDomainTenant } from "../tenant/tenant.mapper.js";
import type { CreateTenantDto } from "./admin.dto.js";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /** Provision a new tenant. Same code path serves every future restaurant. */
  async createTenant(dto: CreateTenantDto): Promise<Tenant> {
    const existing = await this.prisma.tenant.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) throw new ConflictException(`Slug taken: ${dto.slug}`);

    const row = await this.prisma.tenant.create({
      data: {
        slug: dto.slug,
        name: dto.name,
        currency: dto.currency,
        taxRate: dto.taxRate,
        theme: dto.theme,
      },
    });
    return toDomainTenant(row);
  }
}
