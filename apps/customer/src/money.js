import { useMemo } from "react";
import { useBoot } from "./context/BootContext";

/**
 * Tenant-aware currency formatting for the guest app. The scanned tenant carries
 * an ISO-4217 `currency` code (resolved in BootContext via `api.tenant.bySlug`),
 * so scanning Restaurant A vs B shows each one's own currency. Everything —
 * symbol, decimals, digit grouping, symbol placement — is derived from
 * `Intl.NumberFormat`; nothing is hardcoded. The locale only influences grouping
 * (e.g. INR's lakh style), so we map a sensible one per currency, else en-US.
 *
 * Customer prices are float MAJOR units (dollars/rupees) — the menu maps API
 * cents → `price = cents / 100` — so the formatter takes major units directly.
 */
const LOCALE_BY_CURRENCY = {
  INR: "en-IN",
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  JPY: "ja-JP",
  AED: "ar-AE",
  CAD: "en-CA",
  AUD: "en-AU",
};

const localeFor = (currency) =>
  LOCALE_BY_CURRENCY[String(currency).toUpperCase()] ?? "en-US";

export function createMoneyFormatter(currency, locale = localeFor(currency)) {
  const fmt = new Intl.NumberFormat(locale, { style: "currency", currency });
  return (amount) => fmt.format(amount ?? 0);
}

export function currencySymbolFor(currency, locale = localeFor(currency)) {
  const part = new Intl.NumberFormat(locale, { style: "currency", currency })
    .formatToParts(0)
    .find((p) => p.type === "currency");
  return part?.value ?? String(currency).toUpperCase();
}

/** Hook: a money formatter bound to the scanned tenant's currency. */
export function useMoney() {
  const { tenant } = useBoot();
  const currency = tenant?.currency ?? "USD";
  return useMemo(() => createMoneyFormatter(currency), [currency]);
}

/** Hook: the scanned tenant's bare currency symbol (e.g. "$", "₹"). */
export function useCurrencySymbol() {
  const { tenant } = useBoot();
  const currency = tenant?.currency ?? "USD";
  return useMemo(() => currencySymbolFor(currency), [currency]);
}
