import type { OrderItemModifier } from "../data/types";
import { getStoredTenantSlug } from "./auth-tenant";
import { randomId } from "./randomId";

/**
 * The Quick Sale cart, persisted per-device in localStorage until the sale is
 * actually charged. Nothing here ever touches the API/DB: many tills (phones)
 * can each build their own counter sale in parallel without seeing each
 * other's carts, and an app close / refresh / dead network mid-sale loses
 * nothing — the cart is re-loaded on the next open and only cleared after the
 * atomic `POST /orders/quick-sale` succeeds. Keyed by tenant slug so switching
 * restaurants on one device can't mix carts.
 */
export interface QuickSaleDraftLine {
  key: string;
  menuItemId: string;
  name: string;
  /** Base per-unit price snapshot (cents), WITHOUT modifier deltas. */
  basePriceCents: number;
  qty: number;
  notes?: string;
  modifiers?: OrderItemModifier[];
}

const KEY_PREFIX = "amber-quick-sale-draft";
const REQUEST_ID_PREFIX = "amber-quick-sale-request";

function storageKey(): string {
  return `${KEY_PREFIX}:${getStoredTenantSlug() ?? "default"}`;
}

function requestKey(): string {
  return `${REQUEST_ID_PREFIX}:${getStoredTenantSlug() ?? "default"}`;
}

/**
 * The idempotency key for THIS cart's checkout.
 *
 * Charging is a non-idempotent create, so a lost response (wifi blip, tab
 * backgrounded, proxy timeout) leaves the till unable to tell "never charged"
 * from "charged, reply lost". Without a stable key, the natural retry records
 * a SECOND complete sale and the customer is billed twice.
 *
 * The key is minted once per cart and persisted next to the draft, so it
 * survives a reload/app-kill exactly as the cart does — every retry of the
 * same cart carries the same key, and the server returns the original sale
 * instead of creating another. Cleared only when the sale is confirmed
 * recorded, which is what starts a fresh key for the next customer.
 *
 * Kept in its own storage entry (not folded into the draft payload) so drafts
 * already saved on devices keep loading unchanged.
 */
export function getQuickSaleRequestId(): string {
  try {
    const existing = localStorage.getItem(requestKey());
    if (existing) return existing;
    const minted = randomId();
    localStorage.setItem(requestKey(), minted);
    return minted;
  } catch {
    // No storage (private mode): fall back to a per-call id. Retry protection
    // is lost, but charging still works — never block a sale on storage.
    return randomId();
  }
}

export function loadQuickSaleDraft(): QuickSaleDraftLine[] {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is QuickSaleDraftLine =>
        !!l &&
        typeof l === "object" &&
        typeof (l as QuickSaleDraftLine).key === "string" &&
        typeof (l as QuickSaleDraftLine).menuItemId === "string" &&
        typeof (l as QuickSaleDraftLine).name === "string" &&
        typeof (l as QuickSaleDraftLine).basePriceCents === "number" &&
        typeof (l as QuickSaleDraftLine).qty === "number" &&
        (l as QuickSaleDraftLine).qty > 0,
    );
  } catch {
    return [];
  }
}

export function saveQuickSaleDraft(lines: QuickSaleDraftLine[]): void {
  try {
    if (lines.length === 0) localStorage.removeItem(storageKey());
    else localStorage.setItem(storageKey(), JSON.stringify(lines));
  } catch {
    /* storage unavailable (private mode) — cart just won't survive a close */
  }
}

/** Clear the cart AND its idempotency key — call only once the sale is
 *  confirmed recorded, so the next customer starts a genuinely new checkout. */
export function clearQuickSaleDraft(): void {
  try {
    localStorage.removeItem(storageKey());
    localStorage.removeItem(requestKey());
  } catch {
    /* ignore */
  }
}
