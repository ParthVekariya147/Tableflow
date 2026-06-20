import { useCallback, useEffect, useState } from "react";
import {
  applyKdsEvent,
  nextStage,
  type KdsStage,
  type KdsTicket,
} from "@amber/api-client";
import { kdsClient } from "./kdsClient";

/**
 * Subscribes the board to the KDS transport: loads the snapshot, then folds
 * live events into local state. All transport details (SSE, polling, the future
 * backend) stay behind kdsClient — this hook only knows the KdsTransport shape.
 */
export function useKds() {
  const [tickets, setTickets] = useState<KdsTicket[]>([]);
  const [connected, setConnected] = useState(false);

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

  /** Advance a ticket one stage (placed → preparing → ready → served). */
  const advance = useCallback((ticket: KdsTicket) => {
    const next = nextStage(ticket.stage);
    if (next) void kdsClient.setStage(ticket.id, next);
  }, []);

  const setStage = useCallback((ticketId: string, stage: KdsStage) => {
    void kdsClient.setStage(ticketId, stage);
  }, []);

  return { tickets, connected, advance, setStage };
}
