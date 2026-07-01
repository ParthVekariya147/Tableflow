import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyKdsEvent,
  nextStage,
  type KdsStage,
  type KdsTicket,
} from "@amber/api-client";
import type { Order, ItemStatus } from "@amber/domain";
import { kdsClient } from "./kdsClient";
import { api } from "../lib/api";
import { useAdmin } from "../store/AdminStore";

/** An order is "live" (kitchen-relevant) while it's open or awaiting the bill. */
function isLiveStatus(status: string): boolean {
  return status === "open" || status === "billed";
}

/** Map a DB item status to a KDS stage. Returns null for served/cancelled (off-board). */
function itemStatusToStage(status: ItemStatus): KdsStage | null {
  if (status === "placed" || status === "preparing" || status === "ready")
    return status;
  return null;
}

/**
 * Synthesise KDS tickets from a set of live DB orders.
 * One ticket per in-progress item; id = "roundId::itemId" (same format the relay uses
 * so advance() write-backs and relay delta events reference the same ids).
 */
function ordersToKdsTickets(
  orders: Order[],
  tableLabels: Map<string, string>,
): KdsTicket[] {
  const tickets: KdsTicket[] = [];
  for (const order of orders) {
    const label = tableLabels.get(order.tableId) ?? order.tableId.slice(-4);
    for (const round of order.rounds) {
      for (const item of round.items) {
        const stage = itemStatusToStage(item.status);
        if (!stage) continue;
        const modSummary = item.modifiers?.length
          ? ` (${item.modifiers.map((m) => m.textValue ?? m.name).filter(Boolean).join(", ")})`
          : "";
        tickets.push({
          id: `${round.id}::${item.id}`,
          orderId: order.id,
          tableLabel: `Table ${label}`,
          type: round.type,
          stage,
          createdAt: round.createdAt,
          items: [{ id: item.id, name: item.name + modSummary, qty: item.qty }],
        });
      }
    }
  }
  return tickets;
}

/** Add the ids of an order's explicitly-cancelled items to `into`, timestamped now. */
function collectCancelledItems(order: Order, into: Map<string, number>): void {
  const now = Date.now();
  for (const round of order.rounds) {
    for (const item of round.items) {
      if (item.status === "cancelled" && !into.has(item.id)) into.set(item.id, now);
    }
  }
}

// `/kds/display` is meant to run chrome-free and unattended for a whole shift
// (or longer) — closedOrderIds/cancelledItemIds used to only ever grow (by
// design, so a stale relay frame could never resurrect a dead ticket) and
// terminal tickets were never dropped from `tickets`, just filtered at render
// time. Both leaked slowly for the tab's lifetime. A retention window long
// enough that any plausible stale/replayed relay frame has already arrived
// lets us safely retire entries instead of keeping them forever.
const TERMINAL_RETENTION_MS = 15 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * KDS board state. The API order stream is the PRIMARY source of truth:
 *
 *   snapshot  → seed the board from all live DB orders (works with relay down)
 *   created   → new order: add its initial tickets
 *   updated   → round added or status changed: replace tickets for that order
 *   closed    → order done: drop all its tickets
 *
 * The KDS relay supplements in real-time (faster local round-trips) but the
 * board works fully without it. `connected` reflects API connectivity, which is
 * always up when the admin is logged in — the "Offline" badge disappears.
 */
export function useKds() {
  const { subscribeOrderEvents, state } = useAdmin();
  const [tickets, setTickets] = useState<KdsTicket[]>([]);
  const [connected, setConnected] = useState(false);
  // Orders we've SEEN close, id -> when. Grows until the periodic sweep below
  // retires entries past TERMINAL_RETENTION_MS (paired with dropping their
  // tickets from `tickets` in the same pass — see the sweep effect).
  const [closedOrderIds, setClosedOrderIds] = useState<Map<string, number>>(
    () => new Map(),
  );
  // Items explicitly cancelled, id -> when. Same retention as above.
  const [cancelledItemIds, setCancelledItemIds] = useState<Map<string, number>>(
    () => new Map(),
  );

  // Table id → label, sourced from AdminStore's already-loaded floor rather
  // than a separate `api.tables.list()` fetch. That separate fetch used to
  // race the order-stream snapshot: `subscribeOrderEvents` can deliver its
  // seed synchronously on mount (see AdminStore.tsx), so ticket synthesis
  // could run before the labels fetch resolved — permanently baking in the
  // `tableId.slice(-4)` fallback (e.g. "Table 3ye7") as the ticket's label,
  // since a ticket's label is never recomputed after creation. AdminStore
  // blocks rendering until its own floor is loaded, so `state.tables` is
  // always populated by the time useKds runs — no race possible.
  const tableLabels = useMemo(
    () => new Map(state.tables.map((t) => [t.id, t.label])),
    [state.tables],
  );
  const tableLabelsRef = useRef(tableLabels);
  tableLabelsRef.current = tableLabels;

  // --- KDS relay (supplementary; gracefully degrades when relay is not running) ---
  useEffect(() => {
    let active = true;

    // Use relay snapshot only for faster initial display (may have cached tickets).
    // The API snapshot fills the board either way.
    kdsClient
      .list()
      .then((initial) => {
        if (!active || initial.length === 0) return;
        setTickets(initial);
      })
      .catch(() => {}); // relay down is fine — API stream covers everything

    const unsubscribe = kdsClient.subscribe((event) => {
      // Skip relay snapshot — the API stream is the authoritative initial state.
      // Only apply per-ticket delta events (added / updated / removed).
      if (event.type === "snapshot") return;
      setTickets((prev) => applyKdsEvent(prev, event));
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // --- API order stream — primary source for new rounds + closes + cancels ---
  // Consumes the AdminStore's single `/orders/stream` connection (which already
  // wraps the whole app, including /kds and /kds/display) rather than opening a
  // second EventSource per KDS tab.
  useEffect(() => {
    const unsub = subscribeOrderEvents((event) => {
      // First event received means the API stream is live.
      setConnected(true);

      if (event.type === "snapshot") {
        // Seed the cancelled-item tracker.
        const cancelled = new Map<string, number>();
        for (const o of event.orders) collectCancelledItems(o, cancelled);
        setCancelledItemIds((prev) => new Map([...prev, ...cancelled]));

        // Synthesise tickets from all live orders; merge with any relay-sourced ones
        // already in state (de-duplicate by id so we don't double relay tickets).
        const synthesized = ordersToKdsTickets(
          event.orders,
          tableLabelsRef.current,
        );
        setTickets((prev) => {
          if (prev.length === 0) return synthesized;
          const existingIds = new Set(prev.map((t) => t.id));
          const toAdd = synthesized.filter((t) => !existingIds.has(t.id));
          return [...prev, ...toAdd];
        });
        return;
      }

      const { order, orderId } = event;

      // Track any newly-cancelled items.
      setCancelledItemIds((prev) => {
        const next = new Map(prev);
        collectCancelledItems(order, next);
        return next;
      });

      if (event.type === "closed" || !isLiveStatus(order.status)) {
        // Order settled or cancelled — clear its tickets from the board and the relay.
        setClosedOrderIds((prev) => new Map(prev).set(orderId, Date.now()));
        void kdsClient.cancelOrder?.(orderId);
      } else {
        // Order created or updated (new round added, item status advanced, etc.).
        // Re-derive all tickets for this order from the fresh DB state so the board
        // always reflects reality even when the relay is down or stale.
        const label =
          tableLabelsRef.current.get(order.tableId) ??
          order.tableId.slice(-4);
        const freshTickets = ordersToKdsTickets(
          [order],
          new Map([[order.tableId, label]]),
        );
        setTickets((prev) => {
          // Replace all tickets for this order with the fresh set, then append.
          // This handles: new round (add tickets), status advance (update stage),
          // item cancel (ticket disappears — filtered by itemStatusToStage).
          const without = prev.filter((t) => t.orderId !== orderId);
          return [...without, ...freshTickets];
        });
      }
    });
    return unsub;
  }, [subscribeOrderEvents]);

  // Mirrors for advance()'s guard (fresh read without re-creating the callback).
  const closedRef = useRef<Map<string, number>>(closedOrderIds);
  closedRef.current = closedOrderIds;
  const cancelledRef = useRef<Map<string, number>>(cancelledItemIds);
  cancelledRef.current = cancelledItemIds;

  // Ticket ids with a stage-advance write in flight — drives the button's
  // loading spinner and blocks a double-click from firing a second PATCH
  // while the first is still pending.
  const [advancingIds, setAdvancingIds] = useState<Set<string>>(() => new Set());
  const advancingRef = useRef<Set<string>>(advancingIds);
  advancingRef.current = advancingIds;

  const clearAdvancing = useCallback((ticketId: string) => {
    setAdvancingIds((prev) => {
      if (!prev.has(ticketId)) return prev;
      const next = new Set(prev);
      next.delete(ticketId);
      return next;
    });
  }, []);

  /** True unless we have POSITIVE evidence the ticket is dead. */
  const isTicketActive = useCallback((ticket: KdsTicket): boolean => {
    if (ticket.orderId && closedRef.current.has(ticket.orderId)) return false;
    const itemId = ticket.items[0]?.id;
    if (itemId && cancelledRef.current.has(itemId)) return false;
    return true;
  }, []);

  // Drop tickets whose order is known-closed or item is cancelled. Memoized so
  // an unrelated re-render of a KdsPage consumer doesn't re-derive the whole
  // board's ticket list every time.
  const visibleTickets = useMemo(
    () =>
      tickets.filter((t) => {
        if (t.orderId && closedOrderIds.has(t.orderId)) return false;
        const itemId = t.items[0]?.id;
        if (itemId && cancelledItemIds.has(itemId)) return false;
        return true;
      }),
    [tickets, closedOrderIds, cancelledItemIds],
  );

  // Ticket ids we've already asked the relay to drop.
  const purgedRef = useRef<Set<string>>(new Set());

  // Pull cancelled-item tickets off the relay so the /kds/display popout converges.
  useEffect(() => {
    for (const t of tickets) {
      const itemId = t.items[0]?.id;
      if (!itemId || !cancelledItemIds.has(itemId)) continue;
      if (purgedRef.current.has(t.id)) continue;
      purgedRef.current.add(t.id);
      void kdsClient.removeTicket?.(t.id);
    }
  }, [tickets, cancelledItemIds]);

  // Periodic retirement of terminal (closed-order / cancelled-item) entries —
  // `/kds/display` runs chrome-free and unattended for a whole shift or
  // longer, so without this both tracking maps and the `tickets` array grow
  // for the tab's entire lifetime. Retiring a tracking entry and dropping its
  // matching tickets happen in the SAME pass so there's never a render where
  // a ticket is untracked (would look "active" again) while still sitting in
  // `tickets` — the actual invariant the "only grows" design was protecting.
  useEffect(() => {
    const sweep = () => {
      const now = Date.now();
      const staleOrders = new Set<string>();
      for (const [orderId, at] of closedRef.current) {
        if (now - at > TERMINAL_RETENTION_MS) staleOrders.add(orderId);
      }
      const staleItems = new Set<string>();
      for (const [itemId, at] of cancelledRef.current) {
        if (now - at > TERMINAL_RETENTION_MS) staleItems.add(itemId);
      }
      if (staleOrders.size === 0 && staleItems.size === 0) return;

      if (staleOrders.size > 0) {
        setClosedOrderIds((prev) => {
          const next = new Map(prev);
          for (const id of staleOrders) next.delete(id);
          return next;
        });
      }
      if (staleItems.size > 0) {
        setCancelledItemIds((prev) => {
          const next = new Map(prev);
          for (const id of staleItems) next.delete(id);
          return next;
        });
      }
      setTickets((prev) =>
        prev.filter((t) => {
          const dead =
            (t.orderId && staleOrders.has(t.orderId)) ||
            staleItems.has(t.items[0]?.id ?? "");
          if (dead) purgedRef.current.delete(t.id); // bounds this Set too
          return !dead;
        }),
      );
    };
    const id = setInterval(sweep, SWEEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  /** Advance a ticket one stage (placed → preparing → ready → served). */
  const advance = useCallback(
    (ticket: KdsTicket) => {
      if (!isTicketActive(ticket)) {
        void kdsClient.removeTicket?.(ticket.id);
        setTickets((prev) => prev.filter((t) => t.id !== ticket.id));
        return;
      }

      // Already writing this ticket's advance — ignore a repeat/double click
      // rather than firing a second PATCH for the same transition.
      if (advancingRef.current.has(ticket.id)) return;

      const next = nextStage(ticket.stage);
      if (!next) return;

      setAdvancingIds((prev) => new Set(prev).add(ticket.id));

      // Relay (optimistic, faster visual update if relay is running).
      void kdsClient.setStage(ticket.id, next);

      // DB (source of truth; triggers SSE → board re-derives from DB).
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
          })
          .finally(() => clearAdvancing(ticket.id));
      } else {
        clearAdvancing(ticket.id);
      }
    },
    [isTicketActive, clearAdvancing],
  );

  const setStage = useCallback((ticketId: string, stage: KdsStage) => {
    void kdsClient.setStage(ticketId, stage);
  }, []);

  return { tickets: visibleTickets, connected, advance, setStage, advancingIds };
}
