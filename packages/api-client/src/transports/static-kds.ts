/**
 * In-memory KDS transport — no server required.
 *
 * Seeded from a fixed list; mutations are local to this instance and broadcast
 * to that instance's own subscribers only (single tab / single process). Useful
 * for tests, Storybook, or rendering the board offline when the relay is down.
 * Same interface as the HTTP transport, so it's a drop-in.
 */
import {
  nextStage,
  type KdsEvent,
  type KdsStage,
  type KdsTicket,
  type KdsTransport,
  type PublishRoundInput,
} from "../kds.js";

let seq = 200;

export function createStaticKdsTransport(
  seed: KdsTicket[] = [],
): KdsTransport {
  let tickets: KdsTicket[] = seed.map((t) => ({ ...t }));
  const handlers = new Set<(e: KdsEvent) => void>();
  const emit = (event: KdsEvent) => handlers.forEach((h) => h(event));

  return {
    async list() {
      return tickets.map((t) => ({ ...t }));
    },
    subscribe(handler) {
      handlers.add(handler);
      handler({ type: "snapshot", tickets });
      return () => handlers.delete(handler);
    },
    async publishRound(input: PublishRoundInput) {
      const ticket: KdsTicket = {
        id: input.id ?? `tk_${Date.now()}`,
        tableLabel: input.tableLabel,
        type: input.type,
        note: input.note,
        items: input.items.map((it) => ({
          id: it.id ?? `it_${seq}`,
          name: it.name,
          qty: it.qty,
          notes: it.notes,
          ref: `KDS-${seq++}`,
        })),
        stage: "placed",
        createdAt: new Date().toISOString(),
      };
      tickets = [...tickets, ticket];
      emit({ type: "ticket-added", ticket });
      return ticket;
    },
    async setStage(ticketId: string, stage: KdsStage) {
      const ticket = tickets.find((t) => t.id === ticketId);
      if (!ticket) return;
      const updated = { ...ticket, stage };
      tickets = tickets.map((t) => (t.id === ticketId ? updated : t));
      emit({ type: "ticket-updated", ticket: updated });
      if (stage === "served") {
        tickets = tickets.filter((t) => t.id !== ticketId);
        emit({ type: "ticket-removed", ticketId });
      }
    },
  };
}

export { nextStage };
