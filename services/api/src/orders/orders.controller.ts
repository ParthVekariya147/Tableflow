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
  Sse,
} from "@nestjs/common";
import { defer, from, map, merge, type Observable } from "rxjs";
import type { Order, Payment, Sale, Tenant, OrderStatus } from "@amber/domain";
import { OrdersService } from "./orders.service.js";
import { OrdersEvents, type OrderEvent } from "./orders.events.js";
import { CurrentTenant } from "../tenant/current-tenant.decorator.js";
import {
  addRoundSchema,
  createOrderSchema,
  addItemSchema,
  updateItemSchema,
  capturePaymentSchema,
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
   */
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

  /** List sessions (defaults to live: open + billed). Optional ?status=. */
  @Get()
  list(
    @CurrentTenant() tenant: Tenant,
    @Query("status") status?: OrderStatus,
  ): Promise<Order[]> {
    return this.orders.list(tenant.id, status);
  }

  /** Completed sales (declared before :id so it isn't read as an id). Optional
   *  ?from=&to= ISO window for the Order History page; omitted = recent feed. */
  @Get("sales")
  sales(
    @CurrentTenant() tenant: Tenant,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<Sale[]> {
    return this.orders.listSales(tenant.id, { from, to });
  }

  @Get(":id")
  get(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Headers("x-device-id") deviceId?: string,
  ): Promise<Order> {
    return this.orders.get(tenant.id, id, deviceId);
  }

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

  @Post(":id/items")
  addItem(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<Order> {
    return this.orders.addItem(tenant.id, id, addItemSchema.parse(body));
  }

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

  @Post(":id/bill")
  requestBill(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Headers("x-device-id") deviceId?: string,
  ): Promise<Order> {
    return this.orders.requestBill(tenant.id, id, deviceId);
  }

  @Post(":id/cancel")
  cancel(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
  ): Promise<Order> {
    return this.orders.cancel(tenant.id, id);
  }

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
