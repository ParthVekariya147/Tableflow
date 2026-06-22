import { Module } from "@nestjs/common";
import { OrdersService } from "./orders.service.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersEvents } from "./orders.events.js";

@Module({
  providers: [OrdersService, OrdersEvents],
  controllers: [OrdersController],
})
export class OrdersModule {}
