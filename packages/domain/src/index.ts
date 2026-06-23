/**
 * @amber/domain — the shared contract.
 *
 * Single source of truth for the shapes the API, the typed api-client, and all
 * three apps agree on. Zod schemas double as runtime validators and as the
 * origin of every TypeScript type (via z.infer).
 */
export * from "./common.js";
export * from "./tenant.js";
export * from "./menu.js";
export * from "./order.js";
export * from "./table.js";
export * from "./payment.js";
export * from "./analytics.js";
