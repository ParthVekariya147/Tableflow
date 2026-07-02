import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { PrismaModule } from "./prisma/prisma.module.js";
import { TenantModule } from "./tenant/tenant.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { RolesModule } from "./roles/roles.module.js";
import { MembersModule } from "./members/members.module.js";
import { MenuModule } from "./menu/menu.module.js";
import { TablesModule } from "./tables/tables.module.js";
import { OrdersModule } from "./orders/orders.module.js";
import { ServiceRequestsModule } from "./service-requests/service-requests.module.js";
import { AdminModule } from "./admin/admin.module.js";
import { HealthModule } from "./health/health.module.js";
import { TenantMiddleware } from "./tenant/tenant.middleware.js";
import { GlobalExceptionFilter } from "./common/http-exception.filter.js";

@Module({
  imports: [
    // Global rate limit: 120 requests / 60 s per IP.
    // Mutations (POST /orders, POST /rounds) stay well within this window.
    // The SSE stream endpoint skips throttling via @SkipThrottle() — it's a
    // single long-lived connection, not a burst of requests.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    TenantModule,
    AuthModule,
    RolesModule,
    MembersModule,
    MenuModule,
    TablesModule,
    OrdersModule,
    ServiceRequestsModule,
    AdminModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Resolve the tenant from X-Tenant-Slug on all tenant-scoped routes.
    // /admin/* (super-admin, cross-tenant) is excluded; so is /auth/* —
    // email-first login isn't tenant-scoped (login picks the tenant, and /auth/me
    // reads it from the bearer token), so it must run without the header.
    consumer
      .apply(TenantMiddleware)
      .exclude("admin/(.*)", "auth/(.*)", "health")
      .forRoutes("*");
  }
}
