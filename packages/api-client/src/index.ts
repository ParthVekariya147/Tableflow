/**
 * @amber/api-client — the one typed client every app calls.
 *
 * No app hand-writes fetch(): they construct a client and call typed resource
 * methods whose responses are validated against @amber/domain schemas. The
 * active tenant is sent as a header so the API scopes every query.
 */
import { z } from "zod";
import {
  tenantSchema,
  menuSchema,
  tableSchema,
  orderSchema,
  roundTypeSchema,
  type Tenant,
  type Menu,
  type Table,
  type Order,
} from "@amber/domain";
import { request, ApiError, type ApiClientConfig } from "./http.js";

export { ApiError } from "./http.js";
export type { ApiClientConfig } from "./http.js";

// KDS realtime seam — the customer publishes rounds, the KDS renders/advances
// them, both through KdsTransport. See ./kds.ts for the swap-the-backend story.
export {
  KDS_STAGES,
  nextStage,
  applyKdsEvent,
  type KdsStage,
  type KdsTicket,
  type KdsTicketItem,
  type KdsEvent,
  type KdsTransport,
  type PublishRoundInput,
} from "./kds.js";
export {
  createHttpKdsTransport,
  type HttpKdsTransportConfig,
} from "./transports/http-kds.js";
export { createStaticKdsTransport } from "./transports/static-kds.js";

/** Body for adding a round to an order. */
export interface AddRoundInput {
  type: z.infer<typeof roundTypeSchema>;
  items: Array<{
    menuItemId: string;
    name: string;
    unitPrice: number;
    qty: number;
    notes?: string;
  }>;
}

export interface CreateTenantInput {
  slug: string;
  name: string;
  currency?: string;
  taxRate?: number;
  theme?: Tenant["theme"];
}

export function createApiClient(config: ApiClientConfig) {
  return {
    /** Raw config (useful for cloning with a different tenant). */
    config,

    tenant: {
      /** Load the active tenant (resolved from the X-Tenant-Slug header). */
      current: (): Promise<Tenant> =>
        request(config, "/tenant", { schema: tenantSchema }),
      /** Load a specific tenant by slug (used pre-theme, e.g. on splash). */
      bySlug: (slug: string): Promise<Tenant> =>
        request(config, `/tenants/${encodeURIComponent(slug)}`, {
          schema: tenantSchema,
          tenantSlug: slug,
        }),
    },

    menu: {
      /** Full menu (categories + items) for the active tenant. */
      get: (): Promise<Menu> =>
        request(config, "/menu", { schema: menuSchema }),
    },

    tables: {
      /** Resolve a scanned QR token to a Table. */
      byQrToken: (qrToken: string): Promise<Table> =>
        request(config, `/tables/${encodeURIComponent(qrToken)}`, {
          schema: tableSchema,
        }),
    },

    orders: {
      get: (id: string): Promise<Order> =>
        request(config, `/orders/${encodeURIComponent(id)}`, {
          schema: orderSchema,
        }),
      /** Open a new dine-in session for a table. */
      createForTable: (tableId: string): Promise<Order> =>
        request(config, "/orders", {
          method: "POST",
          body: { tableId },
          schema: orderSchema,
        }),
      /** Send a round to the kitchen ("bring it" / "bring these"). */
      addRound: (orderId: string, input: AddRoundInput): Promise<Order> =>
        request(config, `/orders/${encodeURIComponent(orderId)}/rounds`, {
          method: "POST",
          body: input,
          schema: orderSchema,
        }),
      /** Request the bill for an order. */
      requestBill: (orderId: string): Promise<Order> =>
        request(config, `/orders/${encodeURIComponent(orderId)}/bill`, {
          method: "POST",
          schema: orderSchema,
        }),
    },

    /** Cross-tenant operations (super-admin only). */
    admin: {
      listTenants: (): Promise<Tenant[]> =>
        request(config, "/admin/tenants", { schema: z.array(tenantSchema) }),
      createTenant: (input: CreateTenantInput): Promise<Tenant> =>
        request(config, "/admin/tenants", {
          method: "POST",
          body: input,
          schema: tenantSchema,
        }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Clone an existing client bound to a different tenant slug. */
export function withTenant(client: ApiClient, tenantSlug: string): ApiClient {
  return createApiClient({ ...client.config, tenantSlug });
}

export { ApiError as ApiClientError };
