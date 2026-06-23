import { z } from "zod";
import { moneyMinorSchema } from "./common.js";

/**
 * Aggregated performance metrics for the restaurant-admin Analytics page and the
 * Dashboard KPIs. All money is minor units (cents). Computed server-side from
 * `Payment` + `OrderItem` over an ISO `{from,to}` window (see
 * `OrdersService.getAnalytics`). Deltas are fractions vs the immediately
 * preceding equal-length window (e.g. 0.12 = +12%), or null when there's no
 * prior data to compare against.
 */

/** One point on the revenue trend line (hourly for short ranges, daily for long). */
export const analyticsBucketSchema = z.object({
  label: z.string(),
  value: moneyMinorSchema,
});

/** A best-selling menu item (by item revenue, excluding cancelled lines). */
export const analyticsTopItemSchema = z.object({
  name: z.string(),
  units: z.number().int().nonnegative(),
  revenue: moneyMinorSchema,
});

/** Revenue share for one menu category. `pct` is 0–100 of item revenue. */
export const analyticsCategorySchema = z.object({
  name: z.string(),
  units: z.number().int().nonnegative(),
  revenue: moneyMinorSchema,
  pct: z.number(),
});

/** Orders settled in a given hour-of-day bucket (0–23, restaurant-local). */
export const analyticsHourSchema = z.object({
  hour: z.number().int().min(0).max(23),
  orders: z.number().int().nonnegative(),
});

export const analyticsSummarySchema = z.object({
  revenue: moneyMinorSchema,
  orders: z.number().int().nonnegative(),
  avgTicket: moneyMinorSchema,
  /** Total non-cancelled item units sold in the window (donut center). */
  totalItems: z.number().int().nonnegative(),
  /** Period-over-period deltas (fraction; null if the prior window had no data). */
  revenueDelta: z.number().nullable(),
  ordersDelta: z.number().nullable(),
  avgTicketDelta: z.number().nullable(),
  revenueSeries: z.array(analyticsBucketSchema),
  topItems: z.array(analyticsTopItemSchema),
  categories: z.array(analyticsCategorySchema),
  peakHours: z.array(analyticsHourSchema),
});

export type AnalyticsBucket = z.infer<typeof analyticsBucketSchema>;
export type AnalyticsTopItem = z.infer<typeof analyticsTopItemSchema>;
export type AnalyticsCategory = z.infer<typeof analyticsCategorySchema>;
export type AnalyticsHour = z.infer<typeof analyticsHourSchema>;
export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;
