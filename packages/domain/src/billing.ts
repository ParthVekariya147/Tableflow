import { z } from "zod";
import { idSchema, isoTimestampSchema, moneyMinorSchema } from "./common.js";
import { tenantSchema } from "./tenant.js";

/**
 * Subscription billing contract. Plans are a small, platform-managed catalog;
 * a Subscription binds one Tenant to one Plan. Only super-admin (/admin/*)
 * writes these — restaurant-admin only ever reads its own tenant's
 * Subscription (GET /billing/me). See PLATFORM_PLAN.md.
 */

export const billingIntervalSchema = z.enum(["month", "year"]);

export const planLimitsSchema = z
  .object({
    maxTables: z.number().int().positive().optional(),
    maxOrdersPerMonth: z.number().int().positive().optional(),
  })
  .partial();

export const planSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  priceCents: moneyMinorSchema,
  interval: billingIntervalSchema,
  limits: planLimitsSchema.default({}),
  active: z.boolean().default(true),
});

export const subscriptionStatusSchema = z.enum([
  "trialing",
  "active",
  "past_due",
  "canceled",
]);

/**
 * `provider`/`providerCustomerId`/`providerSubscriptionId` are unused while
 * billing is super-admin-managed; reserved for a future Stripe/Lemon Squeezy
 * integration (undecided) so that webhook reconciliation doesn't need a
 * schema change later. `provider` is null = "manual" (today's only mode).
 */
export const subscriptionSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  planId: idSchema,
  status: subscriptionStatusSchema,
  currentPeriodEnd: isoTimestampSchema,
  cancelAtPeriodEnd: z.boolean().default(false),
  provider: z.string().nullable().default(null),
  providerCustomerId: z.string().nullable().default(null),
  providerSubscriptionId: z.string().nullable().default(null),
  createdAt: isoTimestampSchema,
});

/** Denormalized for the super-admin tenant table / restaurant-admin billing page. */
export const subscriptionWithPlanSchema = subscriptionSchema.extend({
  plan: planSchema,
});

/** Row shape for `GET /admin/tenants` — tenant + its subscription joined, no N+1. */
export const tenantWithSubscriptionSchema = tenantSchema.extend({
  subscription: subscriptionWithPlanSchema.nullable(),
});

/** Body for POST /admin/tenants/:id/subscription (assign/change plan). */
export const setSubscriptionSchema = z.object({
  planId: idSchema,
});

/** Body for PATCH /admin/tenants/:id/subscription (cancel/reactivate/etc). */
export const updateSubscriptionStatusSchema = z.object({
  status: subscriptionStatusSchema.optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
}).refine(
  (v) => v.status !== undefined || v.cancelAtPeriodEnd !== undefined,
  { message: "Provide at least one of status or cancelAtPeriodEnd" },
);

export const createPlanSchema = z.object({
  name: z.string().min(1),
  priceCents: moneyMinorSchema,
  interval: billingIntervalSchema,
  limits: planLimitsSchema.default({}),
});

export const updatePlanSchema = createPlanSchema.partial().extend({
  active: z.boolean().optional(),
});

export type BillingInterval = z.infer<typeof billingIntervalSchema>;
export type PlanLimits = z.infer<typeof planLimitsSchema>;
export type Plan = z.infer<typeof planSchema>;
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
export type SubscriptionWithPlan = z.infer<typeof subscriptionWithPlanSchema>;
export type TenantWithSubscription = z.infer<typeof tenantWithSubscriptionSchema>;
export type SetSubscriptionInput = z.infer<typeof setSubscriptionSchema>;
export type UpdateSubscriptionStatusInput = z.infer<
  typeof updateSubscriptionStatusSchema
>;
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

/** Paginated entry from `GET /admin/audit-log`. */
export const auditLogEntrySchema = z.object({
  id: idSchema,
  type: z.string(),
  actor: z
    .object({ id: idSchema, name: z.string(), email: z.string() })
    .nullable(),
  tenant: z
    .object({ id: idSchema, name: z.string(), slug: z.string() })
    .nullable(),
  metadata: z.record(z.unknown()),
  createdAt: isoTimestampSchema,
});

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
