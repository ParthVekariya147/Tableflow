import { z } from "zod";

/** Shared primitive schemas reused across the domain. */

export const idSchema = z.string().min(1);

/** A monetary amount in minor units (cents) to avoid float drift. */
export const moneyMinorSchema = z.number().int().nonnegative();

/** ISO-8601 timestamp string. */
export const isoTimestampSchema = z.string().datetime();

export const slugSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase kebab-case slug");

export type Id = z.infer<typeof idSchema>;
export type MoneyMinor = z.infer<typeof moneyMinorSchema>;
export type IsoTimestamp = z.infer<typeof isoTimestampSchema>;
export type Slug = z.infer<typeof slugSchema>;

/** Format minor units (cents) as a currency string, e.g. 1450 -> "14.50". */
export function formatMoney(minor: MoneyMinor, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(minor / 100);
}
