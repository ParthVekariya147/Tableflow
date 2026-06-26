/** Supported display currencies for subscription plan pricing. */
export const CURRENCIES = {
  USD: { symbol: "$",    name: "US Dollar",          locale: "en-US", flag: "🇺🇸" },
  EUR: { symbol: "€",    name: "Euro",                locale: "de-DE", flag: "🇪🇺" },
  GBP: { symbol: "£",    name: "British Pound",       locale: "en-GB", flag: "🇬🇧" },
  INR: { symbol: "₹",    name: "Indian Rupee",        locale: "hi-IN", flag: "🇮🇳" },
  AUD: { symbol: "A$",   name: "Australian Dollar",   locale: "en-AU", flag: "🇦🇺" },
  CAD: { symbol: "C$",   name: "Canadian Dollar",     locale: "en-CA", flag: "🇨🇦" },
  JPY: { symbol: "¥",    name: "Japanese Yen",        locale: "ja-JP", flag: "🇯🇵" },
  CNY: { symbol: "¥",    name: "Chinese Yuan",        locale: "zh-CN", flag: "🇨🇳" },
  BRL: { symbol: "R$",   name: "Brazilian Real",      locale: "pt-BR", flag: "🇧🇷" },
  AED: { symbol: "د.إ",  name: "UAE Dirham",          locale: "ar-AE", flag: "🇦🇪" },
  SGD: { symbol: "S$",   name: "Singapore Dollar",    locale: "en-SG", flag: "🇸🇬" },
  MYR: { symbol: "RM",   name: "Malaysian Ringgit",   locale: "ms-MY", flag: "🇲🇾" },
  SAR: { symbol: "﷼",    name: "Saudi Riyal",         locale: "ar-SA", flag: "🇸🇦" },
  ZAR: { symbol: "R",    name: "South African Rand",  locale: "en-ZA", flag: "🇿🇦" },
  NGN: { symbol: "₦",    name: "Nigerian Naira",      locale: "en-NG", flag: "🇳🇬" },
} as const;

export type SupportedCurrency = keyof typeof CURRENCIES;

const LOCALE_TO_CURRENCY: Partial<Record<string, SupportedCurrency>> = {
  "en-US": "USD", "en": "USD",
  "en-IN": "INR", "hi-IN": "INR", "hi": "INR",
  "en-GB": "GBP",
  "de": "EUR", "de-DE": "EUR",
  "fr": "EUR", "fr-FR": "EUR",
  "es": "EUR", "es-ES": "EUR",
  "it": "EUR", "it-IT": "EUR",
  "nl": "EUR", "pt-PT": "EUR",
  "en-AU": "AUD",
  "en-CA": "CAD", "fr-CA": "CAD",
  "ja": "JPY", "ja-JP": "JPY",
  "zh": "CNY", "zh-CN": "CNY",
  "pt-BR": "BRL",
  "ar-AE": "AED",
  "en-SG": "SGD",
  "ms-MY": "MYR", "ms": "MYR",
  "ar-SA": "SAR", "ar": "SAR",
  "en-ZA": "ZAR",
  "en-NG": "NGN",
};

export function detectUserCurrency(): SupportedCurrency {
  const locale = (typeof navigator !== "undefined" ? navigator.language : null) ?? "en-US";
  const lang = locale.split("-")[0] ?? "en";
  return LOCALE_TO_CURRENCY[locale] ?? LOCALE_TO_CURRENCY[lang] ?? "USD";
}

let rateCache: { rates: Record<string, number>; fetchedAt: number } | null = null;

/** Fetch USD-base exchange rates. Cached in-memory for 1 hour. */
export async function fetchRates(): Promise<Record<string, number>> {
  const now = Date.now();
  if (rateCache && now - rateCache.fetchedAt < 3_600_000) return rateCache.rates;
  const res = await fetch("https://open.er-api.com/v6/latest/USD");
  if (!res.ok) throw new Error("Failed to fetch exchange rates");
  const data = (await res.json()) as { rates: Record<string, number> };
  rateCache = { rates: data.rates, fetchedAt: now };
  return data.rates;
}

/** Format USD cents as a display string in the target currency. */
export function formatInCurrency(
  usdCents: number,
  currency: SupportedCurrency,
  rates: Record<string, number>,
): string {
  const rate = rates[currency] ?? 1;
  const amount = (usdCents / 100) * rate;
  return new Intl.NumberFormat(CURRENCIES[currency].locale, {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
  }).format(amount);
}
