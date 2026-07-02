import {
  Body,
  Controller,
  Get,
  type MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { defer, from, map, merge, type Observable } from "rxjs";
import type { ServiceRequest, ServiceRequestStatus, Tenant } from "@amber/domain";
import { ServiceRequestsService } from "./service-requests.service.js";
import { ServiceRequestsEvents, type ServiceRequestEvent } from "./service-requests.events.js";
import { CurrentTenant } from "../tenant/current-tenant.decorator.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { PermissionsGuard, RequirePermission } from "../auth/permissions.guard.js";
import { ServiceRequestStreamGuard } from "./service-request-stream.guard.js";
import {
  createServiceRequestSchema,
  updateServiceRequestStatusSchema,
} from "./service-requests.dto.js";

@Controller("service-requests")
export class ServiceRequestsController {
  constructor(
    private readonly requests: ServiceRequestsService,
    private readonly events: ServiceRequestsEvents,
  ) {}

  /**
   * Live stream (SSE), staff-side. Declared before ":id" so "stream" isn't
   * read as a request id. EventSource can't set headers, so the tenant is
   * resolved from `?tenant=` by TenantMiddleware — same trick as
   * orders.controller.ts's stream(). Emits a snapshot of open requests on
   * (re)connect, then created/updated as they happen. Staff-only: the guest app
   * posts requests but never subscribes, so ServiceRequestStreamGuard requires a
   * tenant-matched `tables.manage` token via `?token=`.
   */
  @SkipThrottle()
  @UseGuards(ServiceRequestStreamGuard)
  @Sse("stream")
  stream(@CurrentTenant() tenant: Tenant): Observable<MessageEvent> {
    const snapshot = defer(() =>
      from(this.requests.list(tenant.id)).pipe(
        map(
          (requests): MessageEvent => ({
            data: { type: "snapshot", requests } satisfies ServiceRequestEvent,
          }),
        ),
      ),
    );
    return merge(snapshot, this.events.stream(tenant.id));
  }

  /** Public — the guest app posts a Quick Action tap. No device binding: a
   *  service request isn't sensitive per-device state (unlike an Order). */
  @Post()
  create(
    @CurrentTenant() tenant: Tenant,
    @Body() body: unknown,
  ): Promise<ServiceRequest> {
    return this.requests.create(tenant.id, createServiceRequestSchema.parse(body));
  }

  /** Staff-only: open requests for the notification bell. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("tables.manage")
  @Get()
  list(
    @CurrentTenant() tenant: Tenant,
    @Query("status") status?: ServiceRequestStatus,
  ): Promise<ServiceRequest[]> {
    return this.requests.list(tenant.id, status);
  }

  /** Staff-only: acknowledge/resolve a request. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("tables.manage")
  @Patch(":id")
  updateStatus(
    @CurrentTenant() tenant: Tenant,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ServiceRequest> {
    return this.requests.updateStatus(
      tenant.id,
      id,
      updateServiceRequestStatusSchema.parse(body),
    );
  }
}
