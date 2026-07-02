import { z } from "zod";
import { isoTimestampSchema } from "./common.js";

/**
 * A Kitchen Order Ticket — the paper equivalent of a KDS ticket, for tenants
 * that run a second printer in the kitchen alongside the digital board. No
 * prices/tax/totals (that's the guest-facing Receipt, not this) — just what
 * the kitchen needs to cook: table, round, items, modifiers, notes.
 */
export const kotItemSchema = z.object({
  name: z.string().min(1),
  qty: z.number().int().positive(),
  /** Flattened display strings, e.g. "Spice: Hot", ready to print as-is. */
  modifiers: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export const kotSchema = z.object({
  tenantName: z.string().min(1),
  tableLabel: z.string().min(1),
  roundType: z.enum(["instant", "bundled"]),
  /** Human-facing check number, shared with the guest receipt for the same order. */
  checkNumber: z.string().min(1),
  createdAt: isoTimestampSchema,
  items: z.array(kotItemSchema).min(1),
});

export type KotItem = z.infer<typeof kotItemSchema>;
export type Kot = z.infer<typeof kotSchema>;
