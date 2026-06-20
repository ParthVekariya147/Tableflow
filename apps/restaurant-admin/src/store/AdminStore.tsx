import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type {
  AdminState,
  MenuItem,
  PaymentMethod,
  Round,
  Table,
  TableStatus,
} from "../data/types";
import { makeQrToken, makeSeedState, uid } from "../data/seed";

/**
 * Single in-memory store for the admin panel. Every mutation (86 toggle, price
 * edit, add/remove order items, take payment, free a table…) flows through this
 * reducer, so changes — and take-backs — show up live across all screens. No
 * backend; reload resets to the seed.
 */

type Action =
  | { type: "TOGGLE_AVAILABILITY"; itemId: string }
  | { type: "UPDATE_ITEM"; itemId: string; patch: Partial<MenuItem> }
  | { type: "ADD_ITEM"; item: MenuItem }
  | { type: "DELETE_ITEM"; itemId: string }
  | { type: "ADD_CATEGORY"; name: string }
  | { type: "OPEN_SESSION"; tableId: string }
  | { type: "REGEN_QR"; tableId: string }
  | { type: "UPDATE_TABLE"; tableId: string; patch: Partial<Table> }
  | { type: "ADD_ORDER_ITEM"; tableId: string; menuItemId: string }
  | { type: "CHANGE_QTY"; tableId: string; roundId: string; itemId: string; delta: number }
  | { type: "CANCEL_ITEM"; tableId: string; roundId: string; itemId: string }
  | { type: "CANCEL_ORDER"; tableId: string }
  | { type: "COMPLETE_PAYMENT"; tableId: string; method: PaymentMethod; amountCents: number };

function mapTable(state: AdminState, tableId: string, fn: (t: Table) => Table): Table[] {
  return state.tables.map((t) => (t.id === tableId ? fn(t) : t));
}

/** A table with an active session moves to "ordering" while items are placed. */
function statusForSession(session: Table["session"], fallback: TableStatus): TableStatus {
  if (!session || session.rounds.length === 0) return fallback;
  const allServed = session.rounds
    .flatMap((r) => r.items)
    .filter((i) => i.status !== "cancelled")
    .every((i) => i.status === "served");
  return allServed ? "seated" : "ordering";
}

function reducer(state: AdminState, action: Action): AdminState {
  switch (action.type) {
    case "TOGGLE_AVAILABILITY":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.itemId ? { ...i, available: !i.available } : i,
        ),
      };

    case "UPDATE_ITEM":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.itemId ? { ...i, ...action.patch } : i,
        ),
      };

    case "ADD_ITEM":
      return { ...state, items: [...state.items, action.item] };

    case "DELETE_ITEM":
      return { ...state, items: state.items.filter((i) => i.id !== action.itemId) };

    case "ADD_CATEGORY":
      return {
        ...state,
        categories: [...state.categories, { id: uid("cat"), name: action.name }],
      };

    case "OPEN_SESSION":
      return {
        ...state,
        tables: mapTable(state, action.tableId, (t) => ({
          ...t,
          status: "seated",
          session: { openedAt: Date.now(), rounds: [] },
        })),
      };

    case "REGEN_QR":
      return {
        ...state,
        tables: mapTable(state, action.tableId, (t) => ({ ...t, qrToken: makeQrToken() })),
      };

    case "UPDATE_TABLE":
      return {
        ...state,
        tables: mapTable(state, action.tableId, (t) => ({ ...t, ...action.patch })),
      };

    case "ADD_ORDER_ITEM":
      return {
        ...state,
        tables: mapTable(state, action.tableId, (t) => {
          const menuItem = state.items.find((i) => i.id === action.menuItemId);
          if (!menuItem) return t;
          const session = t.session ?? { openedAt: Date.now(), rounds: [] };
          const rounds = [...session.rounds];
          // Append to the newest still-open (not all-served) round, else new round.
          let target = rounds[rounds.length - 1];
          const isOpen =
            target && target.items.some((i) => i.status === "placed" || i.status === "preparing");
          if (!target || !isOpen) {
            target = { id: uid("rnd"), type: "instant", placedAt: Date.now(), items: [] };
            rounds.push(target);
          }
          const existing = target.items.find(
            (i) => i.menuItemId === menuItem.id && i.status === "placed",
          );
          const newItems = existing
            ? target.items.map((i) => (i === existing ? { ...i, qty: i.qty + 1 } : i))
            : [
                ...target.items,
                {
                  id: uid("oi"),
                  menuItemId: menuItem.id,
                  name: menuItem.name,
                  priceCents: menuItem.priceCents,
                  qty: 1,
                  status: "placed" as const,
                },
              ];
          rounds[rounds.length - 1] = { ...target, items: newItems };
          const newSession = { ...session, rounds };
          return { ...t, session: newSession, status: statusForSession(newSession, t.status) };
        }),
      };

    case "CHANGE_QTY":
      return {
        ...state,
        tables: mapTable(state, action.tableId, (t) => {
          if (!t.session) return t;
          const rounds = t.session.rounds.map((r) =>
            r.id !== action.roundId
              ? r
              : {
                  ...r,
                  items: r.items
                    .map((i) =>
                      i.id === action.itemId
                        ? { ...i, qty: Math.max(0, i.qty + action.delta) }
                        : i,
                    )
                    .filter((i) => i.qty > 0),
                },
          );
          return { ...t, session: { ...t.session, rounds } };
        }),
      };

    case "CANCEL_ITEM":
      return {
        ...state,
        tables: mapTable(state, action.tableId, (t) => {
          if (!t.session) return t;
          const rounds = t.session.rounds.map((r) =>
            r.id !== action.roundId
              ? r
              : {
                  ...r,
                  items: r.items.map((i) =>
                    i.id === action.itemId ? { ...i, status: "cancelled" as const } : i,
                  ),
                },
          );
          const session = { ...t.session, rounds };
          return { ...t, session, status: statusForSession(session, t.status) };
        }),
      };

    case "CANCEL_ORDER":
      return {
        ...state,
        tables: mapTable(state, action.tableId, (t) => ({
          ...t,
          status: "free",
          session: undefined,
        })),
      };

    case "COMPLETE_PAYMENT": {
      const table = state.tables.find((t) => t.id === action.tableId);
      const sale = {
        id: uid("sale"),
        tableLabel: table?.label ?? "—",
        totalCents: action.amountCents,
        method: action.method,
        at: Date.now(),
      };
      return {
        ...state,
        sales: [sale, ...state.sales],
        tables: mapTable(state, action.tableId, (t) => ({
          ...t,
          status: "free",
          session: undefined,
        })),
      };
    }

    default:
      return state;
  }
}

interface AdminContextValue {
  state: AdminState;
  dispatch: React.Dispatch<Action>;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, makeSeedState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within AdminStoreProvider");
  return ctx;
}

// ── Derived selectors ────────────────────────────────────────────────────

/** Subtotal in cents for a session's non-cancelled items. */
export function sessionSubtotal(rounds: Round[]): number {
  return rounds
    .flatMap((r) => r.items)
    .filter((i) => i.status !== "cancelled")
    .reduce((sum, i) => sum + i.priceCents * i.qty, 0);
}

export function sessionItemCount(rounds: Round[]): number {
  return rounds
    .flatMap((r) => r.items)
    .filter((i) => i.status !== "cancelled")
    .reduce((sum, i) => sum + i.qty, 0);
}

export interface BillTotals {
  subtotal: number;
  tax: number;
  total: number;
  count: number;
}

export function billTotals(rounds: Round[], taxRate: number): BillTotals {
  const subtotal = sessionSubtotal(rounds);
  const tax = Math.round(subtotal * taxRate);
  return { subtotal, tax, total: subtotal + tax, count: sessionItemCount(rounds) };
}
