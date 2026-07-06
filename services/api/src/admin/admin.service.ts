import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { PERMISSIONS, type Tenant } from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import { toDomainTenant } from "../tenant/tenant.mapper.js";
import { TenantService } from "../tenant/tenant.service.js";
import { AuthService } from "../auth/auth.service.js";
import { backfillLoyaltyAccountsFromOrders } from "../loyalty/loyalty.service.js";
import type { CreateTenantDto, UpdateTenantDto } from "./admin.dto.js";
import type { PlatformAnalytics } from "./admin.types.js";

export interface TenantCredential {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantActive: boolean;
  ownerEmail: string | null;
  ownerName: string | null;
  ownerUserId: string | null;
  hasPassword: boolean;
}

export interface AuditLogEntry {
  id: string;
  type: string;
  actor: { id: string; name: string; email: string } | null;
  tenant: { id: string; name: string; slug: string } | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TenantPayment {
  id: string;
  tableLabel: string;
  customerName: string | null;
  total: number;
  method: string;
  createdAt: string;
}

export interface GetAuditLogOptions {
  type?: string;
  tenantId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** Cross-tenant loyalty account row for the super-admin customer lookup. */
export interface LoyaltyAccountSummary {
  id: string;
  phone: string;
  name: string | null;
  pointsBalance: number;
  lifetimePoints: number;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  updatedAt: string;
}

export interface LoyaltyAccountDetail extends LoyaltyAccountSummary {
  createdAt: string;
  transactions: {
    id: string;
    type: string;
    points: number;
    balanceAfter: number;
    note: string | null;
    orderId: string | null;
    createdAt: string;
  }[];
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantService: TenantService,
    private readonly auth: AuthService,
  ) {}

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

    // If owner credentials were provided, create User + Admin role + Membership.
    if (dto.ownerEmail && dto.ownerName && dto.ownerPassword) {
      const passwordHash = await bcrypt.hash(dto.ownerPassword, 10);

      // Find existing user or create a new one.
      const owner = await this.prisma.user.upsert({
        where: { email: dto.ownerEmail.toLowerCase() },
        update: { passwordHash },
        create: {
          email: dto.ownerEmail.toLowerCase(),
          name: dto.ownerName,
          passwordHash,
        },
      });

      // Create a protected Admin role for this tenant with all permissions.
      const adminRole = await this.prisma.role.create({
        data: {
          tenantId: row.id,
          name: "Admin",
          permissions: [...PERMISSIONS],
          protected: true,
        },
      });

      // Link the owner to the tenant as Admin.
      await this.prisma.membership.create({
        data: {
          tenantId: row.id,
          userId: owner.id,
          roleId: adminRole.id,
        },
      });
    }

    // Write audit log (fire-and-forget; never crashes the main operation).
    this.prisma.auditLog
      .create({
        data: {
          type: "tenant_created",
          tenantId: row.id,
          metadata: {
            slug: row.slug,
            name: row.name,
            ...(dto.ownerEmail ? { ownerEmail: dto.ownerEmail } : {}),
          },
        },
      })
      .catch(() => {});

    return toDomainTenant(row);
  }

  async updateTenant(id: string, dto: UpdateTenantDto): Promise<Tenant> {
    const existing = await this.prisma.tenant.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Unknown tenant: ${id}`);

    const row = await this.prisma.tenant.update({
      where: { id },
      data: dto,
    });
    // This write bypasses TenantService.update() (it needs `active`, which
    // that self-service method deliberately doesn't expose) — so it must
    // invalidate TenantService's getBySlug cache itself, or a just-suspended
    // tenant keeps resolving (and fully operating) for up to the cache TTL.
    this.tenantService.invalidateCache(row.slug);
    // Also drop every cached AuthUser for this tenant — resolveAuthUser's
    // `membership.tenant.active` check only re-runs on a cache miss, so
    // without this a just-suspended tenant's staff would stay "logged in"
    // for up to the auth-user cache TTL too.
    this.auth.invalidateTenantAuthUsers(id);

    const type = dto.active === false ? "tenant_suspended" : dto.active === true ? "tenant_reactivated" : "tenant_updated";
    this.prisma.auditLog
      .create({ data: { type, tenantId: id, metadata: dto as never } })
      .catch(() => {});

    return toDomainTenant(row);
  }

  /** Cross-tenant platform analytics for the super-admin dashboard. */
  async getPlatformAnalytics(): Promise<PlatformAnalytics> {
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const d60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // All-time GMV/method-split are computed in SQL (aggregate/groupBy)
    // instead of loading every payment ever made into Node — this was an
    // unbounded, ever-growing full-table scan.
    const [gmvAgg, methodAgg, payments30d, payments60d30d, activeSubs, activeSubRows] =
      await Promise.all([
        this.prisma.payment.aggregate({ _sum: { total: true } }),
        this.prisma.payment.groupBy({ by: ["method"], _sum: { total: true } }),
        this.prisma.payment.findMany({
          where: { createdAt: { gte: d30 } },
          select: { total: true, method: true, createdAt: true, tenantId: true, orderId: true },
        }),
        this.prisma.payment.findMany({
          where: { createdAt: { gte: d60, lt: d30 } },
          select: { total: true },
        }),
        this.prisma.subscription.count({ where: { status: "active" } }),
        this.prisma.subscription.findMany({
          where: { status: "active" },
          include: { plan: { select: { priceCents: true, interval: true } } },
        }),
      ]);

    const totalGmvCents = gmvAgg._sum.total ?? 0;
    const gmv30dCents = payments30d.reduce((s, p) => s + p.total, 0);
    const gmv60to30Cents = payments60d30d.reduce((s, p) => s + p.total, 0);
    const gmv30dDeltaPct = gmv60to30Cents > 0
      ? ((gmv30dCents - gmv60to30Cents) / gmv60to30Cents) * 100
      : 0;

    const orders30d = payments30d.length;
    const prevOrders = payments60d30d.length;
    const orders30dDeltaPct = prevOrders > 0
      ? ((orders30d - prevOrders) / prevOrders) * 100
      : 0;

    // MRR from active subscriptions
    const mrrCents = activeSubRows.reduce((s, sub) => {
      const monthly = sub.plan.interval === "year" ? Math.round(sub.plan.priceCents / 12) : sub.plan.priceCents;
      return s + monthly;
    }, 0);

    // Revenue series (daily for last 30 days)
    const seriesMap = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      seriesMap.set(d.toISOString().slice(0, 10), 0);
    }
    for (const p of payments30d) {
      const key = p.createdAt.toISOString().slice(0, 10);
      if (seriesMap.has(key)) seriesMap.set(key, (seriesMap.get(key) ?? 0) + p.total);
    }
    const revenueSeries = [...seriesMap.entries()].map(([date, cents]) => ({ date, cents }));

    // Top tenants by 30-day revenue
    const tenantRevMap = new Map<string, number>();
    for (const p of payments30d) {
      tenantRevMap.set(p.tenantId, (tenantRevMap.get(p.tenantId) ?? 0) + p.total);
    }
    const topTenantIds = [...tenantRevMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);
    const topTenantRows = topTenantIds.length
      ? await this.prisma.tenant.findMany({
          where: { id: { in: topTenantIds } },
          select: { id: true, name: true },
        })
      : [];
    const topTenants = topTenantIds.map((id) => ({
      tenantId: id,
      name: topTenantRows.find((t) => t.id === id)?.name ?? id,
      totalCents: tenantRevMap.get(id) ?? 0,
    }));

    // Method split (all time), computed in SQL via groupBy above.
    const methodSplit = methodAgg.reduce(
      (acc, m) => {
        if (m.method === "cash") acc.cash += m._sum.total ?? 0;
        else acc.card += m._sum.total ?? 0;
        return acc;
      },
      { cash: 0, card: 0 },
    );

    return {
      totalGmvCents,
      gmv30dCents,
      gmv30dDeltaPct,
      mrrCents,
      activeSubscriptions: activeSubs,
      orders30d,
      orders30dDeltaPct,
      revenueSeries,
      topTenants,
      methodSplit,
    };
  }

  async getTenantPayments(tenantId: string): Promise<TenantPayment[]> {
    const rows = await this.prisma.payment.findMany({
      where: { tenantId },
      include: { order: { include: { table: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return rows.map((p) => ({
      id: p.id,
      tableLabel: p.order.table.label,
      customerName: p.order.customerName ?? null,
      total: p.total,
      method: p.method,
      createdAt: p.createdAt.toISOString(),
    }));
  }

  /** List all tenants with their primary Admin member's credentials. */
  async getCredentials(): Promise<TenantCredential[]> {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { name: "asc" },
      include: {
        memberships: {
          where: { active: true, role: { protected: true } },
          include: { user: true },
          take: 1,
        },
      },
    });

    return tenants.map((t) => {
      const m = t.memberships[0] ?? null;
      return {
        tenantId: t.id,
        tenantName: t.name,
        tenantSlug: t.slug,
        tenantActive: t.active,
        ownerEmail: m?.user.email ?? null,
        ownerName: m?.user.name ?? null,
        ownerUserId: m?.user.id ?? null,
        hasPassword: !!m?.user.passwordHash,
      };
    });
  }

  /** Set a new password for a tenant's Admin user (identified by userId). */
  async resetOwnerPassword(tenantId: string, userId: string, newPassword: string): Promise<void> {
    // Verify the user is actually an active protected-role member of this tenant.
    const membership = await this.prisma.membership.findFirst({
      where: { tenantId, userId, active: true, role: { protected: true } },
    });
    if (!membership) throw new NotFoundException("No Admin member found for this tenant");

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  /** Write an impersonation event to the audit log (fire-and-forget safe). */
  async writeImpersonationLog(tenantId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.prisma.auditLog.create({
      data: { type: "impersonation", tenantId, metadata: metadata as never },
    }).catch(() => {});
  }

  async getAuditLog(opts: GetAuditLogOptions): Promise<{
    entries: AuditLogEntry[];
    total: number;
  }> {
    const where = {
      ...(opts.type ? { type: opts.type as never } : {}),
      ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
      ...(opts.from || opts.to
        ? {
            createdAt: {
              ...(opts.from ? { gte: new Date(opts.from) } : {}),
              ...(opts.to ? { lte: new Date(opts.to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          actor: { select: { id: true, name: true, email: true } },
          tenant: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { createdAt: "desc" },
        take: opts.limit ?? 50,
        skip: opts.offset ?? 0,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      entries: rows.map((r) => ({
        id: r.id,
        type: r.type,
        actor: r.actor,
        tenant: r.tenant,
        metadata: (r.metadata as Record<string, unknown>) ?? {},
        createdAt: r.createdAt.toISOString(),
      })),
      total,
    };
  }

  /**
   * Cross-tenant customer lookup for platform support — search every tenant's
   * loyalty accounts by phone/name, optionally narrowed to one tenant. Unlike
   * the per-tenant `LoyaltyService`, this has no tenantId scope of its own
   * (the SuperAdminGuard on AdminController is the authorization boundary).
   */
  async listLoyaltyAccounts(opts: {
    search?: string;
    tenantId?: string;
  }): Promise<LoyaltyAccountSummary[]> {
    await backfillLoyaltyAccountsFromOrders(this.prisma, opts.tenantId);
    const q = opts.search?.trim();
    const rows = await this.prisma.loyaltyAccount.findMany({
      where: {
        ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
        ...(q
          ? {
              OR: [
                { phone: { contains: q } },
                { name: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      include: { tenant: { select: { name: true, slug: true } } },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      phone: r.phone,
      name: r.name,
      pointsBalance: r.pointsBalance,
      lifetimePoints: r.lifetimePoints,
      tenantId: r.tenantId,
      tenantName: r.tenant.name,
      tenantSlug: r.tenant.slug,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  /** One account's full transaction history, read-only (adjustments stay a
   *  restaurant-admin action so they're attributable to that tenant's staff). */
  async getLoyaltyAccount(id: string): Promise<LoyaltyAccountDetail> {
    const row = await this.prisma.loyaltyAccount.findUnique({
      where: { id },
      include: { tenant: { select: { name: true, slug: true } } },
    });
    if (!row) throw new NotFoundException(`Loyalty account not found: ${id}`);
    const txns = await this.prisma.loyaltyTransaction.findMany({
      where: { accountId: id },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return {
      id: row.id,
      phone: row.phone,
      name: row.name,
      pointsBalance: row.pointsBalance,
      lifetimePoints: row.lifetimePoints,
      tenantId: row.tenantId,
      tenantName: row.tenant.name,
      tenantSlug: row.tenant.slug,
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      transactions: txns.map((t) => ({
        id: t.id,
        type: t.type,
        points: t.points,
        balanceAfter: t.balanceAfter,
        note: t.note,
        orderId: t.orderId,
        createdAt: t.createdAt.toISOString(),
      })),
    };
  }
}
