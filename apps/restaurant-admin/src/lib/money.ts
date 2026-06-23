/**
 * Currency formatting derives everything (symbol, decimals, digit grouping,
 * symbol placement) from `Intl.NumberFormat` given the tenant's ISO-4217
 * currency code — nothing is hardcoded. The locale only influences grouping
 * style (e.g. INR's lakh grouping), so we pick a sensible one per currency and
 * fall back to en-US; the symbol is correct regardless.
 */
const LOCALE_BY_CURRENCY: Record<string, string> = {
  INR: "en-IN",
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  JPY: "ja-JP",
  AED: "ar-AE",
  CAD: "en-CA",
  AUD: "en-AU",
};

function localeFor(currency: string): string {
  return LOCALE_BY_CURRENCY[currency.toUpperCase()] ?? "en-US";
}

/**
 * Build a money formatter bound to a currency code. Returns a fn mapping integer
 * cents → a localized currency string (e.g. INR 145000 -> "₹1,450.00").
 * The `Intl.NumberFormat` instance is created once and reused per call.
 */
export function createMoneyFormatter(
  currency: string,
  locale = localeFor(currency),
): (cents: number) => string {
  const fmt = new Intl.NumberFormat(locale, { style: "currency", currency });
  return (cents: number) => fmt.format(cents / 100);
}

/**
 * The bare currency symbol for a code (e.g. "$", "₹", "€") — for input prefixes
 * where a full formatted amount isn't wanted. Falls back to the code itself.
 */
export function currencySymbolFor(
  currency: string,
  locale = localeFor(currency),
): string {
  const part = new Intl.NumberFormat(locale, { style: "currency", currency })
    .formatToParts(0)
    .find((p) => p.type === "currency");
  return part?.value ?? currency.toUpperCase();
}

/** Short "x ago" relative time for a past epoch-ms timestamp. */
export function timeAgo(at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

/** Minutes elapsed since an epoch-ms timestamp, formatted "45m" / "1h 5m". */
export function elapsed(at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
