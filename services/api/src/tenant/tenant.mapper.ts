import {
  themeConfigSchema,
  printerSettingsSchema,
  loyaltyProgramSchema,
  quickActionSchema,
  type Tenant as DomainTenant,
} from "@amber/domain";
import { z } from "zod";
import type { Tenant as PrismaTenant } from "@prisma/client";

/** Map a Prisma Tenant row to the shared domain Tenant shape. */
export function toDomainTenant(row: PrismaTenant): DomainTenant {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    currency: row.currency,
    taxRate: row.taxRate,
    gstNumber: row.gstNumber ?? undefined,
    fssaiNumber: row.fssaiNumber ?? undefined,
    address: row.address ?? undefined,
    phone: row.phone ?? undefined,
    upiId: row.upiId ?? undefined,
    upiMobile: row.upiMobile ?? undefined,
    active: row.active,
    // theme/printer/loyalty are stored as JSON; validate/normalize through the domain schema.
    theme: themeConfigSchema.parse(row.theme),
    printer: printerSettingsSchema.parse(row.printer ?? {}),
    kitchenPrinter: printerSettingsSchema.parse(row.kitchenPrinter ?? {}),
    loyalty: loyaltyProgramSchema.parse(row.loyalty ?? {}),
    quickActions: z.array(quickActionSchema).parse(row.quickActions ?? []),
  };
}

/**
 * Redact print-agent credentials from a tenant before it can reach an
 * unauthenticated caller (e.g. GET /tenants/:slug, used pre-login for guest
 * QR boot / theming). `printer.agentSecret` / `kitchenPrinter.agentSecret`
 * authenticate callers to the tenant's local print agent and must never be
 * readable by anyone who merely knows the tenant's public slug.
 */
export function toPublicDomainTenant(tenant: DomainTenant): DomainTenant {
  return {
    ...tenant,
    printer: { ...tenant.printer, agentSecret: undefined },
    kitchenPrinter: { ...tenant.kitchenPrinter, agentSecret: undefined },
  };
}
