/**
 * KDS relay — a tiny, dependency-free mock backend for the Kitchen Display.
 *
 * Why this exists: the customer app (:5173) and the KDS (:5174) are different
 * origins, so browser-only channels (BroadcastChannel, localStorage) can't sync
 * between them. This relay is the shared point they both talk to until the real
 * NestJS backend lands. It uses ONLY Node's built-in `http` — no npm install.
 *
 *   Server -> client : Server-Sent Events  (GET  /kds/stream)
 *   Client -> server : JSON POST           (POST /kds/rounds, /kds/stage)
 *   Snapshot         : GET  /kds/tickets
 *
 * Run it:  node tools/kds-relay.mjs       (or: pnpm dev:kds-relay)
 *
 * Swap path: when @amber/api wires up an Orders WebSocket/SSE gateway, delete
 * this and point the HTTP transport's baseUrl at the API. The wire shapes here
 * deliberately mirror @amber/api-client's KdsTicket / KdsEvent.
 */
import http from "node:http";

const PORT = Number(process.env.KDS_RELAY_PORT ?? 4001);

/** @type {Set<import('node:http').ServerResponse>} */
const clients = new Set();
let refSeq = 100;

// Keep served tickets around for a grace window instead of deleting them the
// instant they're served. Why: a guest phone whose tab was backgrounded/closed
// drops its SSE stream and MISSES the live "served" event; on reconnect it gets
// a fresh snapshot, so the served ticket must still be there for the phone to
// learn the final status (otherwise it's stuck showing "placed"). The board
// ignores served tickets (no column), so this is invisible to the kitchen.
const SERVED_TTL_MS = 15 * 60_000;

// The board starts EMPTY — tickets only appear when the customer app actually
// sends a round (POST /kds/rounds). No seeded/sample tickets, so nothing shows
// on the KDS unless there's a real order.
let tickets = [];

function broadcast(event) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(frame);
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  // CORS — allow the customer and KDS apps (any localhost port) to talk to us.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // --- snapshot ---
  if (req.method === "GET" && url.pathname === "/kds/tickets") {
    return send(res, 200, tickets);
  }

  // --- live stream (SSE) ---
  if (req.method === "GET" && url.pathname === "/kds/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "snapshot", tickets })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  // --- customer publishes a round ("bring it" / "bring these") ---
  // Each LINE ITEM becomes its own ticket on the board: a bulk order is plated
  // dish-by-dish (every item has its own cook timeline), so the kitchen advances
  // each independently instead of one all-or-nothing card. The ticket id is the
  // composite `roundId::itemId` so the guest app can still map each item's
  // status back to the right line in its round (see SessionContext subscribe).
  if (req.method === "POST" && url.pathname === "/kds/rounds") {
    const body = await readJson(req);
    const roundId = String(body.id ?? `tk_${Date.now()}`);
    const orderId = body.orderId ? String(body.orderId) : undefined;
    const tableLabel = String(body.tableLabel ?? "Table ?");
    const type = body.type === "instant" ? "instant" : "bundled";
    const note = body.note || undefined;
    const createdAt = new Date().toISOString();
    const items = Array.isArray(body.items) ? body.items : [];

    const newTickets = items.map((it, idx) => {
      const itemId = String(it.id ?? `it_${Date.now()}_${idx}`);
      return {
        id: `${roundId}::${itemId}`,
        roundId,
        orderId,
        tableLabel,
        type,
        note,
        stage: "placed",
        createdAt,
        items: [
          {
            id: itemId,
            name: String(it.name ?? "Item"),
            qty: Number(it.qty ?? 1),
            notes: it.notes || undefined,
            ref: `KDS-${refSeq++}`,
          },
        ],
      };
    });

    tickets = [...tickets, ...newTickets];
    for (const ticket of newTickets) broadcast({ type: "ticket-added", ticket });
    console.log(`+ round  ${tableLabel} (${newTickets.length} item ticket(s))`);
    return send(res, 201, newTickets);
  }

  // --- order cancelled/closed: drop ALL of its tickets from the board ---
  // When staff cancel (or settle) an order, its kitchen tickets must vanish so
  // the kitchen can't keep cooking / advancing a dead order (which would write a
  // bogus status back to the guest). Removes every ticket carrying this orderId.
  if (req.method === "POST" && url.pathname === "/kds/cancel-order") {
    const body = await readJson(req);
    const orderId = body.orderId ? String(body.orderId) : null;
    if (!orderId) return send(res, 400, { message: "orderId required" });
    const removed = tickets.filter((t) => t.orderId === orderId);
    if (removed.length) {
      tickets = tickets.filter((t) => t.orderId !== orderId);
      for (const t of removed)
        broadcast({ type: "ticket-removed", ticketId: t.id });
      console.log(`x cancel ${orderId} (${removed.length} ticket(s) removed)`);
    }
    return send(res, 200, { removed: removed.length });
  }

  // --- a single item was cancelled: drop just that ticket (any column) ---
  // The ticket id is `roundId::orderItemId`, so staff cancelling one dish in the
  // admin can pull exactly that card off the board (the rest of the order stays).
  if (req.method === "POST" && url.pathname === "/kds/remove-ticket") {
    const body = await readJson(req);
    const ticketId = body.ticketId ? String(body.ticketId) : null;
    if (!ticketId) return send(res, 400, { message: "ticketId required" });
    const before = tickets.length;
    tickets = tickets.filter((t) => t.id !== ticketId);
    const removed = before - tickets.length;
    if (removed) {
      broadcast({ type: "ticket-removed", ticketId });
      console.log(`x remove ${ticketId}`);
    }
    return send(res, 200, { removed });
  }

  // --- KDS advances a ticket's stage ---
  if (req.method === "POST" && url.pathname === "/kds/stage") {
    const body = await readJson(req);
    const ticket = tickets.find((t) => t.id === String(body.ticketId));
    if (!ticket) return send(res, 404, { message: "ticket not found" });
    ticket.stage = String(body.stage);
    // Served tickets are KEPT (with a timestamp) so a reconnecting guest can
    // still read the final status from the snapshot; the GC timer removes them
    // after SERVED_TTL_MS. The board never renders served tickets.
    if (ticket.stage === "served") ticket.servedAt = Date.now();
    else delete ticket.servedAt;
    broadcast({ type: "ticket-updated", ticket });
    console.log(`~ stage  ${ticket.tableLabel} -> ${ticket.stage}`);
    return send(res, 200, ticket);
  }

  send(res, 404, { message: "not found" });
});

// Sweep out served tickets once their grace window has elapsed, telling any
// still-connected client to drop them.
setInterval(() => {
  const cutoff = Date.now() - SERVED_TTL_MS;
  const expired = tickets.filter(
    (t) => t.stage === "served" && (t.servedAt ?? 0) < cutoff,
  );
  if (expired.length === 0) return;
  tickets = tickets.filter((t) => !expired.includes(t));
  for (const t of expired) broadcast({ type: "ticket-removed", ticketId: t.id });
}, 60_000).unref?.();

server.listen(PORT, () => {
  console.log(`KDS relay listening on http://localhost:${PORT}`);
  console.log(`  stream:  GET  /kds/stream   (SSE)`);
  console.log(`  list:    GET  /kds/tickets`);
  console.log(`  publish: POST /kds/rounds`);
  console.log(`  stage:   POST /kds/stage`);
  console.log(`  cancel:  POST /kds/cancel-order`);
  console.log(`  remove:  POST /kds/remove-ticket`);
});
