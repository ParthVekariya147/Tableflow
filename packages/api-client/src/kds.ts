/**
 * @amber/api-client — Kitchen Display System (KDS) transport.
 *
 * This is the SEAM between the customer app (which publishes rounds) and the
 * restaurant-admin KDS board (which renders + advances them). The UI talks ONLY
 * to the `KdsTransport` interface, never to a concrete data source, so the
 * backend can change without touching any screen:
 *
 *   today   -> createHttpKdsTransport(...)   // dependency-free Node SSE relay
 *   later   -> a NestJS REST + WebSocket transport (same interface)
 *   tests   -> createStaticKdsTransport(...)  // in-memory, seeded
 *
 * A KDS "ticket" is one round for a table (the customer's "bring it" / "bring
 * these"). It maps cleanly onto the domain Round/Order once the real API lands;
 * the extra `ready` stage is kitchen-only (food plated, not yet delivered).
 */

/** Kitchen lifecycle of a whole ticket. Drives which board column it sits in. */
export type KdsStage = "placed" | "preparing" | "ready" | "served";

/** Ordered kitchen stages; index is used to advance a ticket. */
export const KDS_STAGES: readonly KdsStage[] = [
  "placed",
  "preparing",
  "ready",
  "served",
];

/** Next stage after `stage`, or null if already terminal (served). */
export function nextStage(stage: KdsStage): KdsStage | null {
  const i = KDS_STAGES.indexOf(stage);
  return i >= 0 && i < KDS_STAGES.length - 1 ? KDS_STAGES[i + 1] : null;
}

/** A single line on a ticket. */
export interface KdsTicketItem {
  id: string;
  name: string;
  qty: number;
  notes?: string;
  /** Human kitchen reference shown on the card (e.g. "KDS-102"). */
  ref?: string;
}

/** One round on the board. `id` mirrors the customer round id so status can
 *  round-trip back to the guest's app. */
export interface KdsTicket {
  id: string;
  tableLabel: string;
  /** "instant" = "bring it", "bundled" = "bring these". */
  type: "instant" | "bundled";
  /** Round-level note for the kitchen. */
  note?: string;
  items: KdsTicketItem[];
  stage: KdsStage;
  /** ISO timestamp the round reached the kitchen. */
  createdAt: string;
}

/** What the customer side sends to publish a round. The transport/relay fills
 *  in ids, refs, stage and createdAt. */
export interface PublishRoundInput {
  /** Share the customer's round id so kitchen status can be reflected back. */
  id?: string;
  tableLabel: string;
  type: "instant" | "bundled";
  note?: string;
  items: Array<{ id?: string; name: string; qty: number; notes?: string }>;
}

/** Live changes pushed to every subscriber. */
export type KdsEvent =
  | { type: "snapshot"; tickets: KdsTicket[] }
  | { type: "ticket-added"; ticket: KdsTicket }
  | { type: "ticket-updated"; ticket: KdsTicket }
  | { type: "ticket-removed"; ticketId: string };

/**
 * The one interface every KDS data source implements. Swapping the backend =
 * swapping the object that satisfies this; no UI code changes.
 */
export interface KdsTransport {
  /** Current board snapshot (initial load). */
  list(): Promise<KdsTicket[]>;
  /** Subscribe to live changes. Returns an unsubscribe fn. */
  subscribe(handler: (event: KdsEvent) => void): () => void;
  /** Customer side: push a new round to the kitchen. */
  publishRound(input: PublishRoundInput): Promise<KdsTicket>;
  /** KDS side: move a ticket to a new stage (served removes it from the board). */
  setStage(ticketId: string, stage: KdsStage): Promise<void>;
  /** Optional cleanup (e.g. close the event stream). */
  close?(): void;
}

/** Apply a single event to a ticket list. Shared by every consumer so the
 *  reducer logic lives in one place. */
export function applyKdsEvent(
  tickets: KdsTicket[],
  event: KdsEvent,
): KdsTicket[] {
  switch (event.type) {
    case "snapshot":
      return event.tickets;
    case "ticket-added":
      // De-dupe in case the snapshot already carried it.
      return tickets.some((t) => t.id === event.ticket.id)
        ? tickets.map((t) => (t.id === event.ticket.id ? event.ticket : t))
        : [...tickets, event.ticket];
    case "ticket-updated":
      return tickets.map((t) => (t.id === event.ticket.id ? event.ticket : t));
    case "ticket-removed":
      return tickets.filter((t) => t.id !== event.ticketId);
    default:
      return tickets;
  }
}
