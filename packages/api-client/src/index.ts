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
  menuItemSchema,
  menuCategorySchema,
  tableSchema,
  floorTableSchema,
  orderSchema,
  paymentSchema,
  saleSchema,
  roundTypeSchema,
  modifierInputTypeSchema,
  type Tenant,
  type Menu,
  type MenuItem,
  type MenuCategory,
  type Table,
  type FloorTable,
  type Order,
  type OrderStatus,
  type Payment,
  type Sale,
  type ItemStatus,
  type PaymentMethod,
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

/** A chosen modifier on a round line (server re-validates + re-prices). */
export interface RoundItemModifierInput {
  /** Omitted for free-text groups (use textValue instead). */
  optionId?: string;
  groupName: string;
  name?: string;
  priceDelta?: number;
  textValue?: string;
}

/** Body for adding a round to an order. Optional `id`s become the DB primary
 *  keys (shared id space with the KDS ticket → status can be written back). */
export interface AddRoundInput {
  id?: string;
  type: z.infer<typeof roundTypeSchema>;
  items: Array<{
    id?: string;
    menuItemId: string;
    name: string;
    unitPrice: number;
    qty: number;
    notes?: string;
    modifiers?: RoundItemModifierInput[];
  }>;
}

export interface CreateTenantInput {
  slug: string;
  name: string;
  currency?: string;
  taxRate?: number;
  theme?: Tenant["theme"];
}

/** A modifier option as authored in the admin (no id — server mints them). */
export interface ModifierOptionInput {
  name: string;
  priceDelta: number; // cents; may be negative
  available?: boolean;
  sortOrder?: number;
}

/** A modifier group as authored in the admin. */
export interface ModifierGroupInput {
  name: string;
  inputType: z.infer<typeof modifierInputTypeSchema>;
  required?: boolean;
  minSelect?: number;
  maxSelect?: number | null;
  maxLength?: number | null;
  placeholder?: string;
  sortOrder?: number;
  options: ModifierOptionInput[];
}

/** Body for creating a menu item. */
export interface CreateItemInput {
  categoryId: string;
  name: string;
  price: number;
  description?: string;
  badge?: string;
  imageUrl?: string;
  icon?: string;
  swatch?: string;
  available?: boolean;
  /** Veg / Non-veg marker; null clears it. */
  dietary?: "veg" | "non_veg" | null;
  jain?: boolean;
  sortOrder?: number;
  /** Full modifier set (replace-on-save); omit on PATCH to leave untouched. */
  modifierGroups?: ModifierGroupInput[];
}
export type UpdateItemInput = Partial<CreateItemInput>;

/** Body for creating/editing a table. */
export interface TableInput {
  label: string;
  seats?: number;
  room?: string;
  sortOrder?: number;
}

/** Body for capturing a payment. */
export interface CapturePaymentInput {
  method: PaymentMethod;
  tip?: number;
  tendered?: number;
}

/**
 * A live order event from `GET /orders/stream` (SSE). `snapshot` arrives once
 * per (re)connect with the whole live floor; the rest carry a single mutated
 * Order. The customer filters to its own `orderId`; admin/KDS use the floor.
 */
export type OrderStreamEvent =
  | { type: "snapshot"; orders: Order[] }
  | { type: "created" | "updated" | "closed"; orderId: string; order: Order };

/** Validate a raw SSE frame into a typed OrderStreamEvent, or null if bad. */
function parseOrderStreamEvent(raw: unknown): OrderStreamEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { type?: unknown; orders?: unknown; order?: unknown; orderId?: unknown };
  if (r.type === "snapshot") {
    const orders = z.array(orderSchema).safeParse(r.orders);
    return orders.success ? { type: "snapshot", orders: orders.data } : null;
  }
  if (r.type === "created" || r.type === "updated" || r.type === "closed") {
    const order = orderSchema.safeParse(r.order);
    if (!order.success || typeof r.orderId !== "string") return null;
    return { type: r.type, orderId: r.orderId, order: order.data };
  }
  return null;
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
      /** Add a category. */
      addCategory: (input: {
        name: string;
        sortOrder?: number;
      }): Promise<MenuCategory> =>
        request(config, "/menu/categories", {
          method: "POST",
          body: input,
          schema: menuCategorySchema,
        }),
      /** Rename / reorder a category. */
      updateCategory: (
        id: string,
        input: { name?: string; sortOrder?: number },
      ): Promise<MenuCategory> =>
        request(config, `/menu/categories/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: input,
          schema: menuCategorySchema,
        }),
      /** Delete a category (only when it holds no items). */
      deleteCategory: (id: string): Promise<{ ok: true }> =>
        request(config, `/menu/categories/${encodeURIComponent(id)}`, {
          method: "DELETE",
          schema: z.object({ ok: z.literal(true) }),
        }),
      /** Upload an item photo to storage; returns its public URL. */
      uploadImage: (file: Blob, filename?: string): Promise<{ url: string }> => {
        const form = new FormData();
        form.append("file", file, filename ?? "upload");
        return request(config, "/menu/upload", {
          method: "POST",
          body: form,
          schema: z.object({ url: z.string() }),
        });
      },
      /** Add a menu item. */
      addItem: (input: CreateItemInput): Promise<MenuItem> =>
        request(config, "/menu/items", {
          method: "POST",
          body: input,
          schema: menuItemSchema,
        }),
      /** Patch a menu item (price, availability, name, …). */
      updateItem: (id: string, input: UpdateItemInput): Promise<MenuItem> =>
        request(config, `/menu/items/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: input,
          schema: menuItemSchema,
        }),
      /** Delete a menu item. */
      deleteItem: (id: string): Promise<{ ok: true }> =>
        request(config, `/menu/items/${encodeURIComponent(id)}`, {
          method: "DELETE",
          schema: z.object({ ok: z.literal(true) }),
        }),
    },

    tables: {
      /** Floor view: every table with its live session + status. */
      list: (): Promise<FloorTable[]> =>
        request(config, "/tables", { schema: z.array(floorTableSchema) }),
      /** Resolve a scanned QR token to a Table. */
      byQrToken: (qrToken: string): Promise<Table> =>
        request(config, `/tables/qr/${encodeURIComponent(qrToken)}`, {
          schema: tableSchema,
        }),
      /** Add a table to the floor. */
      create: (input: TableInput): Promise<Table> =>
        request(config, "/tables", {
          method: "POST",
          body: input,
          schema: tableSchema,
        }),
      /** Edit a table. */
      update: (id: string, input: Partial<TableInput>): Promise<Table> =>
        request(config, `/tables/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: input,
          schema: tableSchema,
        }),
      /** Rotate a table's QR token. */
      regenerateQr: (id: string): Promise<Table> =>
        request(config, `/tables/${encodeURIComponent(id)}/qr`, {
          method: "POST",
          schema: tableSchema,
        }),
      /** Remove a table. */
      remove: (id: string): Promise<{ ok: true }> =>
        request(config, `/tables/${encodeURIComponent(id)}`, {
          method: "DELETE",
          schema: z.object({ ok: z.literal(true) }),
        }),
    },

    orders: {
      /** List sessions (defaults to live: open + billed). */
      list: (status?: OrderStatus): Promise<Order[]> =>
        request(
          config,
          status ? `/orders?status=${encodeURIComponent(status)}` : "/orders",
          { schema: z.array(orderSchema) },
        ),
      /** Completed sales. With a `from`/`to` ISO window, returns every sale in
       *  that range (Order History); without it, the recent dashboard feed. */
      sales: (range?: { from?: string; to?: string }): Promise<Sale[]> => {
        const qs = new URLSearchParams();
        if (range?.from) qs.set("from", range.from);
        if (range?.to) qs.set("to", range.to);
        const q = qs.toString();
        return request(config, q ? `/orders/sales?${q}` : "/orders/sales", {
          schema: z.array(saleSchema),
        });
      },
      get: (id: string): Promise<Order> =>
        request(config, `/orders/${encodeURIComponent(id)}`, {
          schema: orderSchema,
        }),
      /**
       * Subscribe to the tenant's live order stream (SSE). Calls `handler` for
       * each validated event and returns an unsubscribe fn. EventSource can't
       * set headers, so the tenant rides as `?tenant=` (TenantMiddleware accepts
       * it). Mirrors the KDS transport's EventSource handling; auto-reconnects.
       */
      stream: (handler: (event: OrderStreamEvent) => void): (() => void) => {
        const slug = config.tenantSlug;
        const url = `${config.baseUrl}/orders/stream${
          slug ? `?tenant=${encodeURIComponent(slug)}` : ""
        }`;
        const source = new EventSource(url);
        source.onmessage = (msg) => {
          try {
            const event = parseOrderStreamEvent(JSON.parse(msg.data));
            if (event) handler(event);
          } catch {
            /* ignore malformed frames */
          }
        };
        // EventSource auto-reconnects on error; the server re-sends a snapshot.
        return () => source.close();
      },
      /** Open a new dine-in session for a table, optionally with guest contact. */
      createForTable: (
        tableId: string,
        guest?: { customerName?: string; customerPhone?: string },
      ): Promise<Order> =>
        request(config, "/orders", {
          method: "POST",
          body: { tableId, ...guest },
          schema: orderSchema,
        }),
      /** Send a round to the kitchen ("bring it" / "bring these"). */
      addRound: (orderId: string, input: AddRoundInput): Promise<Order> =>
        request(config, `/orders/${encodeURIComponent(orderId)}/rounds`, {
          method: "POST",
          body: input,
          schema: orderSchema,
        }),
      /** Add a single item to a running session (staff add-on). */
      addItem: (
        orderId: string,
        input: { menuItemId: string; qty?: number },
      ): Promise<Order> =>
        request(config, `/orders/${encodeURIComponent(orderId)}/items`, {
          method: "POST",
          body: input,
          schema: orderSchema,
        }),
      /** Change a line's qty (0 removes) and/or advance its kitchen status. */
      updateItem: (
        orderId: string,
        itemId: string,
        input: { qty?: number; status?: ItemStatus },
      ): Promise<Order> =>
        request(
          config,
          `/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}`,
          { method: "PATCH", body: input, schema: orderSchema },
        ),
      /** Request the bill for an order. */
      requestBill: (orderId: string): Promise<Order> =>
        request(config, `/orders/${encodeURIComponent(orderId)}/bill`, {
          method: "POST",
          schema: orderSchema,
        }),
      /** Abandon a session without payment (walkout / mistake). */
      cancel: (orderId: string): Promise<Order> =>
        request(config, `/orders/${encodeURIComponent(orderId)}/cancel`, {
          method: "POST",
          schema: orderSchema,
        }),
      /** Settle the bill and close the session. */
      capturePayment: (
        orderId: string,
        input: CapturePaymentInput,
      ): Promise<Payment> =>
        request(config, `/orders/${encodeURIComponent(orderId)}/payment`, {
          method: "POST",
          body: input,
          schema: paymentSchema,
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
