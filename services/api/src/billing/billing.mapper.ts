import {
  planLimitsSchema,
  type Plan as DomainPlan,
  type Subscription as DomainSubscription,
  type SubscriptionWithPlan,
} from "@amber/domain";
import type {
  Plan as PrismaPlan,
  Subscription as PrismaSubscription,
} from "@prisma/client";

export function toDomainPlan(row: PrismaPlan): DomainPlan {
  return {
    id: row.id,
    name: row.name,
    priceCents: row.priceCents,
    interval: row.interval,
    limits: planLimitsSchema.parse(row.limits),
    active: row.active,
  };
}

export function toDomainSubscription(
  row: PrismaSubscription,
): DomainSubscription {
  return {
    id: row.id,
    tenantId: row.tenantId,
    planId: row.planId,
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    provider: row.provider,
    providerCustomerId: row.providerCustomerId,
    providerSubscriptionId: row.providerSubscriptionId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toDomainSubscriptionWithPlan(
  row: PrismaSubscription & { plan: PrismaPlan },
): SubscriptionWithPlan {
  return {
    ...toDomainSubscription(row),
    plan: toDomainPlan(row.plan),
  };
}
