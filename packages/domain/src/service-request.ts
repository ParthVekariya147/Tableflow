import { z } from "zod";
import { idSchema, isoTimestampSchema } from "./common.js";

/**
 * A guest-initiated request for staff attention (water, call staff, call a
 * manager) — deliberately NOT an Order/Round/OrderItem. It never touches the
 * kitchen; it's a lightweight notification from table to staff.
 *
 * `SERVICE_REQUEST_TYPES` are the 3 built-in types (still a closed
 * vocabulary, still the source of truth for their label/icon/sublabel — see
 * SERVICE_REQUEST_META below and quick-action.ts's DEFAULT_QUICK_ACTIONS).
 * A tenant can also define custom quick-action buttons (quick-action.ts)
 * that post a request of the same shape with a tenant-authored id as
 * `type`, so `serviceRequestTypeSchema` itself is just a non-empty string —
 * whether a given `type` is an actually-configured, enabled button for the
 * tenant is validated server-side (service-requests.service.ts) against the
 * tenant's live quick-actions config, not by this schema.
 */
export const SERVICE_REQUEST_TYPES = [
  "water",
  "call_staff",
  "call_manager",
] as const;

export const serviceRequestTypeSchema = z.string().min(1);

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

/** The 3 built-in types only — narrower than `ServiceRequestType` (which
 *  also covers tenant-authored custom ids) so SERVICE_REQUEST_META below
 *  stays an exhaustive, statically-checked map. */
export type BuiltInServiceRequestType = (typeof SERVICE_REQUEST_TYPES)[number];

/**
 * Single source of truth for how each built-in request type is labeled/
 * iconed — shared by the customer Quick Actions UI (via quick-action.ts's
 * DEFAULT_QUICK_ACTIONS) and the admin notification panel. Custom types'
 * label/icon live on the tenant's quick-actions config instead (see
 * mergeQuickActions in quick-action.ts).
 */
export const SERVICE_REQUEST_META: Record<
  BuiltInServiceRequestType,
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
