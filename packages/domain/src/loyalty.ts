import { z } from "zod";
import { idSchema, isoTimestampSchema } from "./common.js";

/**
 * A staff/platform-only points program — deliberately no guest-facing surface.
 * A LoyaltyAccount is keyed by tenant+phone (the phone already captured at guest
 * checkout), earns points automatically on payment capture, and can only be
 * viewed/redeemed by staff (restaurant-admin) or looked up cross-tenant by
 * platform staff (super-admin). Closed-vocabulary style mirrors service-request.ts.
 */

/** Per-tenant program configuration, stored on Tenant like theme/printer. */
export const loyaltyProgramSchema = z.object({
  enabled: z.boolean().default(false),
  /** Points earned per 1 currency unit spent (post-discount subtotal). */
  earnRatePerCurrency: z.number().min(0).default(1),
  /** Points required to redeem 1 currency unit of discount. */
  redemptionRate: z.number().min(0).default(100),
  /** Minimum balance a guest must hold before any redemption is allowed. */
  minRedeemPoints: z.number().int().min(0).default(100),
  /** Redemption can't discount more than this fraction of the bill. */
  maxRedeemPercent: z.number().min(0).max(1).default(0.5),
});

export const loyaltyAccountSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  phone: z.string().min(1),
  name: z.string().optional(),
  pointsBalance: z.number().int().min(0),
  lifetimePoints: z.number().int().min(0),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export const loyaltyTransactionTypeSchema = z.enum(["earn", "redeem", "adjust"]);

export const loyaltyTransactionSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  accountId: idSchema,
  /** Null for manual "adjust" transactions with no backing order. */
  orderId: idSchema.nullable(),
  type: loyaltyTransactionTypeSchema,
  /** Signed — positive for earn/positive adjust, negative for redeem/negative adjust. */
  points: z.number().int(),
  balanceAfter: z.number().int(),
  note: z.string().optional(),
  createdAt: isoTimestampSchema,
});

export type LoyaltyProgram = z.infer<typeof loyaltyProgramSchema>;
export type LoyaltyAccount = z.infer<typeof loyaltyAccountSchema>;
export type LoyaltyTransactionType = z.infer<typeof loyaltyTransactionTypeSchema>;
export type LoyaltyTransaction = z.infer<typeof loyaltyTransactionSchema>;

/** Points earned for a given post-discount spend, in minor units. */
export function pointsForSpend(
  spendMinor: number,
  program: Pick<LoyaltyProgram, "earnRatePerCurrency">,
): number {
  return Math.floor((spendMinor / 100) * program.earnRatePerCurrency);
}

/** Discount value (in minor units) that redeeming `points` is worth. */
export function redemptionValueMinor(
  points: number,
  program: Pick<LoyaltyProgram, "redemptionRate">,
): number {
  if (program.redemptionRate <= 0) return 0;
  return Math.floor((points / program.redemptionRate) * 100);
}

/** The most points a guest may redeem against a given bill right now. */
export function maxRedeemablePoints(
  billTotalMinor: number,
  balance: number,
  program: Pick<LoyaltyProgram, "redemptionRate" | "maxRedeemPercent" | "minRedeemPoints">,
): number {
  if (balance < program.minRedeemPoints) return 0;
  const capMinor = Math.floor(billTotalMinor * program.maxRedeemPercent);
  const capPoints = Math.floor((capMinor / 100) * program.redemptionRate);
  return Math.max(0, Math.min(balance, capPoints));
}
