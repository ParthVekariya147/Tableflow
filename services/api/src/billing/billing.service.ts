import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  BillingInterval,
  Plan,
  SubscriptionWithPlan,
  TenantWithSubscription,
} from "@amber/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import { toDomainTenant } from "../tenant/tenant.mapper.js";
import { toDomainPlan, toDomainSubscriptionWithPlan } from "./billing.mapper.js";
import type {
  CreatePlanDto,
  SetSubscriptionDto,
  UpdatePlanDto,
  UpdateSubscriptionStatusDto,
} from "./billing.dto.js";

/** One billing period from `from`, per the plan's interval. */
function addInterval(from: Date, interval: BillingInterval): Date {
  const next = new Date(from);
  if (interval === "month") next.setMonth(next.getMonth() + 1);
  else next.setFullYear(next.getFullYear() + 1);
  return next;
}

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async listPlans(): Promise<Plan[]> {
    const rows = await this.prisma.plan.findMany({
      orderBy: { priceCents: "asc" },
    });
    return rows.map(toDomainPlan);
  }

  async createPlan(dto: CreatePlanDto): Promise<Plan> {
    const row = await this.prisma.plan.create({
      data: {
        name: dto.name,
        priceCents: dto.priceCents,
        interval: dto.interval,
        limits: dto.limits,
      },
    });
    return toDomainPlan(row);
  }

  async updatePlan(id: string, dto: UpdatePlanDto): Promise<Plan> {
    const existing = await this.prisma.plan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Unknown plan: ${id}`);

    const row = await this.prisma.plan.update({ where: { id }, data: dto });
    return toDomainPlan(row);
  }

  /** `GET /billing/me` — null if the tenant has never been put on a plan. */
  async getSubscriptionForTenant(
    tenantId: string,
  ): Promise<SubscriptionWithPlan | null> {
    const row = await this.prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });
    return row ? toDomainSubscriptionWithPlan(row) : null;
  }

  /** Assign or change a tenant's plan. Always takes effect immediately (no proration). */
  async setSubscription(
    tenantId: string,
    dto: SetSubscriptionDto,
    actorId?: string,
  ): Promise<SubscriptionWithPlan> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException(`Unknown tenant: ${tenantId}`);

    const plan = await this.prisma.plan.findUnique({
      where: { id: dto.planId },
    });
    if (!plan || !plan.active) {
      throw new NotFoundException(`Unknown or inactive plan: ${dto.planId}`);
    }

    const currentPeriodEnd = addInterval(new Date(), plan.interval);
    const row = await this.prisma.subscription.upsert({
      where: { tenantId },
      create: {
        tenantId,
        planId: plan.id,
        status: "active",
        currentPeriodEnd,
      },
      update: {
        planId: plan.id,
        status: "active",
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
      },
      include: { plan: true },
    });

    await this.writeAuditLog({
      type: "plan_assigned",
      actorId,
      tenantId,
      metadata: { planId: plan.id, planName: plan.name },
    });

    return toDomainSubscriptionWithPlan(row);
  }

  /** Cancel / reactivate / otherwise change status of an existing subscription. */
  async updateSubscriptionStatus(
    tenantId: string,
    dto: UpdateSubscriptionStatusDto,
    actorId?: string,
  ): Promise<SubscriptionWithPlan> {
    const existing = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });
    if (!existing) {
      throw new NotFoundException(`Tenant has no subscription: ${tenantId}`);
    }

    const nextStatus = dto.status ?? existing.status;
    const nextCancelAtPeriodEnd =
      dto.cancelAtPeriodEnd !== undefined
        ? dto.cancelAtPeriodEnd
        : nextStatus === "active" && dto.status === "active"
          ? false
          : existing.cancelAtPeriodEnd;

    const row = await this.prisma.subscription.update({
      where: { tenantId },
      data: {
        status: nextStatus,
        cancelAtPeriodEnd: nextCancelAtPeriodEnd,
      },
      include: { plan: true },
    });

    await this.writeAuditLog({
      type: "subscription_status_changed",
      actorId,
      tenantId,
      metadata: { from: existing.status, to: nextStatus, cancelAtPeriodEnd: nextCancelAtPeriodEnd },
    });

    return toDomainSubscriptionWithPlan(row);
  }

  private async writeAuditLog(entry: {
    type: string;
    actorId?: string;
    tenantId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          type: entry.type as never,
          actorId: entry.actorId ?? null,
          tenantId: entry.tenantId ?? null,
          metadata: (entry.metadata ?? {}) as never,
        },
      });
    } catch {
      // Never let audit-log failures crash the main operation.
    }
  }

  /** `GET /admin/tenants` — tenant rows with their subscription+plan joined, no N+1. */
  async listTenantsWithSubscriptions(): Promise<TenantWithSubscription[]> {
    const rows = await this.prisma.tenant.findMany({
      orderBy: { createdAt: "asc" },
      include: { subscription: { include: { plan: true } } },
    });
    return rows.map((row) => ({
      ...toDomainTenant(row),
      subscription: row.subscription
        ? toDomainSubscriptionWithPlan(row.subscription)
        : null,
    }));
  }

  /** `GET /admin/tenants/:id` — single tenant with subscription+plan. */
  async getTenantWithSubscription(id: string): Promise<TenantWithSubscription> {
    const row = await this.prisma.tenant.findUnique({
      where: { id },
      include: { subscription: { include: { plan: true } } },
    });
    if (!row) throw new NotFoundException(`Unknown tenant: ${id}`);
    return {
      ...toDomainTenant(row),
      subscription: row.subscription
        ? toDomainSubscriptionWithPlan(row.subscription)
        : null,
    };
  }
}
