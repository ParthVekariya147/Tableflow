import { Module } from "@nestjs/common";
import { OrdersService } from "./orders.service.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersEvents } from "./orders.events.js";
import { OrderStreamGuard } from "./order-stream.guard.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  providers: [OrdersService, OrdersEvents, OrderStreamGuard],
  controllers: [OrdersController],
})
export class OrdersModule {}
