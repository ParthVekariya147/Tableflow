import { Injectable } from "@nestjs/common";
import { Subject, type Observable, filter, map } from "rxjs";
import type { Order } from "@amber/domain";

/**
 * A live change to a table session, pushed to every subscribed client.
 *  - `snapshot` is sent once per (re)connect so a fresh/reconnecting client
 *    re-syncs the whole floor without a manual fetch.
 *  - `created` / `updated` / `closed` carry the freshly-mapped Order after a
 *    mutation (created = new session, closed = cancelled/paid).
 */
export type OrderEvent =
  | { type: "snapshot"; orders: Order[] }
  | { type: "created" | "updated" | "closed"; orderId: string; order: Order };

interface TenantEvent {
  tenantId: string;
  event: OrderEvent;
}

/**
 * In-process pub/sub for order mutations. Every OrdersService mutation calls
 * `emit(tenantId, …)`; the SSE route subscribes via `stream(tenantId)`. Keyed by
 * tenant so a client only ever sees its own tenant's floor (same scope as
 * `orders.list`). No external infra — this is the path that retires the relay.
 */
@Injectable()
export class OrdersEvents {
  private readonly subject = new Subject<TenantEvent>();

  emit(tenantId: string, event: OrderEvent): void {
    this.subject.next({ tenantId, event });
  }

  /** Live stream of this tenant's order events, shaped for Nest's `@Sse`. */
  stream(tenantId: string): Observable<{ data: OrderEvent }> {
    return this.subject.pipe(
      filter((e) => e.tenantId === tenantId),
      map((e) => ({ data: e.event })),
    );
  }
}
