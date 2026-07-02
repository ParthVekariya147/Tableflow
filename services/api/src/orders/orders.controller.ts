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
  Res,
  Sse,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { SkipThrottle } from "@nestjs/throttler";
import { defer, from, map, merge, type Observable } from "rxjs";
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
  addRoundSchema,
  createOrderSchema,
  addItemSchema,
  updateItemSchema,
  capturePaymentSchema,
  reclaimSessionSchema,
} from "./orders.dto.js";

@Controller("orders")
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly events: OrdersEvents,
  ) {}

  /**
   * Live order stream (Server-Sent Events). Every mutation broadcasts here so
   * admin / customer / KDS reflect changes in real time. Declared before `:id`
   * so "stream" isn't read as an order id. EventSource can't set headers, so the
   * tenant is resolved from `?tenant=` by TenantMiddleware. On (re)connect it
   * first emits a `snapshot` of the live floor so a reconnecting client re-syncs.
   * @SkipThrottle — single long-lived connection, not a request burst.
   */
  @SkipThrottle()
  @Sse("stream")
  stream(@CurrentTenant() tenant: Tenant): Observable<MessageEvent> {
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

  /** Staff-only: list sessions (defaults to live: open + billed). Optional ?status=. */
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  @Get("analytics")
  analytics(
    @CurrentTenant() tenant: Tenant,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<AnalyticsSummary> {
    return this.orders.getAnalytics(tenant.id, { from, to });
  }

  /** Public — the guest app polls its own order (device-id bound); staff also
   *  use this for a single order's detail. */
  @Get(":id")
  get(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Headers("x-device-id") deviceId?: string,
  ): Promise<Order> {
    return this.orders.get(tenant.id, id, deviceId);
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
  @UseGuards(JwtAuthGuard)
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
    );
  }

  /** Public — guest-only round submission ("bring it" / "bring these"). */
  @Post(":id/rounds")
  addRound(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("x-device-id") deviceId?: string,
  ): Promise<Order> {
    return this.orders.addRound(
      tenant.id,
      id,
      addRoundSchema.parse(body),
      deviceId,
    );
  }

  /** Staff-only: add an item to a session on the guest's behalf. */
  @UseGuards(JwtAuthGuard)
  @Post(":id/items")
  addItem(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<Order> {
    return this.orders.addItem(tenant.id, id, addItemSchema.parse(body));
  }

  /** Staff-only: change a line's qty and/or advance its kitchen status (KDS). */
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  @Post(":id/cancel")
  cancel(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
  ): Promise<Order> {
    return this.orders.cancel(tenant.id, id);
  }

  /** Public — the guest's "Pay Online" (card) and staff's cash capture both call
   *  this with no distinguishing credential today; see PRODUCTION_READINESS_AUDIT.md
   *  C3 for the remaining follow-up (a guest-scoped session token). */
  @Post(":id/payment")
  payment(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("x-device-id") deviceId?: string,
  ): Promise<Payment> {
    return this.orders.capturePayment(
      tenant.id,
      id,
      tenant.taxRate,
      capturePaymentSchema.parse(body),
      deviceId,
    );
  }
}
