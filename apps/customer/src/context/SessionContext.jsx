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

/** Map a resumed domain Order's rounds onto the local UI round shape (cents →
 *  dollars; keep priceCents + id for re-sends). Lets a refresh rehydrate the
 *  bill/status screens without re-creating anything. */
function ordersToLocalRounds(order) {
  return order.rounds
    .map((r) => ({
      id: r.id,
      type: r.type,
      timestamp: new Date(r.createdAt),
      items: r.items.map((i) => ({
        id: i.menuItemId ?? i.id,
        name: i.name,
        qty: i.qty,
        price: i.unitPrice / 100,
        priceCents: i.unitPrice,
        status: i.status,
      })),
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

  // Add to My Order queue
  const addToOrder = useCallback((item, qty = 1) => {
    // Requires a live session — no orderId means nothing to attach to.
    if (sessionEndedRef.current || !orderIdRef.current) return;
    setMyOrder((prev) => {
      const existing = prev.find((x) => x.id === item.id);
      if (existing) {
        return prev.map((x) => x.id === item.id ? { ...x, qty: x.qty + qty } : x);
      }
      return [...prev, { ...item, qty }];
    });
    showToast(`Added to My Order`, "add_shopping_cart");
  }, [showToast]);

  const updateOrderQty = useCallback((id, delta) => {
    setMyOrder((prev) =>
      prev.map((x) => x.id === id ? { ...x, qty: Math.max(1, x.qty + delta) } : x)
    );
  }, []);

  const removeFromOrder = useCallback((id) => {
    setMyOrder((prev) => prev.filter((x) => x.id !== id));
  }, []);

  // Push a round to the kitchen (KDS). Fire-and-forget: if the relay is down,
  // the guest app still works locally. The round id is shared so the KDS can
  // reflect status changes back to this session.
  const publishRound = useCallback((round) => {
    kitchen
      .publishRound({
        id: String(round.id),
        tableLabel: `Table ${tableNumber}`,
        type: round.type,
        items: round.items.map((i) => ({
          id: String(i.id),
          name: i.name,
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
        type: round.type,
        items: round.items.map((i) => ({
          menuItemId: String(i.id),
          name: i.name,
          unitPrice: i.priceCents ?? Math.round((i.price ?? 0) * 100),
          qty: i.qty,
        })),
      })
      .catch(() => {});
  }, [api]);

  // Bring it — instant single item to kitchen. Guarded on a live orderId so a
  // refreshed/settled client can't fire a phantom ticket at the KDS.
  const bringIt = useCallback((item, qty = 1) => {
    if (sessionEndedRef.current || !orderIdRef.current) return;
    const round = {
      id: Date.now(),
      type: "instant",
      timestamp: new Date(),
      items: [{ ...item, qty, status: "placed" }],
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
      id: Date.now(),
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
  useEffect(() => {
    return kitchen.subscribe((event) => {
      if (event.type === "ticket-updated") {
        const { id, stage } = event.ticket;
        setRounds((prev) =>
          prev.map((r) =>
            String(r.id) === id
              ? { ...r, items: r.items.map((i) => ({ ...i, status: stageToStatus(stage) })) }
              : r,
          ),
        );
      } else if (event.type === "ticket-removed") {
        setRounds((prev) =>
          prev.map((r) =>
            String(r.id) === event.ticketId
              ? { ...r, items: r.items.map((i) => ({ ...i, status: "served" })) }
              : r,
          ),
        );
      }
    });
  }, []);

  const myOrderTotal = myOrder.reduce((s, i) => s + i.price * i.qty, 0);
  const myOrderCount = myOrder.reduce((s, i) => s + i.qty, 0);

  const billTotal = rounds.reduce(
    (s, r) => s + r.items.reduce((rs, i) => rs + i.price * i.qty, 0),
    0
  );

  const [billRequested, setBillRequested] = useState(
    Boolean(resumeOrder && (resumeOrder.status === "billed" || resumeOrder.billRequestedAt)),
  );
  const [sessionEnded, setSessionEnded] = useState(false);
  sessionEndedRef.current = sessionEnded;
  // Cash: the guest is told to pay at the counter; the session stays alive until
  // staff capture the cash in restaurant-admin (we poll the Order until paid).
  const [awaitingCash, setAwaitingCash] = useState(false);
  // How the bill was settled ("card" | "cash") — drives the thank-you message.
  const [paidMethod, setPaidMethod] = useState(null);

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
    setSessionEnded(true);
    setSessionStarted(false);
    orderIdRef.current = null;
    markSessionEnded(); // lock this device out of ordering until a fresh QR scan
    return true;
  }, [api]);

  // While awaiting cash, poll the Order until staff capture the payment. The
  // moment its status flips to "paid" (or it's closed/cancelled), end the session.
  useEffect(() => {
    if (!awaitingCash) return;
    const oid = orderIdRef.current;
    if (!oid) return;
    let stopped = false;
    const check = async () => {
      try {
        const order = await api.orders.get(oid);
        if (stopped) return;
        if (order.status === "paid" || order.status === "closed") {
          // Set the terminal flag first so we never flash the ordering screen
          // between clearing awaitingCash and marking the session ended.
          setSessionEnded(true);
          setSessionStarted(false);
          setAwaitingCash(false);
          orderIdRef.current = null;
          markSessionEnded(); // lock this device out until a fresh QR scan
        }
      } catch {
        // Transient API error — keep waiting.
      }
    };
    check();
    const id = setInterval(check, 4000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [awaitingCash, api]);

  return (
    <SessionContext.Provider value={{
      tableNumber, sessionStarted, startSession, sessionStartTime,
      myOrder, addToOrder, updateOrderQty, removeFromOrder,
      myOrderTotal, myOrderCount,
      rounds, bringIt, bringThese,
      billTotal, billRequested, requestBill, payBill, sessionEnded, awaitingCash, paidMethod,
      toast, showToast,
      sheetItem, setSheetItem,
    }}>
      {children}
    </SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);
