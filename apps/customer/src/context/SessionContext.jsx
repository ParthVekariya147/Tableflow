import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { kitchen } from "../kitchen";

const SessionContext = createContext(null);

/** Map a kitchen stage onto the guest's coarser status pills. */
function stageToStatus(stage) {
  if (stage === "served") return "served";
  if (stage === "preparing" || stage === "ready") return "preparing";
  return "placed";
}

export function SessionProvider({ children }) {
  const [tableNumber] = useState(7);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState(null);

  // My Order (holding area — not yet sent)
  const [myOrder, setMyOrder] = useState([]);

  // All rounds sent to kitchen this session
  const [rounds, setRounds] = useState([]);

  // Toast notification
  const [toast, setToast] = useState(null);

  // Item detail sheet
  const [sheetItem, setSheetItem] = useState(null);

  const startSession = useCallback(() => {
    setSessionStarted(true);
    setSessionStartTime(new Date());
  }, []);

  const showToast = useCallback((msg, icon = "check_circle") => {
    setToast({ msg, icon, id: Date.now() });
    setTimeout(() => setToast(null), 2800);
  }, []);

  // Add to My Order queue
  const addToOrder = useCallback((item, qty = 1) => {
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
        /* kitchen relay offline — order stays local */
      });
  }, [tableNumber]);

  // Bring it — instant single item to kitchen
  const bringIt = useCallback((item, qty = 1) => {
    const round = {
      id: Date.now(),
      type: "instant",
      timestamp: new Date(),
      items: [{ ...item, qty, status: "placed" }],
    };
    setRounds((prev) => [round, ...prev]);
    publishRound(round);
    showToast(`${item.name} is on its way!`, "local_shipping");
    return round.id;
  }, [showToast, publishRound]);

  // Bring these — send full My Order queue to kitchen
  const bringThese = useCallback(() => {
    if (myOrder.length === 0) return;
    const round = {
      id: Date.now(),
      type: "bundled",
      timestamp: new Date(),
      items: myOrder.map((i) => ({ ...i, status: "placed" })),
    };
    setRounds((prev) => [round, ...prev]);
    publishRound(round);
    setMyOrder([]);
    showToast("Order sent to kitchen!", "restaurant");
    return round.id;
  }, [myOrder, showToast, publishRound]);

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

  // Simulate status progression (for prototype interactivity)
  const advanceStatus = useCallback((roundId, itemId) => {
    const order = ["placed", "preparing", "served"];
    setRounds((prev) =>
      prev.map((r) => {
        if (r.id !== roundId) return r;
        return {
          ...r,
          items: r.items.map((item) => {
            if (item.id !== itemId) return item;
            const next = order[order.indexOf(item.status) + 1];
            return next ? { ...item, status: next } : item;
          }),
        };
      })
    );
  }, []);

  const myOrderTotal = myOrder.reduce((s, i) => s + i.price * i.qty, 0);
  const myOrderCount = myOrder.reduce((s, i) => s + i.qty, 0);

  const billTotal = rounds.reduce(
    (s, r) => s + r.items.reduce((rs, i) => rs + i.price * i.qty, 0),
    0
  );

  const [billRequested, setBillRequested] = useState(false);

  return (
    <SessionContext.Provider value={{
      tableNumber, sessionStarted, startSession, sessionStartTime,
      myOrder, addToOrder, updateOrderQty, removeFromOrder,
      myOrderTotal, myOrderCount,
      rounds, bringIt, bringThese, advanceStatus,
      billTotal, billRequested, setBillRequested,
      toast, showToast,
      sheetItem, setSheetItem,
    }}>
      {children}
    </SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);
