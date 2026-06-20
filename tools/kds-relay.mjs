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

/** Sample tickets so the board isn't empty on first load. */
function seed() {
  const now = Date.now();
  const mk = (mins, t) => new Date(now - mins * 60_000).toISOString();
  return [
    {
      id: "seed-1",
      tableLabel: "Table 7",
      type: "bundled",
      note: "Extra jalapeños, less ice",
      stage: "preparing",
      createdAt: mk(11),
      items: [
        { id: "i1", name: "Loaded Nachos", qty: 1, ref: `KDS-${refSeq++}` },
        { id: "i2", name: "Iced Oat Latte", qty: 1, ref: `KDS-${refSeq++}` },
      ],
    },
    {
      id: "seed-2",
      tableLabel: "Table 2",
      type: "bundled",
      stage: "ready",
      createdAt: mk(7),
      items: [
        { id: "i3", name: "Flat White", qty: 2, ref: `KDS-${refSeq++}` },
        { id: "i4", name: "Avocado Toast", qty: 1, ref: `KDS-${refSeq++}` },
      ],
    },
  ];
}

let tickets = seed();

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
  if (req.method === "POST" && url.pathname === "/kds/rounds") {
    const body = await readJson(req);
    const ticket = {
      id: String(body.id ?? `tk_${Date.now()}`),
      tableLabel: String(body.tableLabel ?? "Table ?"),
      type: body.type === "instant" ? "instant" : "bundled",
      note: body.note || undefined,
      stage: "placed",
      createdAt: new Date().toISOString(),
      items: (Array.isArray(body.items) ? body.items : []).map((it, idx) => ({
        id: String(it.id ?? `it_${Date.now()}_${idx}`),
        name: String(it.name ?? "Item"),
        qty: Number(it.qty ?? 1),
        notes: it.notes || undefined,
        ref: `KDS-${refSeq++}`,
      })),
    };
    tickets = [...tickets, ticket];
    broadcast({ type: "ticket-added", ticket });
    console.log(`+ round  ${ticket.tableLabel} (${ticket.items.length} items)`);
    return send(res, 201, ticket);
  }

  // --- KDS advances a ticket's stage ---
  if (req.method === "POST" && url.pathname === "/kds/stage") {
    const body = await readJson(req);
    const ticket = tickets.find((t) => t.id === String(body.ticketId));
    if (!ticket) return send(res, 404, { message: "ticket not found" });
    ticket.stage = String(body.stage);
    if (ticket.stage === "served") {
      tickets = tickets.filter((t) => t.id !== ticket.id);
      broadcast({ type: "ticket-updated", ticket }); // let the guest see "served"
      broadcast({ type: "ticket-removed", ticketId: ticket.id });
    } else {
      broadcast({ type: "ticket-updated", ticket });
    }
    console.log(`~ stage  ${ticket.tableLabel} -> ${ticket.stage}`);
    return send(res, 200, ticket);
  }

  send(res, 404, { message: "not found" });
});

server.listen(PORT, () => {
  console.log(`KDS relay listening on http://localhost:${PORT}`);
  console.log(`  stream:  GET  /kds/stream   (SSE)`);
  console.log(`  list:    GET  /kds/tickets`);
  console.log(`  publish: POST /kds/rounds`);
  console.log(`  stage:   POST /kds/stage`);
});
