import { z } from "zod";
import { SERVICE_REQUEST_TYPES, SERVICE_REQUEST_META } from "./service-request.js";

/**
 * The guest Welcome screen's "Quick Actions" row (Water / Call Staff /
 * Manager / Full Menu today) is per-tenant configurable: an admin can show/
 * hide + reorder the built-ins and add their own custom buttons. Mirrors
 * printer.ts's ordered, toggle-able `sections` pattern.
 */

/** Curated icon vocabulary for custom buttons — same closed-vocabulary
 *  pattern as PERMISSIONS/SERVICE_REQUEST_TYPES, so the admin picks from a
 *  fixed grid rather than typing an arbitrary Material Symbols name. */
export const QUICK_ACTION_ICONS = [
  "water_drop",
  "notifications_active",
  "support_agent",
  "menu_book",
  "room_service",
  "local_bar",
  "wine_bar",
  "coffee",
  "celebration",
  "cake",
  "child_friendly",
  "pets",
  "wifi",
  "medical_services",
  "smoking_rooms",
  "cleaning_services",
  "credit_card",
  "campaign",
  "favorite",
  "schedule",
] as const;

export const quickActionIconSchema = z.enum(QUICK_ACTION_ICONS);

/** Curated color palette for a button's icon tile. "neutral" is the
 *  colorless default (what Full Menu and any un-styled custom button use). */
export const QUICK_ACTION_SWATCHES = [
  "neutral",
  "sky",
  "amber",
  "violet",
  "rose",
  "emerald",
] as const;

export const quickActionSwatchSchema = z.enum(QUICK_ACTION_SWATCHES);

/** "service_request" pings staff via the ServiceRequest/SSE pipeline (same
 *  as Call Staff); "full_menu" is pure navigation to the menu screen. */
export const quickActionKindSchema = z.enum(["service_request", "full_menu"]);

export const quickActionSchema = z.object({
  /**
   * Stable key. For built-ins: "water" | "call_staff" | "call_manager" |
   * "full_menu". For custom buttons: a slug generated from the label. For
   * kind:"service_request" entries this doubles as the `type` string posted
   * to POST /service-requests — the bridge that replaces the old closed
   * serviceRequestTypeSchema enum.
   */
  id: z.string().min(1),
  kind: quickActionKindSchema,
  /** Built-ins can only be toggled/reordered — label/icon/sublabel/swatch
   *  stay pinned to DEFAULT_QUICK_ACTIONS (see mergeQuickActions). */
  builtIn: z.boolean(),
  enabled: z.boolean().default(true),
  label: z.string().min(1).max(24),
  icon: quickActionIconSchema,
  sublabel: z.string().max(40).optional(),
  swatch: quickActionSwatchSchema.default("neutral"),
});

export type QuickActionIcon = z.infer<typeof quickActionIconSchema>;
export type QuickActionSwatch = z.infer<typeof quickActionSwatchSchema>;
export type QuickActionKind = z.infer<typeof quickActionKindSchema>;
export type QuickAction = z.infer<typeof quickActionSchema>;

/** A restaurant may add at most this many custom buttons (8 total in the
 *  row alongside the 3 built-in requests + Full Menu) — keeps the guest
 *  Welcome screen browsable on a phone without heavy horizontal scroll. */
export const MAX_CUSTOM_QUICK_ACTIONS = 4;

const BUILT_IN_SWATCH: Record<(typeof SERVICE_REQUEST_TYPES)[number], QuickActionSwatch> = {
  water: "sky",
  call_staff: "amber",
  call_manager: "violet",
};

/** The default row — today's exact 4 buttons, in today's order. Label/icon/
 *  sublabel are sourced from SERVICE_REQUEST_META (service-request.ts) so
 *  they're defined in exactly one place. */
export const DEFAULT_QUICK_ACTIONS: readonly QuickAction[] = [
  ...SERVICE_REQUEST_TYPES.map(
    (type): QuickAction => ({
      id: type,
      kind: "service_request",
      builtIn: true,
      enabled: true,
      label: SERVICE_REQUEST_META[type].label,
      icon: SERVICE_REQUEST_META[type].icon as QuickActionIcon,
      sublabel: SERVICE_REQUEST_META[type].sublabel,
      swatch: BUILT_IN_SWATCH[type],
    }),
  ),
  {
    id: "full_menu",
    kind: "full_menu",
    builtIn: true,
    enabled: true,
    label: "Full Menu",
    icon: "menu_book",
    sublabel: "Browse all items",
    swatch: "neutral",
  },
];

const BUILT_IN_BY_ID = new Map(DEFAULT_QUICK_ACTIONS.map((a) => [a.id, a]));

/**
 * A tenant's saved quick-actions list may predate this feature (null/empty
 * → today's default row), predate a newer built-in (missing entries get
 * appended, same "pick up new features" behavior as mergeReceiptSections),
 * or — since only `enabled` + order are tenant-editable for built-ins — may
 * have been tampered with client-side, so built-in fields other than
 * `enabled` are always re-stamped from DEFAULT_QUICK_ACTIONS here rather
 * than trusted from the saved row.
 */
export function mergeQuickActions(
  saved: QuickAction[] | null | undefined,
): QuickAction[] {
  const base = saved?.length ? saved : DEFAULT_QUICK_ACTIONS;

  const merged: QuickAction[] = [];
  let customCount = 0;
  for (const entry of base) {
    const builtIn = BUILT_IN_BY_ID.get(entry.id);
    if (builtIn) {
      merged.push({ ...builtIn, enabled: entry.enabled });
      continue;
    }
    if (customCount >= MAX_CUSTOM_QUICK_ACTIONS) continue; // defense in depth
    customCount += 1;
    merged.push({ ...entry, builtIn: false });
  }

  for (const def of DEFAULT_QUICK_ACTIONS) {
    if (!merged.some((a) => a.id === def.id)) merged.push({ ...def });
  }

  return merged;
}
