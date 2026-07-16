import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Tenant, UpdateTenantRequest } from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import { toDomainTenant } from "./tenant.mapper.js";
import { TtlCache } from "../common/ttl-cache.js";

// Every tenant-scoped request resolves the tenant by slug (TenantMiddleware).
// Tenants change rarely (branding/profile edits), so a short cache removes a
// DB round trip from nearly every request; `update` invalidates on write.
const TENANT_CACHE_TTL_MS = 30_000;

@Injectable()
export class TenantService {
  private readonly bySlugCache = new TtlCache<Tenant>(TENANT_CACHE_TTL_MS);

  constructor(private readonly prisma: PrismaService) {}

  /** Resolve an active tenant by slug, or throw 404. */
  async getBySlug(slug: string): Promise<Tenant> {
    const cached = this.bySlugCache.get(slug);
    if (cached) return cached;
    const row = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!row || !row.active) {
      throw new NotFoundException(`Unknown tenant: ${slug}`);
    }
    const tenant = toDomainTenant(row);
    this.bySlugCache.set(slug, tenant);
    return tenant;
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
    if (input.fssaiNumber !== undefined) data.fssaiNumber = input.fssaiNumber || null;
    if (input.address !== undefined) data.address = input.address || null;
    if (input.phone !== undefined) data.phone = input.phone || null;
    if (input.upiId !== undefined) data.upiId = input.upiId || null;
    if (input.upiMobile !== undefined) data.upiMobile = input.upiMobile || null;
    if (input.theme !== undefined) data.theme = input.theme as Prisma.InputJsonValue;
    if (input.printer !== undefined) data.printer = input.printer as Prisma.InputJsonValue;
    if (input.kitchenPrinter !== undefined)
      data.kitchenPrinter = input.kitchenPrinter as Prisma.InputJsonValue;
    if (input.loyalty !== undefined) data.loyalty = input.loyalty as Prisma.InputJsonValue;
    const row = await this.prisma.tenant.update({ where: { id: tenantId }, data });
    this.invalidateCache(row.slug);
    return toDomainTenant(row);
  }

  /**
   * Drop the cached `getBySlug` entry for a tenant. Any writer that mutates a
   * tenant row OUTSIDE this service's own `update()` (e.g. the super-admin
   * panel's suspend/reactivate, which needs fields like `active` this
   * self-service `update()` deliberately doesn't expose) must call this too —
   * otherwise a just-suspended tenant keeps resolving (and fully operating)
   * for up to `TENANT_CACHE_TTL_MS`.
   */
  invalidateCache(slug: string): void {
    this.bySlugCache.delete(slug);
  }

  /** All tenants (super-admin). */
  async list(): Promise<Tenant[]> {
    const rows = await this.prisma.tenant.findMany({
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDomainTenant);
  }
}
