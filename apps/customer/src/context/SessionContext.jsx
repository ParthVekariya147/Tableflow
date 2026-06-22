import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { kitchen } from "../kitchen";
import { useBoot } from "./BootContext";
import { writeSession, markSessionEnded } from "../session-store";

const SessionContext = createContext(null);

/** Map a kitchen (KDS) stage onto the guest's status pills. The guest now sees
 *  the full kitchen lifecycle: placed → preparing → ready → served. */
function stageToStatus(stage) {
  if (stage === "served") return "served";
  if (stage === "ready") return "ready";
  if (stage === "preparing") return "preparing";
  return "placed";
}

/** Human-readable one-line summary of a line's modifiers (for KDS tickets). */
export function modifierSummary(modifiers = []) {
  if (!modifiers.length) return "";
  const parts = modifiers.map((m) => (m.textValue ? `“${m.textValue}”` : m.name));
  return ` (${parts.join(", ")})`;
}

// Stable, collision-resistant id used as BOTH the local key AND the DB primary
// key (round / order-item). Sharing one id space lets the KDS write kitchen
// status straight back to the right OrderItem (survives a guest refresh).
function newId(prefix) {
  const rnd =
    typeof crypto !== "undefined" && crypto.getRandomValues
      ? Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("")
      : Math.random().toString(16).slice(2);
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}

/**
 * Build a cart/round line for an item + its chosen modifiers. `price` is the
 * EFFECTIVE per-unit (base + Σ modifier deltas) so all the existing
 * `price * qty` totals include modifiers automatically; `basePriceCents` keeps
 * the base for the API (which snapshots base unitPrice + each modifier delta).
 * `modifiers`: [{ optionId?, groupName, name, price, priceCents, textValue? }].
 */
function makeLine(item, qty, modifiers = []) {
  const deltaCents = modifiers.reduce((s, m) => s + (m.priceCents || 0), 0);
  const baseCents = item.priceCents ?? Math.round((item.price ?? 0) * 100);
  const unitCents = baseCents + deltaCents;
  return {
    // lineKey doubles as the OrderItem's DB id once the round is sent.
    lineKey: newId("oi"),
    id: item.id,
    name: item.name,
    qty,
    status: "placed",
    basePriceCents: baseCents,
    priceCents: unitCents,
    price: unitCents / 100,
    modifiers,
    img: item.img,
    icon: item.icon,
    swatch: item.swatch,
    desc: item.desc,
  };
}

/** Map a resumed domain Order's rounds onto the local UI round shape (cents →
 *  dollars; effective price incl. modifiers). Lets a refresh rehydrate the
 *  bill/status screens without re-creating anything. */
function ordersToLocalRounds(order) {
  return order.rounds
    .map((r) => ({
      id: r.id,
      type: r.type,
      timestamp: new Date(r.createdAt),
      items: r.items.map((i) => {
        const modifiers = (i.modifiers ?? []).map((m) => ({
          optionId: m.optionId ?? undefined,
          groupName: m.groupName,
          name: m.name,
          priceCents: m.priceDelta,
          price: m.priceDelta / 100,
          textValue: m.textValue,
        }));
        const deltaCents = modifiers.reduce((s, m) => s + m.priceCents, 0);
        return {
          // The DB OrderItem id IS the lineKey (shared id space) so resumed
          // lines match live KDS ticket ids (`roundId::orderItemId`).
          lineKey: i.id,
          id: i.menuItemId ?? i.id,
          name: i.name,
          qty: i.qty,
          basePriceCents: i.unitPrice,
          priceCents: i.unitPrice + deltaCents,
          price: (i.unitPrice + deltaCents) / 100,
          status: i.status,
          modifiers,
        };
      }),
    }))
    .reverse(); // newest first, matching live insertion order
}

export function SessionProvider({ children }) {
  // The api-client + table + (optional) resumed Order from the QR bootstrap.
  const { api, table, tenant, resumeOrder } = useBoot();
  const [tableNumber, setTableNumber] = useState(table?.label ?? "");
  const [sessionStarted, setSessionStarted] = useState(Boolean(resumeOrder));
  const [sessionStartTime, setSessionStartTime] = useState(
    resumeOrder ? new Date(resumeOrder.createdAt) : null,
  );
  // The platform Order (session) backing this visit, once opened via the API.
  const [orderId, setOrderId] = useState(resumeOrder?.id ?? null);
  const orderIdRef = useRef(resumeOrder?.id ?? null);

  /** Persist the active session so a refresh can resume it (see BootContext). */
  const persistSession = useCallback(
    (oid) => {
      if (!tenant?.slug || !table?.qrToken || !oid) return;
      writeSession({
        slug: tenant.slug,
        qrToken: table.qrToken,
        tableId: table.id,
        orderId: oid,
      });
    },
    [tenant, table],
  );
  // Terminal flag (synced from `sessionEnded` below) read by the ordering
  // actions so a settled guest can't keep writing rounds to a closed order.
  const sessionEndedRef = useRef(false);

  // My Order (holding area — not yet sent)
  const [myOrder, setMyOrder] = useState([]);

  // All rounds sent to kitchen this session (rehydrated on resume).
  const [rounds, setRounds] = useState(() =>
    resumeOrder ? ordersToLocalRounds(resumeOrder) : [],
  );

  // Toast notification
  const [toast, setToast] = useState(null);

  // Item detail sheet
  const [sheetItem, setSheetItem] = useState(null);

  // Open a real session on the platform for the scanned table, with the guest's
  // contact. Re-checks occupancy first (race guard: two guests scanning at once)
  // and throws on failure so the reserve screen can show the error.
  const startSession = useCallback(
    async ({ customerName, customerPhone }) => {
      if (!table) throw new Error("No table — please rescan the QR code.");

      const open = await api.orders.list("open");
      if (open.some((o) => o.tableId === table.id)) {
        throw new Error("This table was just taken. Please ask a staff member.");
      }

      const order = await api.orders.createForTable(table.id, {
        customerName,
        customerPhone,
      });
      orderIdRef.current = order.id;
      setOrderId(order.id);
      setTableNumber(table.label);
      setSessionStarted(true);
      setSessionStartTime(new Date());
      // Persist so a refresh resumes THIS order instead of losing it.
      persistSession(order.id);
      return order;
    },
    [api, table, persistSession],
  );

  const showToast = useCallback((msg, icon = "check_circle") => {
    setToast({ msg, icon, id: Date.now() });
    setTimeout(() => setToast(null), 2800);
  }, []);

  // Add to My Order queue. Plain items (no modifiers) merge with an existing
  // plain line of the same item; modified items always become their own line.
  const addToOrder = useCallback((item, qty = 1, modifiers = []) => {
    // Requires a live session — no orderId means nothing to attach to.
    if (sessionEndedRef.current || !orderIdRef.current) return;
    setMyOrder((prev) => {
      if (modifiers.length === 0) {
        const existing = prev.find(
          (x) => x.id === item.id && (x.modifiers?.length ?? 0) === 0,
        );
        if (existing) {
          return prev.map((x) =>
            x.lineKey === existing.lineKey ? { ...x, qty: x.qty + qty } : x,
          );
        }
      }
      return [...prev, makeLine(item, qty, modifiers)];
    });
    showToast(`Added to My Order`, "add_shopping_cart");
  }, [showToast]);

  const updateOrderQty = useCallback((lineKey, delta) => {
    setMyOrder((prev) =>
      prev.map((x) => x.lineKey === lineKey ? { ...x, qty: Math.max(1, x.qty + delta) } : x)
    );
  }, []);

  const removeFromOrder = useCallback((lineKey) => {
    setMyOrder((prev) => prev.filter((x) => x.lineKey !== lineKey));
  }, []);

  // Push a round to the kitchen (KDS). Fire-and-forget: if the relay is down,
  // the guest app still works locally. The round id is shared so the KDS can
  // reflect status changes back to this session.
  const publishRound = useCallback((round) => {
    kitchen
      .publishRound({
        id: String(round.id),
        // Forward the Order id so the KDS can persist status back to the DB.
        orderId: orderIdRef.current ?? undefined,
        tableLabel: `Table ${tableNumber}`,
        type: round.type,
        items: round.items.map((i) => ({
          // The line's DB OrderItem id — the KDS advances status against this.
          id: String(i.lineKey ?? i.id),
          // Fold modifiers into the name so the kitchen sees them on the ticket.
          name: i.name + modifierSummary(i.modifiers),
          qty: i.qty,
        })),
      })
      .catch(() => {
        // Kitchen relay unreachable. Surface it instead of failing silently —
        // a silent failure looks like "nothing happened". Start the relay with
        // `pnpm dev` (it runs on :4001).
        showToast("Kitchen offline — couldn't send to KDS", "wifi_off");
      });
  }, [tableNumber, showToast]);

  // Persist a round to the platform API so it shows up in the restaurant-admin
  // floor/sessions. Fire-and-forget: the relay still drives the live KDS board.
  const sendRoundToApi = useCallback((round) => {
    const oid = orderIdRef.current;
    if (!oid) return;
    api.orders
      .addRound(oid, {
        // Pin the DB round + line ids to the same ids used locally + on the KDS
        // ticket, so kitchen status advances reach the right OrderItem.
        id: String(round.id),
        type: round.type,
        items: round.items.map((i) => ({
          id: String(i.lineKey),
          menuItemId: String(i.id),
          name: i.name,
          // Base unit price; the server re-prices each modifier from the DB.
          unitPrice: i.basePriceCents ?? i.priceCents ?? Math.round((i.price ?? 0) * 100),
          qty: i.qty,
          modifiers: (i.modifiers ?? []).map((m) => ({
            optionId: m.optionId,
            groupName: m.groupName,
            name: m.name,
            priceDelta: m.priceCents,
            textValue: m.textValue,
          })),
        })),
      })
      .catch(() => {});
  }, [api]);

  // Bring it — instant single item to kitchen. Guarded on a live orderId so a
  // refreshed/settled client can't fire a phantom ticket at the KDS.
  const bringIt = useCallback((item, qty = 1, modifiers = []) => {
    if (sessionEndedRef.current || !orderIdRef.current) return;
    const round = {
      id: newId("rnd"),
      type: "instant",
      timestamp: new Date(),
      items: [makeLine(item, qty, modifiers)],
    };
    setRounds((prev) => [round, ...prev]);
    publishRound(round);
    sendRoundToApi(round);
    showToast(`${item.name} is on its way!`, "local_shipping");
    return round.id;
  }, [showToast, publishRound, sendRoundToApi]);

  // Bring these — send full My Order queue to kitchen
  const bringThese = useCallback(() => {
    if (sessionEndedRef.current || !orderIdRef.current || myOrder.length === 0) return;
    const round = {
      id: newId("rnd"),
      type: "bundled",
      timestamp: new Date(),
      items: myOrder.map((i) => ({ ...i, status: "placed" })),
    };
    setRounds((prev) => [round, ...prev]);
    publishRound(round);
    sendRoundToApi(round);
    setMyOrder([]);
    showToast("Order sent to kitchen!", "restaurant");
    return round.id;
  }, [myOrder, showToast, publishRound, sendRoundToApi]);

  // Reflect kitchen status back onto this session's rounds (live from the KDS).
  // The KDS splits each round into one ticket per line item (every dish has its
  // own cook timeline), so a ticket id is `roundId::lineKey`. We parse it and
  // update ONLY the matching line, so items in the same bulk order can show
  // different statuses. A bare id (no "::", legacy) updates every line in the
  // round.
  useEffect(() => {
    const parse = (ticketId) => {
      const id = String(ticketId);
      const sep = id.indexOf("::");
      return sep === -1
        ? { roundId: id, lineKey: null }
        : { roundId: id.slice(0, sep), lineKey: id.slice(sep + 2) };
    };
    const setItemStatus = (ticketId, status) => {
      const { roundId, lineKey } = parse(ticketId);
      setRounds((prev) =>
        prev.map((r) =>
          String(r.id) === roundId
            ? {
                ...r,
                items: r.items.map((i) =>
                  lineKey === null || String(i.lineKey ?? i.id) === lineKey
                    ? // A cancelled item is terminal (set from the DB) — never let
                      // a late relay frame (e.g. ticket-removed → "served") flip it.
                      i.status === "cancelled"
                      ? i
                      : { ...i, status }
                    : i,
                ),
              }
            : r,
        ),
      );
    };
    return kitchen.subscribe((event) => {
      // Once the session is terminal (e.g. staff cancelled), ignore late relay
      // frames so a stray "preparing"/"ready" can't repaint a dead order.
      if (sessionEndedRef.current) return;
      if (event.type === "snapshot") {
        // Sent on every (re)connect. If the phone's tab was backgrounded and
        // dropped the stream, it missed live updates — reconcile each line's
        // status from the snapshot so a served/ready item isn't stuck on
        // "placed". Lines whose ticket has aged out of the snapshot are left
        // untouched (avoids falsely marking them served on a relay restart).
        for (const ticket of event.tickets) {
          setItemStatus(ticket.id, stageToStatus(ticket.stage));
        }
      } else if (event.type === "ticket-updated") {
        setItemStatus(event.ticket.id, stageToStatus(event.ticket.stage));
      } else if (event.type === "ticket-removed") {
        setItemStatus(event.ticketId, "served");
      }
    });
  }, []);

  const myOrderTotal = myOrder.reduce((s, i) => s + i.price * i.qty, 0);
  const myOrderCount = myOrder.reduce((s, i) => s + i.qty, 0);

  // Subtotal excludes cancelled lines, mirroring the server's payment math
  // (orders.service.capturePayment) so the bill shown matches what's captured.
  const billTotal = rounds.reduce(
    (s, r) =>
      s +
      r.items
        .filter((i) => i.status !== "cancelled")
        .reduce((rs, i) => rs + i.price * i.qty, 0),
    0,
  );
  // The tenant's real tax rate (fraction, e.g. 0.1) — drives the bill totals so
  // the phone shows the same tax the server charges (not a hardcoded 10%).
  const taxRate = tenant?.taxRate ?? 0;

  const [billRequested, setBillRequested] = useState(
    Boolean(resumeOrder && (resumeOrder.status === "billed" || resumeOrder.billRequestedAt)),
  );
  const [sessionEnded, setSessionEnded] = useState(false);
  // True when the session ended because STAFF cancelled it (vs. a normal
  // settle) — drives a distinct "session cancelled" terminal screen.
  const [sessionCancelled, setSessionCancelled] = useState(false);
  sessionEndedRef.current = sessionEnded;
  // Cash: the guest is told to pay at the counter; the session stays alive until
  // staff capture the cash in restaurant-admin (we poll the Order until paid).
  const [awaitingCash, setAwaitingCash] = useState(false);
  // How the bill was settled ("card" | "cash") — drives the thank-you message.
  const [paidMethod, setPaidMethod] = useState(null);

  // Terminal helper — clear the live order and lock the device out of ordering.
  // `cancelled` distinguishes a staff cancellation from a normal settle.
  const endSession = useCallback((cancelled) => {
    setSessionCancelled(Boolean(cancelled));
    setSessionEnded(true);
    setSessionStarted(false);
    setAwaitingCash(false);
    orderIdRef.current = null;
    markSessionEnded();
  }, []);

  // Ask staff for the bill — persists to the API so restaurant-admin flips the
  // table to "Awaiting Bill". Optimistic locally even if the API is unreachable.
  const requestBill = useCallback(async () => {
    setBillRequested(true);
    const oid = orderIdRef.current;
    if (oid) await api.orders.requestBill(oid);
  }, [api]);

  // Settle the bill.
  //  - card ("online"): captured here immediately → session ends now.
  //  - cash: NOT captured by the guest. Staff take the cash and capture it in
  //    the admin; we enter "awaiting cash" and the poll below ends the session
  //    once the Order is marked paid.
  // Throws on API failure so the caller can keep the guest on the bill screen.
  const payBill = useCallback(async (method) => {
    if (method === "cash") {
      setPaidMethod("cash");
      setAwaitingCash(true);
      return true;
    }
    const oid = orderIdRef.current;
    if (oid) await api.orders.capturePayment(oid, { method });
    setPaidMethod("card");
    endSession(false); // settled — lock this device out until a fresh QR scan
    return true;
  }, [api, endSession]);

  // Real-time: subscribe to the live order stream (SSE) so STAFF + KDS actions
  // reach the phone instantly — staff cancel → terminal screen, item add/cancel
  // and KDS status reflect on the bill/status, cash capture ends the session.
  // The polls below stay as a low-frequency self-heal fallback (SSE can drop
  // when a mobile tab is backgrounded).
  useEffect(() => {
    if (!sessionStarted || sessionEnded) return;
    const unsub = api.orders.stream((event) => {
      const oid = orderIdRef.current;
      if (!oid) return;
      const order =
        event.type === "snapshot"
          ? event.orders.find((o) => o.id === oid)
          : event.orderId === oid
            ? event.order
            : null;
      if (!order) return;
      // Terminal: staff captured cash/card (paid) or cancelled the session
      // (closed) → drive the right terminal screen.
      if (order.status === "paid") return endSession(false);
      if (order.status === "closed") return endSession(true);
      // Still live (open/billed): reflect staff/KDS edits onto the bill + status.
      setBillRequested(
        order.status === "billed" || Boolean(order.billRequestedAt),
      );
      setRounds(ordersToLocalRounds(order));
    });
    return unsub;
  }, [sessionStarted, sessionEnded, api, endSession]);

  // While awaiting cash, poll the Order until staff capture the payment. The
  // moment its status flips to "paid" (or it's closed/cancelled), end the
  // session. Fallback behind the SSE stream above (covers a dropped stream).
  useEffect(() => {
    if (!awaitingCash) return;
    const oid = orderIdRef.current;
    if (!oid) return;
    let stopped = false;
    const check = async () => {
      try {
        const order = await api.orders.get(oid);
        if (stopped) return;
        // Staff captured the cash → "paid" (normal settle). Staff cancelled the
        // session instead → "closed" (no payment) → cancelled terminal screen.
        if (order.status === "paid") endSession(false);
        else if (order.status === "closed") endSession(true);
      } catch {
        // Transient API error — keep waiting.
      }
    };
    check();
    const id = setInterval(check, 12000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [awaitingCash, api, endSession]);

  // While a live session is running (before the guest settles), watch the
  // backing Order so STAFF actions reach the phone: if staff CANCEL it
  // (status "closed") or it's deleted (404), end the session as cancelled — the
  // guest can no longer pay a dead bill. A staff cash-capture (→ "paid") ends it
  // normally. Fallback behind the SSE stream (handles a 404/deleted order and a
  // dropped stream); the cash flow has its own poll above, so skip while awaiting cash.
  useEffect(() => {
    if (!sessionStarted || sessionEnded || awaitingCash) return;
    const oid = orderIdRef.current;
    if (!oid) return;
    let stopped = false;
    const check = async () => {
      try {
        const order = await api.orders.get(oid);
        if (stopped) return;
        if (order.status === "closed") endSession(true);
        else if (order.status === "paid") endSession(false);
      } catch (e) {
        // Order gone (deleted) → treat as cancelled. Other errors: keep waiting.
        if (!stopped && e?.status === 404) endSession(true);
      }
    };
    const id = setInterval(check, 15000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [sessionStarted, sessionEnded, awaitingCash, api, endSession]);

  return (
    <SessionContext.Provider value={{
      tableNumber, sessionStarted, startSession, sessionStartTime,
      myOrder, addToOrder, updateOrderQty, removeFromOrder,
      myOrderTotal, myOrderCount,
      rounds, bringIt, bringThese,
      billTotal, taxRate, billRequested, requestBill, payBill,
      sessionEnded, sessionCancelled, awaitingCash, paidMethod,
      toast, showToast,
      sheetItem, setSheetItem,
    }}>
      {children}
    </SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);
