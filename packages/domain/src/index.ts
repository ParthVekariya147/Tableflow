/**
 * @amber/domain — the shared contract.
 *
 * Single source of truth for the shapes the API, the typed api-client, and all
 * three apps agree on. Zod schemas double as runtime validators and as the
 * origin of every TypeScript type (via z.infer).
 */
export * from "./common.js";
export * from "./permission.js";
export * from "./role.js";
export * from "./user.js";
export * from "./auth.js";
export * from "./tenant.js";
export * from "./menu.js";
export * from "./order.js";
export * from "./service-request.js";
export * from "./quick-action.js";
export * from "./loyalty.js";
export * from "./table.js";
export * from "./payment.js";
export * from "./analytics.js";
export * from "./billing.js";
export * from "./printer.js";
export * from "./print-format.js";
export * from "./receipt.js";
export * from "./kot.js";
export * from "./print-relay.js";
// The tenant-module registry (printing / loyalty on-off) — depends on the
// printer + loyalty schemas above, so it is exported after them.
export * from "./module.js";
