import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ApiError,
  createApiClient,
  type OrderStreamEvent,
} from "@amber/api-client";
import type {
  Menu as DomainMenu,
  MenuItem as DomainMenuItem,
  MenuCategory as DomainMenuCategory,
  FloorTable,
  Sale as DomainSale,
  Order as DomainOrder,
  Table as DomainTable,
} from "@amber/domain";
import { withRetry } from "../lib/retry";
import { settlePayment } from "../lib/payment";
import type {
  AdminState,
  MenuItem,
  ModifierGroup,
  OrderItem,
  OrderItemModifier,
  PaymentMethod,
  Round,
  Table,
  TableSession,
} from "../data/types";
import { defaultTenant } from "../tenant/defaultTenant";
import { useAuth } from "../context/AuthContext";
import { getStoredToken } from "../lib/auth-token";
import { getStoredTenantSlug } from "../lib/auth-tenant";
import { fetchCurrentTenantCoalesced } from "../lib/tenant-fetch";
import { kdsClient } from "../kds/kdsClient";
import { createMoneyFormatter, currencySymbolFor } from "../lib/money";
import { AppShellSkeleton } from "../components/Skeleton";

/** View-model modifier groups (priceCents) → api-client input (priceDelta). */
function toModifierGroupsInput(groups: ModifierGroup[]) {
  return groups.map((g, gi) => ({
    name: g.name,
    inputType: g.inputType,
    required: g.required,
    minSelect: g.minSelect,
    maxSelect: g.maxSelect ?? null,
    maxLength: g.maxLength ?? null,
    placeholder: g.placeholder,
    sortOrder: gi,
    options: (g.inputType === "text" ? [] : g.options).map((o, oi) => ({
      name: o.name,
      priceDelta: o.priceCents,
      available: o.available ?? true,
      sortOrder: oi,
    })),
  }));
}

/**
 * API-backed store for the admin panel. The provider loads the tenant's menu,
 * floor (tables + live sessions) and sales from @amber/api-client, maps them to
 * the local AdminState the pages already consume, and exposes an async
 * `dispatch` that translates each UI action into the matching API call and
 * applies the returned object (or the SSE echo) directly to state — refetches
 * are reserved for menu edits (1 call), the initial load, and self-heal
 * fallbacks. Pages and selectors are unchanged.
 */

const DEFAULT_ICON = "restaurant";
const DEFAULT_SWATCH = "from-stone-300 to-amber-500";

type Action =
  | { type: "TOGGLE_AVAILABILITY"; itemId: string }
  | { type: "UPDATE_ITEM"; itemId: string; patch: Partial<MenuItem> }
  | { type: "ADD_ITEM"; item: MenuItem }
  | { type: "DELETE_ITEM"; itemId: string }
  | { type: "ADD_CATEGORY"; name: string }
  | { type: "UPDATE_CATEGORY"; categoryId: string; name: string }
  | { type: "DELETE_CATEGORY"; categoryId: string }
  | { type: "ADD_TABLE"; label: string; seats?: number; room?: string }
  | { type: "OPEN_SESSION"; tableId: string; customerName?: string; customerPhone?: string }
  | { type: "REGEN_QR"; tableId: string }
  | { type: "UPDATE_TABLE"; tableId: string; patch: Partial<Table> }
  | { type: "DELETE_TABLE"; tableId: string }
  | {
      type: "ADD_ORDER_ITEMS";
      tableId: string;
      items: Array<{
        menuItemId: string;
        qty: number;
        notes?: string;
        modifiers?: OrderItemModifier[];
      }>;
    }
  | { type: "CHANGE_QTY"; tableId: string; roundId: string; itemId: string; delta: number }
  | { type: "CANCEL_ITEM"; tableId: string; roundId: string; itemId: string }
  | { type: "CANCEL_ORDER"; tableId: string }
  | {
      type: "COMPLETE_PAYMENT";
      tableId: string;
      method: PaymentMethod;
      amountCents: number;
      tenderedCents?: number;
    };

const EMPTY_STATE: AdminState = {
  taxRate: defaultTenant.taxRate ?? 0,
  currency: defaultTenant.currency,
  gstNumber: undefined,
  upiId: undefined,
  upiMobile: undefined,
  tenantName: undefined,
  categories: [],
  items: [],
  tables: [],
  sales: [],
};

// ── domain → local AdminState mappers ─────────────────────────────────────

function mapRound(r: DomainOrder["rounds"][number]): Round {
  return {
    id: r.id,
    type: r.type,
    placedAt: Date.parse(r.createdAt),
    items: r.items.map((i) => ({
      id: i.id,
      menuItemId: i.menuItemId ?? "",
      name: i.name,
      priceCents: i.unitPrice,
      qty: i.qty,
      note: i.notes,
      status: i.status,
      modifiers: i.modifiers.map((m) => ({
        id: m.id,
        optionId: m.optionId,
        groupName: m.groupName,
        name: m.name,
        priceDelta: m.priceDelta,
        textValue: m.textValue,
      })),
    })),
  };
}

function mapSession(order: DomainOrder): TableSession {
  return {
    orderId: order.id,
    openedAt: Date.parse(order.createdAt),
    rounds: order.rounds.map(mapRound),
    billRequestedAt: order.billRequestedAt ? Date.parse(order.billRequestedAt) : undefined,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
  };
}

function mapTable(ft: FloorTable): Table {
  return {
    id: ft.id,
    label: ft.label,
    room: ft.room ?? "",
    seats: ft.seats ?? 0,
    status: ft.status,
    qrToken: ft.qrToken,
    session: ft.activeOrder ? mapSession(ft.activeOrder) : undefined,
    isCounter: ft.isCounter,
  };
}

/** One domain category → the view-model shape. */
function mapDomainCategory(c: DomainMenuCategory): AdminState["categories"][number] {
  return { id: c.id, name: c.name };
}

/** One domain item → the view-model shape. `categories` resolves the item's
 *  category NAME (the domain shape) to the view-model's `categoryId`. */
function mapDomainItem(
  i: DomainMenuItem,
  categories: AdminState["categories"],
): MenuItem {
  return {
    id: i.id,
    categoryId: categories.find((c) => c.name === i.category)?.id ?? "",
    name: i.name,
    description: i.description,
    priceCents: i.price,
    available: i.available,
    dietary: i.dietary ?? null,
    jain: i.jain ?? false,
    icon: i.icon ?? DEFAULT_ICON,
    swatch: i.swatch ?? DEFAULT_SWATCH,
    imageUrl: i.imageUrl,
    modifierGroups: i.modifierGroups.map((g) => ({
      id: g.id,
      name: g.name,
      inputType: g.inputType,
      required: g.required,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      maxLength: g.maxLength,
      placeholder: g.placeholder,
      options: g.options.map((o) => ({
        id: o.id,
        name: o.name,
        priceCents: o.priceDelta,
        available: o.available,
      })),
    })),
  };
}

/** Menu → the categories/items slice of AdminState. */
function mapMenuSlice(menu: DomainMenu): Pick<AdminState, "categories" | "items"> {
  const categories = menu.categories.map(mapDomainCategory);
  return {
    categories,
    items: menu.items.map((i) => mapDomainItem(i, categories)),
  };
}

/** Sales feed → the sales slice of AdminState. */
function mapSales(sales: DomainSale[]): AdminState["sales"] {
  return sales.map((s) => ({
    id: s.id,
    tableLabel: s.tableLabel,
    totalCents: s.total,
    method: s.method,
    at: Date.parse(s.createdAt),
  }));
}

// ── push-driven floor updates ──────────────────────────────────────────────
// The SSE stream delivers the COMPLETE fresh Order with every event, so the
// floor can be updated in place from the push instead of refetching
// `tables.list` + `orders.sales` on each event (2 API round trips per event,
// per open device — the old pattern, and the main source of perceived lag).

/** Orders that still occupy a table. Mirrors the server's LIVE_STATUSES. */
const LIVE_ORDER_STATUSES = new Set<DomainOrder["status"]>(["open", "billed"]);

/** Client mirror of the server's floor-status derivation (tables.mapper.ts
 *  `deriveStatus`) — keep the two in sync. */
function deriveTableStatus(order: DomainOrder): Table["status"] {
  if (order.status === "billed" || order.billRequestedAt) return "bill";
  const hasItems = order.rounds.some((r) =>
    r.items.some((i) => i.status !== "cancelled"),
  );
  return hasItems ? "ordering" : "seated";
}

/** Apply one pushed/returned Order to the floor: live → (re)attach as the
 *  table's session; paid/closed → free the table (only if it's still THIS
 *  order occupying it, so a stale closed event can't kill a newer session). */
function applyOrderToTables(tables: Table[], order: DomainOrder): Table[] {
  return tables.map((t) => {
    if (t.id !== order.tableId) return t;
    if (!LIVE_ORDER_STATUSES.has(order.status)) {
      if (t.session && t.session.orderId !== order.id) return t;
      return { ...t, session: undefined, status: "free" };
    }
    return { ...t, session: mapSession(order), status: deriveTableStatus(order) };
  });
}

/** Rebuild every table's session from a stream snapshot of the live floor. */
function applySnapshotToTables(tables: Table[], orders: DomainOrder[]): Table[] {
  // Newest live order per table (snapshot orders arrive newest-first).
  const byTable = new Map<string, DomainOrder>();
  for (const o of orders) if (!byTable.has(o.tableId)) byTable.set(o.tableId, o);
  return tables.map((t) => {
    const order = byTable.get(t.id);
    if (!order) {
      return t.session || t.status !== "free"
        ? { ...t, session: undefined, status: "free" }
        : t;
    }
    return { ...t, session: mapSession(order), status: deriveTableStatus(order) };
  });
}

/** Domain Table (a tables.* mutation response) → view Table, preserving the
 *  live-session fields the domain shape doesn't carry. */
function mergeDomainTable(existing: Table | undefined, t: DomainTable): Table {
  return {
    id: t.id,
    label: t.label,
    room: t.room ?? "",
    seats: t.seats ?? 0,
    status: existing?.status ?? "free",
    qrToken: t.qrToken,
    session: existing?.session,
    isCounter: t.isCounter,
  };
}

/** An optimistic placeholder for an item being created (drives the crafting card). */
export interface PendingItem {
  tempId: string;
  categoryId: string;
  name: string;
}

interface AdminContextValue {
  state: AdminState;
  /** Resolves `true` if the mutation succeeded, `false` if it failed (after
   *  retries) — callers that need to know (e.g. "only close this modal on a
   *  successful save") can check it; existing fire-and-forget callers can
   *  keep ignoring it. */
  dispatch: (action: Action) => Promise<boolean>;
  /** Format integer cents in the tenant's currency (symbol/grouping derived). */
  money: (cents: number) => string;
  /** The tenant's bare currency symbol (e.g. "$", "₹") for input prefixes. */
  currencySymbol: string;
  /** Force an immediate re-sync from the API (used on session-page open). */
  refresh: () => Promise<void>;
  /** Lighter re-sync: tables + sales only, skips menu/tenant (used where the
   *  menu can't have changed, e.g. Quick Sale's counter-table resolve). */
  refreshFloor: () => Promise<void>;
  /** Upload an item photo to storage; resolves to its public URL. */
  uploadImage: (file: File) => Promise<string>;
  /** Import a pasted photo link into our own storage; returns the stored URL. */
  importImage: (link: string) => Promise<string>;
  loading: boolean;
  /** True while any mutation (+ its refetch) is in flight — drives the top bar. */
  mutating: boolean;
  /** Items being created right now, shown as "crafting" skeletons in the grid. */
  pendingItems: PendingItem[];
  error: string | null;
  /**
   * Subscribe to the store's single `/orders/stream` connection instead of
   * opening a second one — the KDS board (mounted at `/kds` and `/kds/display`,
   * both inside this provider) taps this rather than calling
   * `api.orders.stream` itself, so an open KDS tab holds one connection, not two.
   */
  subscribeOrderEvents: (handler: (event: OrderStreamEvent) => void) => () => void;
}

const AdminContext = createContext<AdminContextValue | null>(null);

/**
 * A permission-gated list endpoint returns [] instead of throwing on a 403.
 * The call sites now check `can(...)` first and skip the request entirely for
 * a role that's known to lack the permission (e.g. Kitchen: kds.use only) —
 * this is the remaining defense-in-depth layer for the gap between "the
 * client's cached permission set" and "what the server actually enforces"
 * (e.g. a role edited mid-session). Either way, load must still finish and
 * set `loaded` for a lower-privilege role. Any other error still propagates
 * so real failures surface.
 */
function emptyOn403<T>(p: Promise<T[]>): Promise<T[]> {
  return p.catch((e) => {
    if (e instanceof ApiError && e.status === 403) return [];
    throw e;
  });
}

export function AdminStoreProvider({ children }: { children: ReactNode }) {
  // Scope every call to the *logged-in* tenant (read at call time) and carry the
  // bearer token — so the store follows whichever restaurant the user signed into.
  const api = useMemo(
    () =>
      createApiClient({
        baseUrl:
          (import.meta.env.VITE_API_URL as string | undefined) ??
          "http://localhost:3001",
        getTenantSlug: () => getStoredTenantSlug() ?? defaultTenant.slug,
        getToken: getStoredToken,
      }),
    [],
  );

  const { status, user, can } = useAuth();

  const [state, setState] = useState<AdminState>(EMPTY_STATE);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [mutateCount, setMutateCount] = useState(0);

  // Always-current snapshot so async actions read fresh data (no stale closure).
  const stateRef = useRef(state);
  stateRef.current = state;

  // Read live mutating status inside the poll loop without re-subscribing it.
  const mutatingRef = useRef(false);
  mutatingRef.current = mutateCount > 0;

  // Per-slice monotonic counters. Refetches can be triggered from independent
  // sources (the fallback poll, focus/visibilitychange, an explicit page-level
  // `refresh()` call) that can race — an EARLIER request resolving AFTER a
  // LATER write would silently revert state to stale data. Each refetch
  // captures its slice's number at start and only applies if nothing newer
  // wrote that slice since. "Newer" includes DIRECT writes (pushed SSE events
  // and mutation responses, which bump floorSeqRef via `applyTables`), not
  // just competing refetches — pushed data is by definition fresher than any
  // refetch already in flight.
  const floorSeqRef = useRef(0);
  const salesSeqRef = useRef(0);
  const menuSeqRef = useRef(0);

  // Apply a direct floor write (a pushed stream event or a mutation response).
  // This is the push-driven replacement for the old refetch-per-event pattern.
  const applyTables = useCallback((updater: (tables: Table[]) => Table[]) => {
    floorSeqRef.current++;
    setState((s) => ({ ...s, tables: updater(s.tables) }));
  }, []);

  // Apply a menu/category mutation's own response directly to state — the
  // push-driven replacement for the old "always refetch the whole menu after
  // every edit" pattern. Bumps menuSeqRef so an in-flight refreshMenu() from
  // an error self-heal can't clobber a newer direct apply.
  const applyMenu = useCallback(
    (
      updater: (
        s: Pick<AdminState, "categories" | "items">,
      ) => Pick<AdminState, "categories" | "items">,
    ) => {
      menuSeqRef.current++;
      setState((s) => ({ ...s, ...updater({ categories: s.categories, items: s.items }) }));
    },
    [],
  );

  // Full floor refetch — now only the initial load, the low-frequency fallback
  // poll, page-level `refreshFloor()` calls, and rare escape hatches (an event
  // for an unknown table, a failed mutation) hit this; live updates apply the
  // pushed order directly instead.
  const refreshFloor = useCallback(async () => {
    const floorSeq = ++floorSeqRef.current;
    const salesSeq = ++salesSeqRef.current;
    // Skip calls the signed-in role can't reach (e.g. Kitchen: kds.use only) —
    // emptyOn403 already tolerated the resulting 403, but firing it at all was
    // pointless network noise (and a console error) for a role that will never
    // have the permission.
    const [floor, sales] = await Promise.all([
      can("tables.manage") ? emptyOn403(api.tables.list()) : Promise.resolve([]),
      can("orders.history") ? emptyOn403(api.orders.sales()) : Promise.resolve([]),
    ]);
    // Apply each slice independently — either may have been superseded.
    setState((s) => ({
      ...s,
      ...(floorSeq === floorSeqRef.current ? { tables: floor.map(mapTable) } : {}),
      ...(salesSeq === salesSeqRef.current ? { sales: mapSales(sales) } : {}),
    }));
  }, [api, can]);

  // Sales only change when an order closes (payment capture), so a `closed`
  // stream event / local payment is the only live trigger for this — debounced
  // so the local COMPLETE_PAYMENT dispatch and its own stream echo coalesce
  // into ONE sales call instead of two.
  const salesTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const refreshSalesSoon = useCallback(() => {
    if (!can("orders.history")) return;
    if (salesTimerRef.current) return;
    salesTimerRef.current = setTimeout(() => {
      salesTimerRef.current = undefined;
      const seq = ++salesSeqRef.current;
      emptyOn403(api.orders.sales())
        .then((sales) => {
          if (seq !== salesSeqRef.current) return;
          setState((s) => ({ ...s, sales: mapSales(sales) }));
        })
        .catch(() => {}); // fallback poll self-heals
    }, 200);
  }, [api, can]);
  useEffect(() => () => clearTimeout(salesTimerRef.current), []);

  // Menu-only refetch — what a menu/category mutation needs (server-assigned
  // ids, category mapping). 1 call, replacing the old 4-call full refresh.
  const refreshMenu = useCallback(async () => {
    const seq = ++menuSeqRef.current;
    const menu = await api.menu.get();
    if (seq !== menuSeqRef.current) return;
    setState((s) => ({ ...s, ...mapMenuSlice(menu) }));
  }, [api]);

  // Tenant profile + menu — only the initial load / explicit full refresh.
  const refreshTenantMenu = useCallback(async () => {
    const seq = ++menuSeqRef.current;
    const [tenant, menu] = await Promise.all([
      fetchCurrentTenantCoalesced(() => api.tenant.current()),
      api.menu.get(),
    ]);
    if (seq !== menuSeqRef.current) return;
    setState((s) => ({
      ...s,
      taxRate: tenant.taxRate ?? 0,
      currency: tenant.currency,
      gstNumber: tenant.gstNumber,
      upiId: tenant.upiId,
      upiMobile: tenant.upiMobile,
      tenantName: tenant.name,
      ...mapMenuSlice(menu),
    }));
  }, [api]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshTenantMenu(), refreshFloor()]);
    setLoaded(true);
  }, [refreshTenantMenu, refreshFloor]);

  // Listeners registered via `subscribeOrderEvents` (e.g. the KDS board) — fed
  // from the single stream subscription below instead of opening their own.
  // `liveOrdersRef` mirrors the current live floor (by order id) so a listener
  // that subscribes AFTER the initial snapshot already arrived (e.g. navigating
  // to /kds once the app is already loaded) still gets an equivalent seed —
  // otherwise it would only see later deltas and never learn about orders that
  // were already live.
  const orderEventListenersRef = useRef<Set<(event: OrderStreamEvent) => void>>(
    new Set(),
  );
  const liveOrdersRef = useRef<Map<string, DomainOrder>>(new Map());
  // Whether the real stream has delivered its first snapshot yet — NOT the
  // same as "liveOrdersRef has entries". A tenant with zero live tables gets
  // a legitimately EMPTY snapshot; keying the synthetic-seed-on-subscribe
  // below off `liveOrdersRef.current.size > 0` treated "0 live orders" the
  // same as "snapshot never arrived", so a late subscriber (e.g. KDS, which
  // mounts after AdminStore already loaded) never got seeded and `connected`
  // stayed false forever — the board showed a permanent "Connecting…" even
  // though the stream was fine and genuinely had nothing to report.
  const hasSnapshotRef = useRef(false);
  const subscribeOrderEvents = useCallback(
    (handler: (event: OrderStreamEvent) => void) => {
      if (hasSnapshotRef.current) {
        handler({ type: "snapshot", orders: [...liveOrdersRef.current.values()] });
      }
      orderEventListenersRef.current.add(handler);
      return () => {
        orderEventListenersRef.current.delete(handler);
      };
    },
    [],
  );

  // Load only once signed in, and (re)load when the active tenant changes — so a
  // logout clears the floor and a login to a different restaurant refetches it.
  // Before auth there's no tenant to scope to, so we don't hit the API at all.
  useEffect(() => {
    if (status !== "authed") {
      setState(EMPTY_STATE);
      setLoaded(false);
      // Drop the previous tenant's live-order mirror so a stale snapshot
      // can't leak into a different tenant's session after a re-login.
      hasSnapshotRef.current = false;
      liveOrdersRef.current = new Map();
      return;
    }
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [status, user?.tenantId, refresh]);

  // Real-time: subscribe to the tenant's live order stream so external changes
  // (guest QR reservations, payments, KDS status, another device's edits) land
  // on the floor instantly. Every event carries the COMPLETE fresh Order (and
  // the reconnect snapshot the whole live floor), so it is applied to state
  // DIRECTLY — no refetch round trip per event. Applying is safe even while a
  // local mutation is in flight: it's authoritative server state, replaced
  // wholesale by orderId, so there is no optimistic state to clobber.
  // This is the ONE `/orders/stream` connection for the whole app — other
  // consumers (KDS) subscribe via `subscribeOrderEvents` above rather than
  // opening a second EventSource.
  useEffect(() => {
    // The stream requires `tables.manage` server-side (it exposes the whole
    // floor) — a role without it (e.g. Kitchen: kds.use only) always got a 403
    // on connect, and EventSource auto-reconnects on error, so it looped
    // failed attempts forever. Skipping the call outright doesn't change what
    // such a role could already do (it never received a live event either
    // way — `subscribeOrderEvents` below has nothing to seed a late listener
    // with), it just stops the reconnect-storm and console spam. KDS for a
    // permission-less role still runs off the relay (`kdsClient`), degraded
    // but functional per useKds.ts's fallback design.
    if (!loaded || !can("tables.manage")) return;
    const unsub = api.orders.stream((event) => {
      // Keep the live-orders mirror in sync so a late `subscribeOrderEvents`
      // caller can be seeded correctly (see liveOrdersRef above).
      if (event.type === "snapshot") {
        hasSnapshotRef.current = true;
        liveOrdersRef.current = new Map(event.orders.map((o) => [o.id, o]));
      } else if (event.type === "closed") {
        liveOrdersRef.current.delete(event.orderId);
      } else {
        liveOrdersRef.current.set(event.orderId, event.order);
      }

      for (const handler of orderEventListenersRef.current) handler(event);

      // An order that just closed (staff cancelled, or settled) must vanish from
      // the KDS too — otherwise the kitchen keeps seeing a dead order and can
      // advance it (writing a bogus status back to the guest). The relay is
      // separate from the API, so push the removal across (best-effort).
      if (event.type === "closed") {
        void kdsClient.cancelOrder?.(event.orderId);
      }

      if (event.type === "snapshot") {
        // The snapshot is the guaranteed full re-sync (reconnects): replace
        // every table's session wholesale so any drift gets wiped.
        applyTables((tables) => applySnapshotToTables(tables, event.orders));
        return;
      }
      // Escape hatch: an order for a table this client doesn't know yet (table
      // added on another device) can't be merged in place — fall back to one
      // full floor refetch for that rare case instead of dropping the event.
      // Guarded on tables EXISTING: a role that can't read the floor at all
      // (tables.list 403s → always empty, e.g. Kitchen) must not turn this
      // into a refetch-per-event loop — it has no floor state to fix, and the
      // KDS consumes events via subscribeOrderEvents, not state.tables.
      const knownTables = stateRef.current.tables;
      if (
        knownTables.length > 0 &&
        !knownTables.some((t) => t.id === event.order.tableId)
      ) {
        refreshFloor().catch(() => {});
      } else {
        applyTables((tables) => applyOrderToTables(tables, event.order));
      }
      // A closed order may have produced a sale (payment capture) — the one
      // remaining live sales trigger (debounced; see refreshSalesSoon).
      if (event.type === "closed") refreshSalesSoon();
    });
    return unsub;
  }, [loaded, api, can, applyTables, refreshFloor, refreshSalesSoon]);

  // Background sync — low-frequency self-heal fallback behind the SSE stream
  // above (covers a dropped stream, e.g. a backgrounded tab). Only resyncs
  // floor + sales (via `refreshFloor`), not menu — menu only changes through
  // explicit admin edits, which already trigger their own menu refetch in
  // `dispatch` — so polling it here was pure redundant `/menu` traffic for
  // every page, including ones (like KDS) that never read menu state at all.
  // Polls while the tab is visible and refetches immediately on focus; skips
  // while a mutation (+ its own refetch) is in flight to avoid clobbering
  // optimistic state. 60s: the stream (with its reconnect snapshot) is the
  // primary path — this is a true last-resort fallback, not a data source.
  useEffect(() => {
    if (!loaded) return;
    const POLL_MS = 60000;
    // `visibilitychange` and `focus` commonly both fire within the same tick
    // when switching back to a backgrounded tab — debounce them behind one
    // trigger (mirrors the SSE handler's 150ms coalescing above) instead of
    // firing two redundant refetches.
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const syncNow = () => {
      if (document.hidden || mutatingRef.current || debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined;
        if (mutatingRef.current) return;
        refreshFloor().catch(() => {});
      }, 150);
    };
    const id = setInterval(syncNow, POLL_MS);
    document.addEventListener("visibilitychange", syncNow);
    window.addEventListener("focus", syncNow);
    return () => {
      clearInterval(id);
      if (debounceTimer) clearTimeout(debounceTimer);
      document.removeEventListener("visibilitychange", syncNow);
      window.removeEventListener("focus", syncNow);
    };
  }, [loaded, refreshFloor]);

  const orderIdFor = useCallback((tableId: string): string | undefined => {
    return stateRef.current.tables.find((t) => t.id === tableId)?.session
      ?.orderId;
  }, []);

  const apply = useCallback(
    async (action: Action): Promise<void> => {
      switch (action.type) {
        // Menu/category actions apply their own response directly to state,
        // same as tables/orders below — no post-save `menu.get()` refetch.
        // Idempotent calls (update/delete) go through `withRetry` so a
        // transient LAN blip doesn't surface as a lost edit; `addItem` is a
        // non-idempotent create, so it is NOT auto-retried (see retry.ts) —
        // a network drop there surfaces as a real failure instead of risking
        // a duplicate item.
        case "TOGGLE_AVAILABILITY": {
          const it = stateRef.current.items.find((i) => i.id === action.itemId);
          const updated = await withRetry(() =>
            api.menu.updateItem(action.itemId, {
              available: !(it?.available ?? true),
            }),
          );
          applyMenu((s) => ({
            ...s,
            items: s.items.map((x) =>
              x.id === action.itemId ? mapDomainItem(updated, s.categories) : x,
            ),
          }));
          return;
        }
        case "UPDATE_ITEM": {
          const p = action.patch;
          const updated = await withRetry(() =>
            api.menu.updateItem(action.itemId, {
              name: p.name,
              description: p.description,
              price: p.priceCents,
              categoryId: p.categoryId,
              icon: p.icon,
              swatch: p.swatch,
              available: p.available,
              dietary: p.dietary,
              jain: p.jain,
              imageUrl: p.imageUrl,
              // undefined = leave untouched; an array (incl. []) = replace.
              modifierGroups: p.modifierGroups
                ? toModifierGroupsInput(p.modifierGroups)
                : undefined,
            }),
          );
          applyMenu((s) => ({
            ...s,
            items: s.items.map((x) =>
              x.id === action.itemId ? mapDomainItem(updated, s.categories) : x,
            ),
          }));
          return;
        }
        case "ADD_ITEM": {
          const i = action.item;
          const created = await api.menu.addItem({
            categoryId: i.categoryId,
            name: i.name,
            price: i.priceCents,
            description: i.description,
            icon: i.icon,
            swatch: i.swatch,
            imageUrl: i.imageUrl,
            available: i.available,
            dietary: i.dietary,
            jain: i.jain,
            modifierGroups: i.modifierGroups
              ? toModifierGroupsInput(i.modifierGroups)
              : undefined,
          });
          applyMenu((s) => ({
            ...s,
            items: [...s.items, mapDomainItem(created, s.categories)],
          }));
          return;
        }
        case "DELETE_ITEM":
          await withRetry(() => api.menu.deleteItem(action.itemId));
          applyMenu((s) => ({
            ...s,
            items: s.items.filter((x) => x.id !== action.itemId),
          }));
          return;
        case "ADD_CATEGORY": {
          const created = await api.menu.addCategory({ name: action.name });
          applyMenu((s) => ({
            ...s,
            categories: [...s.categories, mapDomainCategory(created)],
          }));
          return;
        }
        case "UPDATE_CATEGORY": {
          const updated = await withRetry(() =>
            api.menu.updateCategory(action.categoryId, { name: action.name }),
          );
          applyMenu((s) => ({
            ...s,
            categories: s.categories.map((x) =>
              x.id === action.categoryId ? mapDomainCategory(updated) : x,
            ),
          }));
          return;
        }
        case "DELETE_CATEGORY":
          await withRetry(() => api.menu.deleteCategory(action.categoryId));
          applyMenu((s) => ({
            ...s,
            categories: s.categories.filter((x) => x.id !== action.categoryId),
          }));
          return;
        // Every mutation below applies the API's returned object to state
        // directly (plus the SSE echo re-applying the same data, idempotent) —
        // no refetch. That's what removed the old post-dispatch wait: callers
        // that read state right after `await dispatch(...)` (OpenSessionModal,
        // QrModal's regenerate) see it already updated when apply() resolves.
        case "ADD_TABLE": {
          const t = await api.tables.create({
            label: action.label,
            seats: action.seats,
            room: action.room,
          });
          applyTables((tables) => [...tables, mergeDomainTable(undefined, t)]);
          return;
        }
        case "OPEN_SESSION": {
          const order = await api.orders.createForTable(action.tableId, {
            customerName: action.customerName,
            customerPhone: action.customerPhone,
          });
          applyTables((tables) => applyOrderToTables(tables, order));
          return;
        }
        case "REGEN_QR": {
          const t = await api.tables.regenerateQr(action.tableId);
          applyTables((tables) =>
            tables.map((x) => (x.id === t.id ? mergeDomainTable(x, t) : x)),
          );
          return;
        }
        case "UPDATE_TABLE": {
          const t = await withRetry(() =>
            api.tables.update(action.tableId, {
              label: action.patch.label,
              seats: action.patch.seats,
              room: action.patch.room,
            }),
          );
          applyTables((tables) =>
            tables.map((x) => (x.id === t.id ? mergeDomainTable(x, t) : x)),
          );
          return;
        }
        case "DELETE_TABLE":
          await withRetry(() => api.tables.remove(action.tableId));
          applyTables((tables) => tables.filter((x) => x.id !== action.tableId));
          return;
        case "ADD_ORDER_ITEMS": {
          const orderId = orderIdFor(action.tableId);
          if (!orderId || action.items.length === 0) return;
          // One `addRound` call for the whole batch (same endpoint the guest
          // app's "Bring these" uses) instead of one `addItem` POST per item —
          // an N-item add from the picker is 1 request instead of N, each of
          // which used to also trigger its own full floor refetch.
          const roundItems = action.items
            .map((sel) => {
              const menuItem = stateRef.current.items.find((i) => i.id === sel.menuItemId);
              if (!menuItem) return null;
              return {
                menuItemId: menuItem.id,
                name: menuItem.name,
                unitPrice: menuItem.priceCents,
                qty: sel.qty,
                notes: sel.notes || undefined,
                modifiers: sel.modifiers?.map((m) => ({
                  optionId: m.optionId ?? undefined,
                  groupName: m.groupName,
                  name: m.name,
                  priceDelta: m.priceDelta,
                  textValue: m.textValue,
                })),
              };
            })
            .filter((i): i is NonNullable<typeof i> => i !== null);
          if (roundItems.length === 0) return;
          const order = await api.orders.addRound(orderId, {
            type: "bundled",
            items: roundItems,
          });
          applyTables((tables) => applyOrderToTables(tables, order));
          return;
        }
        case "CHANGE_QTY": {
          const orderId = orderIdFor(action.tableId);
          // Send the relative delta rather than computing `item.qty + delta`
          // from this client's cached snapshot — the server applies it as an
          // atomic DB increment, so two rapid taps (or two staff devices on
          // the same table) both land instead of the second silently
          // clobbering the first's write. NOT wrapped in withRetry: a delta
          // is non-idempotent — retrying after a lost response (but a
          // server-side success) would double-apply the delta.
          if (orderId) {
            const order = await api.orders.updateItem(orderId, action.itemId, {
              qtyDelta: action.delta,
            });
            applyTables((tables) => applyOrderToTables(tables, order));
          }
          return;
        }
        case "CANCEL_ITEM": {
          const orderId = orderIdFor(action.tableId);
          if (orderId) {
            const order = await withRetry(() =>
              api.orders.updateItem(orderId, action.itemId, {
                status: "cancelled",
              }),
            );
            applyTables((tables) => applyOrderToTables(tables, order));
            // Signal the KDS to pull this dish's card off the board (any column).
            // The ticket id is `roundId::orderItemId` (shared id space). The order
            // itself stays live, so this is the only way the kitchen learns the
            // single item was cancelled.
            void kdsClient.removeTicket?.(`${action.roundId}::${action.itemId}`);
          }
          return;
        }
        case "CANCEL_ORDER": {
          const orderId = orderIdFor(action.tableId);
          if (orderId) {
            const order = await withRetry(() => api.orders.cancel(orderId));
            applyTables((tables) => applyOrderToTables(tables, order));
            // Drop the whole order from the KDS immediately (don't wait for the
            // stream round-trip). Idempotent with the closed-event handler.
            void kdsClient.cancelOrder?.(orderId);
          }
          return;
        }
        case "COMPLETE_PAYMENT": {
          const orderId = orderIdFor(action.tableId);
          if (orderId) {
            // Server recomputes subtotal/tax from the order; amountCents is
            // advisory. tenderedCents (cash only) is persisted so a later
            // receipt reprint can still show change due.
            //
            // `settlePayment` is the trust boundary: it only resolves ok when
            // the server has confirmed a Payment row exists — either from this
            // capture or (for a lost-response retry) from an explicit re-check.
            // A failure THROWS so `dispatch` returns false and the caller keeps
            // staff on the billing screen; the table is only freed below, after
            // confirmed settlement.
            const result = await settlePayment(api, orderId, {
              method: action.method,
              tendered: action.tenderedCents,
            });
            if (!result.ok) throw new Error(result.message);
            // capturePayment returns the Payment, not the Order — free the
            // settled table directly and pull the new sale into the feed (the
            // stream's `closed` echo coalesces into the same debounced fetch).
            applyTables((tables) =>
              tables.map((t) =>
                t.session?.orderId === orderId
                  ? { ...t, session: undefined, status: "free" }
                  : t,
              ),
            );
            refreshSalesSoon();
          }
          return;
        }
      }
    },
    [api, orderIdFor, applyTables, applyMenu, refreshSalesSoon],
  );

  // Used only to route the on-error self-heal refetch below to the right
  // slice. Every action (menu and floor alike) now applies its own mutation's
  // response directly to state inside apply() — menu edits used to force a
  // full `menu.get()` refetch after every save regardless of outcome; they
  // finish the moment their own mutation resolves now, same as table/order
  // actions always have.
  const MENU_ACTION_TYPES = useMemo(
    () =>
      new Set<Action["type"]>([
        "TOGGLE_AVAILABILITY",
        "UPDATE_ITEM",
        "ADD_ITEM",
        "DELETE_ITEM",
        "ADD_CATEGORY",
        "UPDATE_CATEGORY",
        "DELETE_CATEGORY",
      ]),
    [],
  );

  const dispatch = useCallback(
    async (action: Action): Promise<boolean> => {
      // Optimistic "crafting" placeholder so the new item appears immediately.
      let tempId: string | undefined;
      if (action.type === "ADD_ITEM") {
        tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        setPendingItems((p) => [
          ...p,
          {
            tempId: tempId!,
            categoryId: action.item.categoryId,
            name: action.item.name,
          },
        ]);
      }
      setMutateCount((c) => c + 1);
      setError(null);
      let ok = true;
      try {
        await apply(action);
      } catch (e) {
        ok = false;
        setError(e instanceof Error ? e.message : String(e));
        // A failed action can mean this client's snapshot was stale (e.g. a
        // 409 from a table settled, or an item deleted, elsewhere) — one
        // refetch of the relevant slice resyncs.
        if (MENU_ACTION_TYPES.has(action.type)) void refreshMenu().catch(() => {});
        else void refreshFloor().catch(() => {});
      } finally {
        setMutateCount((c) => Math.max(0, c - 1));
        if (tempId)
          setPendingItems((p) => p.filter((x) => x.tempId !== tempId));
      }
      return ok;
    },
    [apply, refreshMenu, refreshFloor, MENU_ACTION_TYPES],
  );

  const uploadImage = useCallback(
    async (file: File): Promise<string> => {
      const { url } = await api.menu.uploadImage(file, file.name);
      return url;
    },
    [api],
  );

  /**
   * Pull a pasted photo link into our own storage and return that URL, so a
   * link and an upload end up equally permanent. See `importImageFromUrl`.
   */
  const importImage = useCallback(
    async (link: string): Promise<string> => {
      const { url } = await api.menu.importImage(link);
      return url;
    },
    [api],
  );

  // Currency formatter + symbol, rebuilt only when the tenant's currency changes
  // (loaded once with the tenant; not re-fetched). All pages share these.
  const money = useMemo(
    () => createMoneyFormatter(state.currency),
    [state.currency],
  );
  const currencySymbol = useMemo(
    () => currencySymbolFor(state.currency),
    [state.currency],
  );

  const value = useMemo(
    () => ({
      state,
      dispatch,
      refresh,
      refreshFloor,
      uploadImage,
      importImage,
      money,
      currencySymbol,
      loading: !loaded,
      mutating: mutateCount > 0,
      pendingItems,
      error,
      subscribeOrderEvents,
    }),
    [state, dispatch, refresh, refreshFloor, uploadImage, importImage, money, currencySymbol, loaded, mutateCount, pendingItems, error, subscribeOrderEvents],
  );

  // Only block on the floor/menu data load once the user is signed in. Before
  // auth (anon, or while the token is still resolving) we must render children so
  // the LoginPage + route guards can show — otherwise the login screen never
  // appears (the store can't load without a tenant/token).
  if (status === "authed" && !loaded) {
    if (error) {
      return (
        <div className="flex h-screen items-center justify-center bg-background font-body-md text-body-md text-on-surface-variant">
          Failed to load: {error}
        </div>
      );
    }
    return <AppShellSkeleton />;
  }

  return (
    <AdminContext.Provider value={value}>
      {value.mutating && <div className="ag-topbar" aria-hidden />}
      {children}
      {error && (
        <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-sm rounded-full border border-error/30 bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container shadow-lg">
          <span>Couldn’t save: {error}</span>
          <button
            onClick={() => setError(null)}
            className="font-label-md text-label-md underline underline-offset-2"
          >
            Dismiss
          </button>
        </div>
      )}
    </AdminContext.Provider>
  );
}

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within AdminStoreProvider");
  return ctx;
}

/** The tenant-aware money formatter — convenience for presentational components. */
export function useMoney(): (cents: number) => string {
  return useAdmin().money;
}

// ── Derived selectors (unchanged contract) ────────────────────────────────

/** Per-unit price including modifier deltas, in cents — mirrors @amber/domain's orderItemUnitPrice. */
export function itemUnitPrice(item: OrderItem): number {
  return (
    item.priceCents + (item.modifiers ?? []).reduce((s, m) => s + m.priceDelta, 0)
  );
}

/** Subtotal in cents for a session's non-cancelled items (incl. modifier deltas). */
export function sessionSubtotal(rounds: Round[]): number {
  return rounds
    .flatMap((r) => r.items)
    .filter((i) => i.status !== "cancelled")
    .reduce((sum, i) => sum + itemUnitPrice(i) * i.qty, 0);
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
