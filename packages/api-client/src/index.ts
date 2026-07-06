/**
 * @amber/api-client — the one typed client every app calls.
 *
 * No app hand-writes fetch(): they construct a client and call typed resource
 * methods whose responses are validated against @amber/domain schemas. The
 * active tenant is sent as a header so the API scopes every query.
 */
import { z } from "zod";
import type {
  roundTypeSchema,
  modifierInputTypeSchema,
  serviceRequestTypeSchema} from "@amber/domain";
import {
  tenantSchema,
  menuSchema,
  menuItemSchema,
  menuCategorySchema,
  tableSchema,
  floorTableSchema,
  orderSchema,
  openTableIdsSchema,
  paymentSchema,
  saleSchema,
  analyticsSummarySchema,
  serviceRequestSchema,
  loginResponseSchema,
  loginResultSchema,
  authUserSchema,
  roleSchema,
  membershipSchema,
  planSchema,
  tenantWithSubscriptionSchema,
  subscriptionWithPlanSchema,
  loyaltyAccountSchema,
  loyaltyTransactionSchema,
  type LoginResponse,
  type LoginResult,
  type AuthUser,
  type Role,
  type Membership,
  type Permission,
  type Tenant,
  type UpdateTenantRequest,
  type Menu,
  type MenuItem,
  type MenuCategory,
  type Table,
  type FloorTable,
  type Order,
  type OrderStatus,
  type Payment,
  type Sale,
  type AnalyticsSummary,
  type ItemStatus,
  type ServiceRequest,
  type ServiceRequestStatus,
  type PaymentMethod,
  type Plan,
  type SubscriptionWithPlan,
  type TenantWithSubscription,
  type CreatePlanInput,
  type UpdatePlanInput,
  type SetSubscriptionInput,
  type UpdateSubscriptionStatusInput,
  type LoyaltyAccount,
  type LoyaltyTransaction,
} from "@amber/domain";
import { request, requestBlob, ApiError, type ApiClientConfig } from "./http.js";

export { ApiError } from "./http.js";
export type { ApiClientConfig } from "./http.js";
export type { Plan, SubscriptionWithPlan, TenantWithSubscription, CreatePlanInput, UpdatePlanInput, SetSubscriptionInput, UpdateSubscriptionStatusInput } from "@amber/domain";

/** A payment row as returned from `GET /admin/tenants/:id/payments`. */
export interface TenantPayment {
  id: string;
  tableLabel: string;
  customerName: string | null;
  total: number;
  method: string;
  createdAt: string;
}

/** Tenant credential row from `GET /admin/credentials`. */
export interface TenantCredential {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantActive: boolean;
  ownerEmail: string | null;
  ownerName: string | null;
  ownerUserId: string | null;
  hasPassword: boolean;
}

/** A single entry in the platform audit log. */
export interface AuditLogEntry {
  id: string;
  type: string;
  actor: { id: string; name: string; email: string } | null;
  tenant: { id: string; name: string; slug: string } | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** One of a loyalty customer's visits — items ordered, pricing, payment method. */
export interface LoyaltyOrderSummary {
  id: string;
  tableLabel: string;
  status: string;
  createdAt: string;
  items: Array<{ name: string; qty: number; unitPrice: number }>;
  payment: {
    method: string;
    subtotal: number;
    tax: number;
    tip: number;
    total: number;
  } | null;
}

/** Cross-tenant loyalty account row from `GET /admin/loyalty/accounts`. */
export interface AdminLoyaltyAccountSummary {
  id: string;
  phone: string;
  name: string | null;
  pointsBalance: number;
  lifetimePoints: number;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  updatedAt: string;
}

/** Account detail + transaction history from `GET /admin/loyalty/accounts/:id`. */
export interface AdminLoyaltyAccountDetail extends AdminLoyaltyAccountSummary {
  createdAt: string;
  transactions: Array<{
    id: string;
    type: string;
    points: number;
    balanceAfter: number;
    note: string | null;
    orderId: string | null;
    createdAt: string;
  }>;
}

/** Cross-tenant platform analytics for the super-admin dashboard. */
export interface PlatformAnalytics {
  totalGmvCents: number;
  gmv30dCents: number;
  gmv30dDeltaPct: number;
  mrrCents: number;
  activeSubscriptions: number;
  orders30d: number;
  orders30dDeltaPct: number;
  revenueSeries: Array<{ date: string; cents: number }>;
  topTenants: Array<{ tenantId: string; name: string; totalCents: number }>;
  methodSplit: { cash: number; card: number };
}

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
  ownerEmail?: string;
  ownerName?: string;
  ownerPassword?: string;
}

/** Body for creating/editing a custom role. */
export interface CreateRoleInput {
  name: string;
  permissions: Permission[];
}
export type UpdateRoleInput = Partial<CreateRoleInput>;

/** Body for adding a team member (creates the user if new). */
export interface AddMemberInput {
  email: string;
  name: string;
  roleId: string;
  permissions?: Permission[];
}

/** Body for editing a member (role, per-user permission override, active). */
export interface UpdateMemberInput {
  roleId?: string;
  permissions?: Permission[];
  active?: boolean;
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

/**
 * A live service-request event from `GET /service-requests/stream` (SSE).
 * `snapshot` arrives once per (re)connect with the currently-open requests;
 * the rest carry a single created/updated request. Mirrors OrderStreamEvent.
 */
export type ServiceRequestStreamEvent =
  | { type: "snapshot"; requests: ServiceRequest[] }
  | { type: "created" | "updated"; request: ServiceRequest };

/** Validate a raw SSE frame into a typed ServiceRequestStreamEvent, or null if bad. */
function parseServiceRequestStreamEvent(raw: unknown): ServiceRequestStreamEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { type?: unknown; requests?: unknown; request?: unknown };
  if (r.type === "snapshot") {
    const requests = z.array(serviceRequestSchema).safeParse(r.requests);
    return requests.success ? { type: "snapshot", requests: requests.data } : null;
  }
  if (r.type === "created" || r.type === "updated") {
    const request = serviceRequestSchema.safeParse(r.request);
    return request.success ? { type: r.type, request: request.data } : null;
  }
  return null;
}

export function createApiClient(config: ApiClientConfig) {
  return {
    /** Raw config (useful for cloning with a different tenant). */
    config,

    auth: {
      /**
       * Email-first sign in (not tenant-scoped). Resolves to either
       * `{ kind: "authenticated", token, user }` (one restaurant) or
       * `{ kind: "select_tenant", ticket, tenants }` (several — call `selectTenant`).
       */
      login: (email: string, password: string): Promise<LoginResult> =>
        request(config, "/auth/login", {
          method: "POST",
          body: { email, password },
          schema: loginResultSchema,
        }),
      /** Step two of a multi-tenant login: redeem the ticket for the chosen tenant. */
      selectTenant: (ticket: string, tenantId: string): Promise<LoginResponse> =>
        request(config, "/auth/select-tenant", {
          method: "POST",
          body: { ticket, tenantId },
          schema: loginResponseSchema,
        }),
      /** The current user behind the configured bearer token (getToken). */
      me: (): Promise<AuthUser> =>
        request(config, "/auth/me", { schema: authUserSchema }),
      /**
       * First-request profile bootstrap (Supabase path only). After a Supabase
       * session is established, the frontend calls this once so the API creates
       * the matching Prisma User row keyed by auth.uid().
       */
      syncProfile: (): Promise<AuthUser> =>
        request(config, "/auth/sync-profile", {
          method: "POST",
          schema: authUserSchema,
        }),
      /**
       * Self-service password change. Required before proceeding while
       * `AuthUser.mustChangePassword` is true (still on the default
       * `changeme123`), but callable any time.
       */
      changePassword: (currentPassword: string, newPassword: string): Promise<{ ok: true }> =>
        request(config, "/auth/change-password", {
          method: "POST",
          body: { currentPassword, newPassword },
          schema: z.object({ ok: z.literal(true) }),
        }),
    },

    /** Tenant-scoped, read-only billing info (restaurant-admin plan page). */
    billing: {
      me: (): Promise<SubscriptionWithPlan | null> =>
        request(config, "/billing/me", {
          schema: subscriptionWithPlanSchema.nullable(),
        }),
    },

    /** Custom-role management (Admin-only; requires team.manage). */
    roles: {
      list: (): Promise<Role[]> =>
        request(config, "/roles", { schema: z.array(roleSchema) }),
      create: (input: CreateRoleInput): Promise<Role> =>
        request(config, "/roles", {
          method: "POST",
          body: input,
          schema: roleSchema,
        }),
      update: (id: string, input: UpdateRoleInput): Promise<Role> =>
        request(config, `/roles/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: input,
          schema: roleSchema,
        }),
      remove: (id: string): Promise<{ ok: true }> =>
        request(config, `/roles/${encodeURIComponent(id)}`, {
          method: "DELETE",
          schema: z.object({ ok: z.literal(true) }),
        }),
    },

    /** Team/user management (Admin-only; requires team.manage). */
    members: {
      list: (): Promise<Membership[]> =>
        request(config, "/members", { schema: z.array(membershipSchema) }),
      add: (input: AddMemberInput): Promise<Membership> =>
        request(config, "/members", {
          method: "POST",
          body: input,
          schema: membershipSchema,
        }),
      update: (id: string, input: UpdateMemberInput): Promise<Membership> =>
        request(config, `/members/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: input,
          schema: membershipSchema,
        }),
      remove: (id: string): Promise<{ ok: true }> =>
        request(config, `/members/${encodeURIComponent(id)}`, {
          method: "DELETE",
          schema: z.object({ ok: z.literal(true) }),
        }),
    },

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
      /** Update the active tenant's own settings (Branding / Profile). */
      update: (input: UpdateTenantRequest): Promise<Tenant> =>
        request(config, "/tenant", {
          method: "PATCH",
          body: input,
          schema: tenantSchema,
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
      /** Find-or-create the tenant's virtual "Counter Sale" table backing
       *  the no-table quick-sale flow. */
      counter: (): Promise<Table> =>
        request(config, "/tables/counter", { schema: tableSchema }),
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
      /** Table ids currently holding a live session — a lean occupancy check
       *  (used by the customer app's QR boot / reservation race guard) instead
       *  of `list("open")`, which carries the whole order graph. */
      openTableIds: (): Promise<string[]> =>
        request(config, "/orders/open-table-ids", {
          schema: openTableIdsSchema,
        }),
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
      /** Aggregated analytics (revenue/orders/avg, trend, top items, categories,
       *  peak hours, period-over-period deltas) for a `from`/`to` ISO window. */
      analytics: (range?: { from?: string; to?: string }): Promise<AnalyticsSummary> => {
        const qs = new URLSearchParams();
        if (range?.from) qs.set("from", range.from);
        if (range?.to) qs.set("to", range.to);
        const q = qs.toString();
        return request(config, q ? `/orders/analytics?${q}` : "/orders/analytics", {
          schema: analyticsSummarySchema,
        });
      },
      get: (id: string): Promise<Order> =>
        request(config, `/orders/${encodeURIComponent(id)}`, {
          schema: orderSchema,
        }),
      /** Download the sales report (Summary, Daily Sales, Orders, Order Items,
       *  Item Summary) as an .xlsx workbook for a `from`/`to` ISO window —
       *  the table/item-level export for bookkeeping/reconciliation. Returns
       *  the raw file blob + server-suggested filename; the caller triggers
       *  the browser download. */
      exportSalesReport: (range?: {
        from?: string;
        to?: string;
      }): Promise<{ blob: Blob; filename: string }> => {
        const qs = new URLSearchParams();
        if (range?.from) qs.set("from", range.from);
        if (range?.to) qs.set("to", range.to);
        const q = qs.toString();
        return requestBlob(config, q ? `/orders/export?${q}` : "/orders/export");
      },
      /** The captured Payment for an order (method/tax/tip/tendered breakdown),
       *  or null if unpaid — lets a client rebuild a receipt after a refresh. */
      getPayment: (id: string): Promise<Payment | null> =>
        request(config, `/orders/${encodeURIComponent(id)}/payment`, {
          schema: paymentSchema.nullable(),
        }),
      /**
       * Subscribe to the tenant's live order stream (SSE). Calls `handler` for
       * each validated event and returns an unsubscribe fn. EventSource can't
       * set headers, so the tenant rides as `?tenant=` (TenantMiddleware accepts
       * it). Mirrors the KDS transport's EventSource handling; auto-reconnects.
       */
      stream: (handler: (event: OrderStreamEvent) => void): (() => void) => {
        const slug = config.tenantSlug ?? config.getTenantSlug?.();
        // EventSource can't set headers, so the credential rides in the query:
        // a staff bearer token (full-floor stream) or, failing that, this guest
        // device's id (stream scoped server-side to its own session). Without
        // one the server returns 401 — the stream is no longer public.
        const token = config.getToken?.();
        const deviceId = config.getDeviceId?.();
        const params = new URLSearchParams();
        if (slug) params.set("tenant", slug);
        if (token) params.set("token", token);
        else if (deviceId) params.set("deviceId", deviceId);
        const qs = params.toString();
        const url = `${config.baseUrl}/orders/stream${qs ? `?${qs}` : ""}`;
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
      /**
       * Change a line's qty and/or advance its kitchen status. Prefer
       * `qtyDelta` (relative +/-N, applied atomically server-side) over `qty`
       * (absolute; qty:0 removes the line) for stepper-style changes so two
       * rapid taps can't clobber each other via a stale client-side snapshot.
       */
      updateItem: (
        orderId: string,
        itemId: string,
        input: { qty?: number; qtyDelta?: number; status?: ItemStatus },
      ): Promise<Order> =>
        request(
          config,
          `/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}`,
          { method: "PATCH", body: input, schema: orderSchema },
        ),
      /**
       * Re-bind an open session to the current device by verifying the guest's
       * phone number. Use when the customer re-scanned the QR after losing their
       * browser state (cleared storage / new device) and the table shows "in use".
       */
      reclaimSession: (tableId: string, customerPhone: string): Promise<Order> =>
        request(config, "/orders/reclaim", {
          method: "POST",
          body: { tableId, customerPhone },
          schema: orderSchema,
        }),
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
      /** Staff-only: apply (or, with 0, clear) a loyalty points redemption on an
       *  open/billed order before capturing payment. See loyalty.manage. */
      redeemPoints: (orderId: string, points: number): Promise<Order> =>
        request(config, `/orders/${encodeURIComponent(orderId)}/loyalty/redeem`, {
          method: "POST",
          body: { points },
          schema: orderSchema,
        }),
    },

    /**
     * Guest service requests (water / call staff / call manager) — a
     * separate, lightweight notification channel from Order/KDS. Guests
     * create; staff list/acknowledge/resolve.
     */
    serviceRequests: {
      /** Guest taps a Quick Action. Server dedupes identical pending requests
       *  per table, so re-tapping is safe. */
      create: (input: {
        tableId: string;
        type: z.infer<typeof serviceRequestTypeSchema>;
      }): Promise<ServiceRequest> =>
        request(config, "/service-requests", {
          method: "POST",
          body: input,
          schema: serviceRequestSchema,
        }),
      /** Staff-only: open requests (defaults to pending + acknowledged). */
      list: (status?: ServiceRequestStatus): Promise<ServiceRequest[]> =>
        request(
          config,
          status
            ? `/service-requests?status=${encodeURIComponent(status)}`
            : "/service-requests",
          { schema: z.array(serviceRequestSchema) },
        ),
      /** Staff-only: acknowledge/resolve a request. */
      updateStatus: (
        id: string,
        status: ServiceRequestStatus,
      ): Promise<ServiceRequest> =>
        request(config, `/service-requests/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: { status },
          schema: serviceRequestSchema,
        }),
      /** Subscribe to the tenant's live service-request stream (SSE). Mirrors
       *  orders.stream's EventSource handling (tenant via `?tenant=`). */
      stream: (handler: (event: ServiceRequestStreamEvent) => void): (() => void) => {
        const slug = config.tenantSlug ?? config.getTenantSlug?.();
        // Staff-only feed: the bearer token rides in the query since EventSource
        // can't set headers (server requires a tenant-matched tables.manage
        // token — no longer public).
        const token = config.getToken?.();
        const params = new URLSearchParams();
        if (slug) params.set("tenant", slug);
        if (token) params.set("token", token);
        const qs = params.toString();
        const url = `${config.baseUrl}/service-requests/stream${qs ? `?${qs}` : ""}`;
        const source = new EventSource(url);
        source.onmessage = (msg) => {
          try {
            const event = parseServiceRequestStreamEvent(JSON.parse(msg.data));
            if (event) handler(event);
          } catch {
            /* ignore malformed frames */
          }
        };
        return () => source.close();
      },
    },

    /**
     * Staff-only customer loyalty directory (requires loyalty.manage). No
     * guest-facing surface — accounts are created/credited server-side from
     * order flow, never from a client call.
     */
    loyalty: {
      accounts: {
        list: (search?: string): Promise<LoyaltyAccount[]> =>
          request(
            config,
            search ? `/loyalty/accounts?search=${encodeURIComponent(search)}` : "/loyalty/accounts",
            { schema: z.array(loyaltyAccountSchema) },
          ),
        get: (
          id: string,
        ): Promise<{
          account: LoyaltyAccount;
          transactions: LoyaltyTransaction[];
          orders: LoyaltyOrderSummary[];
        }> =>
          request(config, `/loyalty/accounts/${encodeURIComponent(id)}`, {
            schema: z.object({
              account: loyaltyAccountSchema,
              transactions: z.array(loyaltyTransactionSchema),
              orders: z.array(z.object({
                id: z.string(),
                tableLabel: z.string(),
                status: z.string(),
                createdAt: z.string(),
                items: z.array(z.object({
                  name: z.string(),
                  qty: z.number(),
                  unitPrice: z.number(),
                })),
                payment: z.object({
                  method: z.string(),
                  subtotal: z.number(),
                  tax: z.number(),
                  tip: z.number(),
                  total: z.number(),
                }).nullable(),
              })),
            }),
          }),
        /** Manual point correction (comp/fix) — writes an "adjust" transaction. */
        adjust: (id: string, input: { points: number; note?: string }): Promise<LoyaltyAccount> =>
          request(config, `/loyalty/accounts/${encodeURIComponent(id)}/adjust`, {
            method: "PATCH",
            body: input,
            schema: loyaltyAccountSchema,
          }),
      },
    },

    /** Cross-tenant operations (super-admin only). */
    admin: {
      listTenants: (): Promise<TenantWithSubscription[]> =>
        request(config, "/admin/tenants", { schema: z.array(tenantWithSubscriptionSchema) }),
      createTenant: (input: CreateTenantInput): Promise<Tenant> =>
        request(config, "/admin/tenants", {
          method: "POST",
          body: input,
          schema: tenantSchema,
        }),
      getTenant: (id: string): Promise<TenantWithSubscription> =>
        request(config, `/admin/tenants/${encodeURIComponent(id)}`, {
          schema: tenantWithSubscriptionSchema,
        }),
      updateTenant: (id: string, input: Partial<CreateTenantInput> & { active?: boolean }): Promise<TenantWithSubscription> =>
        request(config, `/admin/tenants/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: input,
          schema: tenantWithSubscriptionSchema,
        }),
      getTenantPayments: (tenantId: string): Promise<TenantPayment[]> =>
        request(config, `/admin/tenants/${encodeURIComponent(tenantId)}/payments`, {
          schema: z.array(z.object({
            id: z.string(),
            tableLabel: z.string(),
            customerName: z.string().nullable(),
            total: z.number(),
            method: z.string(),
            createdAt: z.string(),
          })),
        }),
      getCredentials: (): Promise<TenantCredential[]> =>
        request(config, "/admin/credentials", {
          schema: z.array(z.object({
            tenantId: z.string(),
            tenantName: z.string(),
            tenantSlug: z.string(),
            tenantActive: z.boolean(),
            ownerEmail: z.string().nullable(),
            ownerName: z.string().nullable(),
            ownerUserId: z.string().nullable(),
            hasPassword: z.boolean(),
          })),
        }),
      resetOwnerPassword: (tenantId: string, userId: string, newPassword: string): Promise<{ ok: true }> =>
        request(config, `/admin/tenants/${encodeURIComponent(tenantId)}/reset-owner-password`, {
          method: "POST",
          body: { userId, newPassword },
          schema: z.object({ ok: z.literal(true) }),
        }),
      listPlans: (): Promise<Plan[]> =>
        request(config, "/admin/plans", { schema: z.array(planSchema) }),
      createPlan: (input: CreatePlanInput): Promise<Plan> =>
        request(config, "/admin/plans", {
          method: "POST",
          body: input,
          schema: planSchema,
        }),
      updatePlan: (id: string, input: UpdatePlanInput): Promise<Plan> =>
        request(config, `/admin/plans/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: input,
          schema: planSchema,
        }),
      setSubscription: (tenantId: string, input: SetSubscriptionInput): Promise<SubscriptionWithPlan> =>
        request(config, `/admin/tenants/${encodeURIComponent(tenantId)}/subscription`, {
          method: "POST",
          body: input,
          schema: subscriptionWithPlanSchema,
        }),
      updateSubscriptionStatus: (tenantId: string, input: UpdateSubscriptionStatusInput): Promise<SubscriptionWithPlan> =>
        request(config, `/admin/tenants/${encodeURIComponent(tenantId)}/subscription`, {
          method: "PATCH",
          body: input,
          schema: subscriptionWithPlanSchema,
        }),
      impersonate: (input: { tenantSlug: string; masterPassword?: string }): Promise<{ token: string }> =>
        request(config, "/admin/impersonate", {
          method: "POST",
          body: input,
          schema: z.object({ token: z.string() }),
        }),
      getPlatformAnalytics: (): Promise<PlatformAnalytics> =>
        request(config, "/admin/analytics", {
          schema: z.object({
            totalGmvCents: z.number(),
            gmv30dCents: z.number(),
            gmv30dDeltaPct: z.number(),
            mrrCents: z.number(),
            activeSubscriptions: z.number(),
            orders30d: z.number(),
            orders30dDeltaPct: z.number(),
            revenueSeries: z.array(z.object({ date: z.string(), cents: z.number() })),
            topTenants: z.array(z.object({ tenantId: z.string(), name: z.string(), totalCents: z.number() })),
            methodSplit: z.object({ cash: z.number(), card: z.number() }),
          }),
        }),
      getAuditLog: (params: { limit?: number; offset?: number; type?: string; from?: string; to?: string }): Promise<{ entries: AuditLogEntry[]; total: number }> => {
        const qs = new URLSearchParams();
        if (params.limit !== undefined) qs.set("limit", String(params.limit));
        if (params.offset !== undefined) qs.set("offset", String(params.offset));
        if (params.type) qs.set("type", params.type);
        if (params.from) qs.set("from", params.from);
        if (params.to) qs.set("to", params.to);
        const query = qs.toString() ? `?${qs.toString()}` : "";
        return request(config, `/admin/audit-log${query}`, {
          schema: z.object({
            entries: z.array(z.object({
              id: z.string(),
              type: z.string(),
              actor: z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable(),
              tenant: z.object({ id: z.string(), name: z.string(), slug: z.string() }).nullable(),
              metadata: z.record(z.unknown()),
              createdAt: z.string(),
            })),
            total: z.number(),
          }),
        });
      },
      /** Cross-tenant customer lookup (platform support). Read-only. */
      loyaltyAccounts: {
        list: (params?: { search?: string; tenantId?: string }): Promise<AdminLoyaltyAccountSummary[]> => {
          const qs = new URLSearchParams();
          if (params?.search) qs.set("search", params.search);
          if (params?.tenantId) qs.set("tenantId", params.tenantId);
          const query = qs.toString() ? `?${qs.toString()}` : "";
          return request(config, `/admin/loyalty/accounts${query}`, {
            schema: z.array(z.object({
              id: z.string(),
              phone: z.string(),
              name: z.string().nullable(),
              pointsBalance: z.number(),
              lifetimePoints: z.number(),
              tenantId: z.string(),
              tenantName: z.string(),
              tenantSlug: z.string(),
              updatedAt: z.string(),
            })),
          });
        },
        get: (id: string): Promise<AdminLoyaltyAccountDetail> =>
          request(config, `/admin/loyalty/accounts/${encodeURIComponent(id)}`, {
            schema: z.object({
              id: z.string(),
              phone: z.string(),
              name: z.string().nullable(),
              pointsBalance: z.number(),
              lifetimePoints: z.number(),
              tenantId: z.string(),
              tenantName: z.string(),
              tenantSlug: z.string(),
              updatedAt: z.string(),
              createdAt: z.string(),
              transactions: z.array(z.object({
                id: z.string(),
                type: z.string(),
                points: z.number(),
                balanceAfter: z.number(),
                note: z.string().nullable(),
                orderId: z.string().nullable(),
                createdAt: z.string(),
              })),
            }),
          }),
      },
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Clone an existing client bound to a different tenant slug. */
export function withTenant(client: ApiClient, tenantSlug: string): ApiClient {
  return createApiClient({ ...client.config, tenantSlug });
}

export { ApiError as ApiClientError };
