import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module.js";
import { TenantModule } from "./tenant/tenant.module.js";
import { MenuModule } from "./menu/menu.module.js";
import { OrdersModule } from "./orders/orders.module.js";
import { AdminModule } from "./admin/admin.module.js";
import { TenantMiddleware } from "./tenant/tenant.middleware.js";

@Module({
  imports: [
    PrismaModule,
    TenantModule,
    MenuModule,
    OrdersModule,
    AdminModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Resolve the tenant from X-Tenant-Slug on all tenant-scoped routes.
    // /admin/* (super-admin, cross-tenant) is intentionally excluded.
    consumer
      .apply(TenantMiddleware)
      .exclude("admin/(.*)")
      .forRoutes("*");
  }
}
