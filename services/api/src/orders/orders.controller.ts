import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type { Order, Payment, Sale, Tenant, OrderStatus } from "@amber/domain";
import { OrdersService } from "./orders.service.js";
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
  constructor(private readonly orders: OrdersService) {}

  /** List sessions (defaults to live: open + billed). Optional ?status=. */
  @Get()
  list(
    @CurrentTenant() tenant: Tenant,
    @Query("status") status?: OrderStatus,
  ): Promise<Order[]> {
    return this.orders.list(tenant.id, status);
  }

  /** Recent completed sales (declared before :id so it isn't read as an id). */
  @Get("sales")
  sales(@CurrentTenant() tenant: Tenant): Promise<Sale[]> {
    return this.orders.listSales(tenant.id);
  }

  @Get(":id")
  get(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
  ): Promise<Order> {
    return this.orders.get(tenant.id, id);
  }

  @Post()
  create(
    @CurrentTenant() tenant: Tenant,
    @Body() body: unknown,
  ): Promise<Order> {
    return this.orders.createForTable(tenant.id, createOrderSchema.parse(body));
  }

  @Post(":id/rounds")
  addRound(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<Order> {
    return this.orders.addRound(tenant.id, id, addRoundSchema.parse(body));
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
  ): Promise<Order> {
    return this.orders.requestBill(tenant.id, id);
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
  ): Promise<Payment> {
    return this.orders.capturePayment(
      tenant.id,
      id,
      tenant.taxRate,
      capturePaymentSchema.parse(body),
    );
  }
}
