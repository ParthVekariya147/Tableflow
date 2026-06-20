import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import type { Order, Tenant } from "@amber/domain";
import { OrdersService } from "./orders.service.js";
import { CurrentTenant } from "../tenant/current-tenant.decorator.js";
import {
  addRoundSchema,
  createOrderSchema,
  type AddRoundDto,
  type CreateOrderDto,
} from "./orders.dto.js";

@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

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
    const dto: CreateOrderDto = createOrderSchema.parse(body);
    return this.orders.createForTable(tenant.id, dto);
  }

  @Post(":id/rounds")
  addRound(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<Order> {
    const dto: AddRoundDto = addRoundSchema.parse(body);
    return this.orders.addRound(tenant.id, id, dto);
  }

  @Post(":id/bill")
  requestBill(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
  ): Promise<Order> {
    return this.orders.requestBill(tenant.id, id);
  }
}
