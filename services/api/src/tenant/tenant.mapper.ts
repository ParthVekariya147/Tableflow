import { themeConfigSchema, type Tenant as DomainTenant } from "@amber/domain";
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
    upiId: row.upiId ?? undefined,
    upiMobile: row.upiMobile ?? undefined,
    active: row.active,
    // theme is stored as JSON; validate/normalize through the domain schema.
    theme: themeConfigSchema.parse(row.theme),
  };
}
