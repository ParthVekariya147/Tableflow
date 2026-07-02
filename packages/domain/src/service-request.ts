import { z } from "zod";
import { idSchema, isoTimestampSchema } from "./common.js";

/**
 * A guest-initiated request for staff attention (water, call staff, call a
 * manager) — deliberately NOT an Order/Round/OrderItem. It never touches the
 * kitchen; it's a lightweight notification from table to staff. Closed
 * vocabulary, same pattern as PERMISSIONS in permission.ts.
 */
export const SERVICE_REQUEST_TYPES = [
  "water",
  "call_staff",
  "call_manager",
] as const;

export const serviceRequestTypeSchema = z.enum(SERVICE_REQUEST_TYPES);

/** pending → acknowledged (staff has seen it) → resolved (handled). */
export const serviceRequestStatusSchema = z.enum([
  "pending",
  "acknowledged",
  "resolved",
]);

export const serviceRequestSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  tableId: idSchema,
  /** Denormalized so admin can render "Table 4" with no join. */
  tableLabel: z.string().min(1),
  /** Best-effort link to the table's live session, if one exists. */
  orderId: idSchema.nullable(),
  type: serviceRequestTypeSchema,
  status: serviceRequestStatusSchema.default("pending"),
  createdAt: isoTimestampSchema,
  acknowledgedAt: isoTimestampSchema.optional(),
  resolvedAt: isoTimestampSchema.optional(),
});

export type ServiceRequestType = z.infer<typeof serviceRequestTypeSchema>;
export type ServiceRequestStatus = z.infer<typeof serviceRequestStatusSchema>;
export type ServiceRequest = z.infer<typeof serviceRequestSchema>;

/**
 * Single source of truth for how each request type is labeled/iconed —
 * shared by the customer Quick Actions UI and the admin notification panel,
 * so a request's icon is always looked up from its type, never a menu-item
 * fallback.
 */
export const SERVICE_REQUEST_META: Record<
  ServiceRequestType,
  { label: string; icon: string; sublabel: string }
> = {
  water: {
    label: "Water",
    icon: "water_drop",
    sublabel: "Still water · Free",
  },
  call_staff: {
    label: "Call Staff",
    icon: "notifications_active",
    sublabel: "We'll come to you",
  },
  call_manager: {
    label: "Manager",
    icon: "support_agent",
    sublabel: "Wait for manager",
  },
};
