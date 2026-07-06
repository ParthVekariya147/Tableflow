import {
  Body,
  Controller,
  Get,
  Headers,
  type MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  Sse,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { SkipThrottle } from "@nestjs/throttler";
import {
  defer,
  filter,
  from,
  map,
  merge,
  mergeMap,
  of,
  type Observable,
} from "rxjs";
import type {
  Order,
  Payment,
  Sale,
  Tenant,
  OrderStatus,
  AnalyticsSummary,
} from "@amber/domain";
import { OrdersService } from "./orders.service.js";
import { OrdersEvents, type OrderEvent } from "./orders.events.js";
import { CurrentTenant } from "../tenant/current-tenant.decorator.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import {
  PermissionsGuard,
  RequirePermission,
  RequireAnyPermission,
} from "../auth/permissions.guard.js";
import {
  OrderStreamGuard,
  type StreamRequest,
} from "./order-stream.guard.js";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "../auth/auth.service.js";
import type { JwtPayload } from "../auth/auth.types.js";
import {
  addRoundSchema,
  createOrderSchema,
  addItemSchema,
  updateItemSchema,
  capturePaymentSchema,
  reclaimSessionSchema,
  redeemLoyaltyPointsSchema,
} from "./orders.dto.js";

@Controller("orders")
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly events: OrdersEvents,
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Best-effort staff check for the routes shared by guests and staff
   * (GET /orders/:id, POST /orders/:id/payment). These stay public so guests can
   * use them with only a device id, but staff (admin/KDS) call them with a
   * bearer token and no device id. A valid, tenant-matched token means the caller
   * is authenticated staff → the device-binding gate is bypassed for them; a
   * missing/invalid token falls back to guest rules (strict device match). Never
   * throws — absence of a token is the normal guest case, not an error.
   */
  private async isStaff(
    authHeader: string | undefined,
    tenantId: string,
  ): Promise<boolean> {
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : undefined;
    if (!token) return false;
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      const user = payload.imp
        ? await this.auth.resolveImpersonationUser(payload.tid, payload.slug ?? "")
        : await this.auth.resolveAuthUser(payload.tid, payload.sub);
      return user.isSuperAdmin || user.tenantId === tenantId;
    } catch {
      return false;
    }
  }

  /**
   * Live order stream (Server-Sent Events). Every mutation broadcasts here so
   * admin / customer / KDS reflect changes in real time. Declared before `:id`
   * so "stream" isn't read as an order id. EventSource can't set headers, so the
   * tenant is resolved from `?tenant=` and the credential from `?token=` (staff)
   * or `?deviceId=` (guest) — see OrderStreamGuard, which authenticates the
   * connection and sets `req.streamScope`. On (re)connect a `snapshot` is emitted
   * first so a reconnecting client re-syncs.
   *
   * Scope by caller:
   *  - staff → the whole tenant floor (same data as GET /orders);
   *  - guest → ONLY that device's own live sessions, so the stream can't be used
   *    to read the entire floor or other guests' contact details.
   * @SkipThrottle — single long-lived connection, not a request burst.
   */
  @SkipThrottle()
  @UseGuards(OrderStreamGuard)
  @Sse("stream")
  stream(
    @CurrentTenant() tenant: Tenant,
    @Req() req: StreamRequest,
  ): Observable<MessageEvent> {
    const scope = req.streamScope!;
    if (scope.kind === "staff") {
      const snapshot = defer(() =>
        from(this.orders.list(tenant.id)).pipe(
          map(
            (orders): MessageEvent => ({
              data: { type: "snapshot", orders } satisfies OrderEvent,
            }),
          ),
        ),
      );
      return merge(snapshot, this.events.stream(tenant.id));
    }
    // Guest: resolve this device's own live sessions, snapshot them, and pass
    // through only their events — never the rest of the floor.
    const { deviceId } = scope;
    return defer(() => from(this.orders.listByDevice(tenant.id, deviceId))).pipe(
      mergeMap((own) => {
        const ids = new Set(own.map((o) => o.id));
        const snapshot: MessageEvent = {
          data: { type: "snapshot", orders: own } satisfies OrderEvent,
        };
        const live = this.events
          .stream(tenant.id)
          .pipe(
            filter((e) => e.data.type !== "snapshot" && ids.has(e.data.orderId)),
          );
        return merge(of(snapshot), live);
      }),
    );
  }

  /** Staff-only: list sessions (defaults to live: open + billed). Optional ?status=. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("tables.manage")
  @Get()
  list(
    @CurrentTenant() tenant: Tenant,
    @Query("status") status?: OrderStatus,
  ): Promise<Order[]> {
    return this.orders.list(tenant.id, status);
  }

  /** Table ids with a live session — lean occupancy check (declared before :id).
   *  Used by the customer app's QR boot / reservation race guard instead of the
   *  full `list("open")`, which carries the whole ROUND_INCLUDE graph. */
  @Get("open-table-ids")
  openTableIds(@CurrentTenant() tenant: Tenant): Promise<string[]> {
    return this.orders.listOpenTableIds(tenant.id);
  }

  /** Staff-only: completed sales (declared before :id so it isn't read as an id).
   *  Optional ?from=&to= ISO window for the Order History page; omitted = recent feed. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("orders.history")
  @Get("sales")
  sales(
    @CurrentTenant() tenant: Tenant,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<Sale[]> {
    return this.orders.listSales(tenant.id, { from, to });
  }

  /** Staff-only: aggregated analytics for the dashboard + Analytics page. Optional
   *  ?from=&to= ISO window (defaults to the last 24h). Declared before :id. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAnyPermission("analytics.view", "dashboard.view")
  @Get("analytics")
  analytics(
    @CurrentTenant() tenant: Tenant,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<AnalyticsSummary> {
    return this.orders.getAnalytics(tenant.id, { from, to });
  }

  /** Staff-only: download the sales report as an .xlsx workbook (Summary,
   *  Daily Sales, Orders, Order Items, Item Summary) for a `from`/`to` ISO
   *  window — same access + range semantics as `sales`. Gated on either
   *  permission that can reach this data in the UI (Order History **or**
   *  the Sales Analytics page — same pairing as `analytics` above) so a
   *  Manager who can see the report can also export it. Declared before :id. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAnyPermission("orders.history", "analytics.view")
  @Get("export")
  async export(
    @CurrentTenant() tenant: Tenant,
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.orders.exportSalesReport(
      tenant.id,
      { name: tenant.name, currency: tenant.currency },
      { from, to },
    );
    res.set({
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }

  /** Public — the guest app polls its own order (device-id bound); staff also
   *  use this for a single order's detail. */
  @Get(":id")
  async get(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Headers("x-device-id") deviceId?: string,
    @Headers("authorization") authHeader?: string,
  ): Promise<Order> {
    const staff = await this.isStaff(authHeader, tenant.id);
    return this.orders.get(tenant.id, id, deviceId, staff);
  }

  /**
   * Staff-only: the payment captured for this order (method/tax/tip/tendered
   * breakdown), if any — lets a client rebuild a receipt after a refresh
   * instead of relying solely on the in-memory result of `/payment`.
   *
   * Uses `@Res()` directly (bypassing Nest's automatic response handling)
   * because Nest sends an EMPTY body — not the JSON literal `null` — when a
   * handler's return value is `null`/`undefined`, which the api-client's
   * `paymentSchema.nullable()` can't parse (empty text ≠ `null`). Calling
   * Express's `res.json()` ourselves serializes `null` correctly.
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("tables.manage")
  @Get(":id/payment")
  async getPayment(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    const payment = await this.orders.getPayment(tenant.id, id);
    res.json(payment);
  }

  /**
   * Public — guest-only. Re-bind an open session to a new device using
   * phone-number ownership proof. Declared before ":id" routes so "reclaim" is
   * never mistaken for an order id.
   */
  @Post("reclaim")
  reclaim(
    @CurrentTenant() tenant: Tenant,
    @Body() body: unknown,
    @Headers("x-device-id") deviceId?: string,
  ): Promise<Order> {
    return this.orders.reclaimSession(
      tenant.id,
      reclaimSessionSchema.parse(body),
      deviceId,
    );
  }

  /** Public — the guest app opens a session with no login; staff walk-in seating
   *  (restaurant-admin's "Open Session") also calls this, sending no device id. */
  @Post()
  create(
    @CurrentTenant() tenant: Tenant,
    @Body() body: unknown,
    @Headers("x-device-id") deviceId?: string,
  ): Promise<Order> {
    return this.orders.createForTable(
      tenant.id,
      createOrderSchema.parse(body),
      deviceId,
      tenant.loyalty,
    );
  }

  /** Public — the guest app's round submission ("bring it" / "bring these"), and
   *  staff's batched "Add Item" (one call for N lines instead of N `addItem`
   *  POSTs) via restaurant-admin. */
  @Post(":id/rounds")
  async addRound(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("x-device-id") deviceId?: string,
    @Headers("authorization") authHeader?: string,
  ): Promise<Order> {
    const staff = await this.isStaff(authHeader, tenant.id);
    return this.orders.addRound(
      tenant.id,
      id,
      addRoundSchema.parse(body),
      deviceId,
      staff,
    );
  }

  /** Staff-only: add an item to a session on the guest's behalf. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("tables.manage")
  @Post(":id/items")
  addItem(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<Order> {
    return this.orders.addItem(tenant.id, id, addItemSchema.parse(body));
  }

  /** Staff-only: change a line's qty and/or advance its kitchen status (KDS).
   *  Shared by the floor (tables.manage) and the kitchen board (kds.use). */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireAnyPermission("kds.use", "tables.manage")
  @Patch(":id/items/:itemId")
  updateItem(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ): Promise<Order> {
    return this.orders.updateItem(
      tenant.id,
      id,
      itemId,
      updateItemSchema.parse(body),
    );
  }

  /** Public — guest-only bill request. */
  @Post(":id/bill")
  requestBill(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Headers("x-device-id") deviceId?: string,
  ): Promise<Order> {
    return this.orders.requestBill(tenant.id, id, deviceId);
  }

  /** Staff-only: abandon a session without payment. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("tables.manage")
  @Post(":id/cancel")
  cancel(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
  ): Promise<Order> {
    return this.orders.cancel(tenant.id, id);
  }

  /** Public — the guest's "Pay Online" (card, device-bound) and staff's cash
   *  capture (bearer token, no device id) both call this. Staff are resolved from
   *  the token (bypass the device gate); a guest must present the owning device. */
  @Post(":id/payment")
  async payment(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("x-device-id") deviceId?: string,
    @Headers("authorization") authHeader?: string,
  ): Promise<Payment> {
    const staff = await this.isStaff(authHeader, tenant.id);
    return this.orders.capturePayment(
      tenant.id,
      id,
      tenant.taxRate,
      capturePaymentSchema.parse(body),
      deviceId,
      staff,
      tenant.loyalty,
    );
  }

  /** Staff-only: apply (or clear, with points:0) a loyalty points redemption
   *  before capturing payment — see loyalty.ts / LoyaltyPage / BillingPage. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("loyalty.manage")
  @Post(":id/loyalty/redeem")
  redeemPoints(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<Order> {
    return this.orders.redeemPoints(
      tenant.id,
      id,
      redeemLoyaltyPointsSchema.parse(body),
      tenant.loyalty,
    );
  }
}
