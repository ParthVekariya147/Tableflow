import { Injectable } from "@nestjs/common";
import { Subject, type Observable, filter, map } from "rxjs";
import type { ServiceRequest } from "@amber/domain";

/**
 * A live change to a guest service request, pushed to every subscribed
 * admin client. Mirrors OrdersEvents (orders/orders.events.ts) — one Subject
 * per process, filtered by tenant.
 */
export type ServiceRequestEvent =
  | { type: "snapshot"; requests: ServiceRequest[] }
  | { type: "created" | "updated"; request: ServiceRequest };

interface TenantEvent {
  tenantId: string;
  event: ServiceRequestEvent;
}

@Injectable()
export class ServiceRequestsEvents {
  private readonly subject = new Subject<TenantEvent>();

  emit(tenantId: string, event: ServiceRequestEvent): void {
    this.subject.next({ tenantId, event });
  }

  /** Live stream of this tenant's service-request events, shaped for @Sse. */
  stream(tenantId: string): Observable<{ data: ServiceRequestEvent }> {
    return this.subject.pipe(
      filter((e) => e.tenantId === tenantId),
      map((e) => ({ data: e.event })),
    );
  }
}
