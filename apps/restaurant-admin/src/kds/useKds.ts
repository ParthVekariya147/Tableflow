import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyKdsEvent,
  nextStage,
  type KdsStage,
  type KdsTicket,
} from "@amber/api-client";
import type { Order } from "@amber/domain";
import { kdsClient } from "./kdsClient";
import { api } from "../lib/api";

/** An order is "live" (kitchen-relevant) while it's open or awaiting the bill. */
function isLiveStatus(status: string): boolean {
  return status === "open" || status === "billed";
}

/** Add the ids of an order's explicitly-cancelled items to `into`. */
function collectCancelledItems(order: Order, into: Set<string>): void {
  for (const round of order.rounds) {
    for (const item of round.items) {
      if (item.status === "cancelled") into.add(item.id);
    }
  }
}

/**
 * Subscribes the board to the KDS transport: loads the snapshot, then folds live
 * events into local state. All transport details stay behind kdsClient.
 *
 * The relay is separate from the API and can hold STALE tickets — a cancelled
 * order, a settled one, or (the common case) a single item staff cancelled while
 * the rest of the order keeps going. So we also subscribe to the API order stream
 * and reconcile, but ONLY on POSITIVE evidence: we hide/purge a ticket when its
 * order is seen to CLOSE, or its item is explicitly `cancelled`. We never hide a
 * ticket merely because the stream hasn't mentioned it yet — a brand-new order's
 * ticket reaches the relay before the API event, and must still show. Both sets
 * below only grow from real events, so new tickets are never wrongly dropped.
 */
export function useKds() {
  const [tickets, setTickets] = useState<KdsTicket[]>([]);
  const [connected, setConnected] = useState(false);
  // Orders we've SEEN close (cancelled/paid). Only grows → never hides new ones.
  const [closedOrderIds, setClosedOrderIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Items explicitly cancelled. An item never un-cancels, so this only grows.
  const [cancelledItemIds, setCancelledItemIds] = useState<Set<string>>(
    () => new Set(),
  );

  // --- KDS relay (live board) ---
  useEffect(() => {
    let active = true;

    kdsClient
      .list()
      .then((initial) => {
        if (!active) return;
        setTickets(initial);
        setConnected(true);
      })
      .catch(() => active && setConnected(false));

    const unsubscribe = kdsClient.subscribe((event) => {
      setConnected(true);
      setTickets((prev) => applyKdsEvent(prev, event));
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // --- API order stream (truth for closed orders + cancelled items) ---
  useEffect(() => {
    const unsub = api.orders.stream((event) => {
      if (event.type === "snapshot") {
        const cancelled = new Set<string>();
        for (const o of event.orders) collectCancelledItems(o, cancelled);
        setCancelledItemIds((prev) => new Set([...prev, ...cancelled]));
        return; // snapshot lists only LIVE orders — don't infer closures from it
      }
      const { order, orderId } = event;
      setCancelledItemIds((prev) => {
        const next = new Set(prev);
        collectCancelledItems(order, next);
        return next;
      });
      if (event.type === "closed" || !isLiveStatus(order.status)) {
        setClosedOrderIds((prev) => new Set(prev).add(orderId));
        // Pull the whole (dead) order's tickets off the relay so the guest phone
        // / the /kds/display popout converge too.
        void kdsClient.cancelOrder?.(orderId);
      }
    });
    return unsub;
  }, []);

  // Mirrors for advance()'s guard (fresh read without re-creating the callback).
  const closedRef = useRef<Set<string>>(closedOrderIds);
  closedRef.current = closedOrderIds;
  const cancelledRef = useRef<Set<string>>(cancelledItemIds);
  cancelledRef.current = cancelledItemIds;

  /** True unless we have POSITIVE evidence the ticket is dead (order closed or
   *  item cancelled). Unknown / not-yet-seen tickets stay visible. */
  const isTicketActive = useCallback((ticket: KdsTicket): boolean => {
    if (ticket.orderId && closedRef.current.has(ticket.orderId)) return false;
    const itemId = ticket.items[0]?.id;
    if (itemId && cancelledRef.current.has(itemId)) return false;
    return true;
  }, []);

  // Render: drop only tickets whose order is known-closed or item is cancelled.
  const visibleTickets = tickets.filter((t) => {
    if (t.orderId && closedOrderIds.has(t.orderId)) return false;
    const itemId = t.items[0]?.id;
    if (itemId && cancelledItemIds.has(itemId)) return false;
    return true;
  });

  // Ticket ids we've already asked the relay to drop (so we don't re-POST).
  const purgedRef = useRef<Set<string>>(new Set());

  // Actively pull CANCELLED-ITEM tickets off the relay so the guest phone / the
  // /kds/display popout converge. (Closed orders are purged via cancelOrder
  // above.) Conservative: only explicitly-cancelled items — never a new ticket.
  useEffect(() => {
    for (const t of tickets) {
      const itemId = t.items[0]?.id;
      if (!itemId || !cancelledItemIds.has(itemId)) continue;
      if (purgedRef.current.has(t.id)) continue;
      purgedRef.current.add(t.id);
      void kdsClient.removeTicket?.(t.id);
    }
  }, [tickets, cancelledItemIds]);

  /** Advance a ticket one stage (placed → preparing → ready → served). */
  const advance = useCallback(
    (ticket: KdsTicket) => {
      // Guard: don't advance a dead ticket (order closed / item cancelled) —
      // drop it instead of pushing a bogus status to the relay/guest.
      if (!isTicketActive(ticket)) {
        void kdsClient.removeTicket?.(ticket.id);
        setTickets((prev) => prev.filter((t) => t.id !== ticket.id));
        return;
      }

      const next = nextStage(ticket.stage);
      if (!next) return;
      // Live board (relay) — drives the UI for every connected client.
      void kdsClient.setStage(ticket.id, next);
      // Persist to the Order so the status survives a guest refresh/resume. Each
      // ticket is one line item; its id is the DB OrderItem id (shared id space).
      // If the order/item is no longer editable the API 409s — drop the ticket.
      const itemId = ticket.items[0]?.id;
      if (ticket.orderId && itemId) {
        void api.orders
          .updateItem(ticket.orderId, itemId, { status: next })
          .catch((err: unknown) => {
            const status = (err as { status?: number } | null)?.status;
            if (status === 409) {
              void kdsClient.removeTicket?.(ticket.id);
              setTickets((prev) => prev.filter((t) => t.id !== ticket.id));
            }
          });
      }
    },
    [isTicketActive],
  );

  const setStage = useCallback((ticketId: string, stage: KdsStage) => {
    void kdsClient.setStage(ticketId, stage);
  }, []);

  return { tickets: visibleTickets, connected, advance, setStage };
}
