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
  FloorTable,
  Sale as DomainSale,
  Order as DomainOrder,
} from "@amber/domain";
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
 * `dispatch` that translates each UI action into the matching API call and then
 * refetches. Pages and selectors are unchanged — only the data source moved
 * from an in-memory seed to the live API (Supabase via services/api).
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

function mapState(
  menu: DomainMenu,
  floor: FloorTable[],
  sales: DomainSale[],
  taxRate: number,
  currency: string,
  gstNumber?: string,
  upiId?: string,
  upiMobile?: string,
  tenantName?: string,
): AdminState {
  const nameToId = new Map(menu.categories.map((c) => [c.name, c.id]));
  return {
    taxRate,
    currency,
    gstNumber,
    upiId,
    upiMobile,
    tenantName,
    categories: menu.categories.map((c) => ({ id: c.id, name: c.name })),
    items: menu.items.map((i): MenuItem => ({
      id: i.id,
      categoryId: nameToId.get(i.category) ?? "",
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
    })),
    tables: floor.map(mapTable),
    sales: sales.map((s) => ({
      id: s.id,
      tableLabel: s.tableLabel,
      totalCents: s.total,
      method: s.method,
      at: Date.parse(s.createdAt),
    })),
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
  dispatch: (action: Action) => Promise<void>;
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
 * A permission-gated list endpoint returns [] instead of throwing when the
 * signed-in user lacks the permission (403). This keeps the store's initial
 * load resilient for lower-privilege roles — e.g. a Kitchen user (kds.use only)
 * can't read the floor/sales, but load must still finish and set `loaded` so
 * the order stream (which the KDS board depends on) subscribes. Any other error
 * still propagates so real failures surface.
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

  // Monotonic counter shared by `refresh`/`refreshFloor`. Both can be
  // triggered from independent sources (the SSE stream, the poll interval,
  // focus/visibilitychange, an explicit page-level `refresh()` call) that can
  // race — an EARLIER request resolving AFTER a LATER one (ordinary network
  // jitter) would otherwise silently revert state to stale data. Each call
  // captures its own sequence number and only applies its result if nothing
  // newer has started since.
  const syncSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++syncSeqRef.current;
    const [tenant, menu, floor, sales] = await Promise.all([
      fetchCurrentTenantCoalesced(() => api.tenant.current()),
      api.menu.get(),
      emptyOn403(api.tables.list()),
      emptyOn403(api.orders.sales()),
    ]);
    if (seq !== syncSeqRef.current) return; // superseded by a newer sync
    setState(mapState(menu, floor, sales, tenant.taxRate ?? 0, tenant.currency, tenant.gstNumber, tenant.upiId, tenant.upiMobile, tenant.name));
    setLoaded(true);
  }, [api]);

  // Lighter refetch for live order events: only the floor + sales change on an
  // order mutation, so leave menu/categories/taxRate untouched (less load than a
  // full `refresh`). Driven by the SSE stream below.
  const refreshFloor = useCallback(async () => {
    const seq = ++syncSeqRef.current;
    const [floor, sales] = await Promise.all([
      emptyOn403(api.tables.list()),
      emptyOn403(api.orders.sales()),
    ]);
    if (seq !== syncSeqRef.current) return; // superseded by a newer sync
    setState((s) => ({
      ...s,
      tables: floor.map(mapTable),
      sales: sales.map((sl) => ({
        id: sl.id,
        tableLabel: sl.tableLabel,
        totalCents: sl.total,
        method: sl.method,
        at: Date.parse(sl.createdAt),
      })),
    }));
  }, [api]);

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
  const { status, user } = useAuth();
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
  // on the floor instantly. Coalesce bursts (snapshot + deltas) into one floor
  // refetch, and skip while a local mutation (+ its refetch) is in flight so a
  // pushed event can't clobber optimistic state (existing `mutatingRef` guard).
  // This is the ONE `/orders/stream` connection for the whole app — other
  // consumers (KDS) subscribe via `subscribeOrderEvents` above rather than
  // opening a second EventSource.
  useEffect(() => {
    if (!loaded) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
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
      if (mutatingRef.current || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (mutatingRef.current) return;
        refreshFloor().catch(() => {});
      }, 150);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [loaded, api, refreshFloor]);

  // Background sync — low-frequency self-heal fallback behind the SSE stream
  // above (covers a dropped stream, e.g. a backgrounded tab). Only resyncs
  // floor + sales (via `refreshFloor`), not menu — menu only changes through
  // explicit admin edits, which already trigger their own full `refresh()` in
  // `dispatch` — so polling it here was pure redundant `/menu` traffic for
  // every page, including ones (like KDS) that never read menu state at all.
  // Polls while the tab is visible and refetches immediately on focus; skips
  // while a mutation (+ its own refetch) is in flight to avoid clobbering
  // optimistic state.
  useEffect(() => {
    if (!loaded) return;
    const POLL_MS = 20000;
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
        case "TOGGLE_AVAILABILITY": {
          const it = stateRef.current.items.find((i) => i.id === action.itemId);
          await api.menu.updateItem(action.itemId, {
            available: !(it?.available ?? true),
          });
          return;
        }
        case "UPDATE_ITEM": {
          const p = action.patch;
          await api.menu.updateItem(action.itemId, {
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
          });
          return;
        }
        case "ADD_ITEM": {
          const i = action.item;
          await api.menu.addItem({
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
          return;
        }
        case "DELETE_ITEM":
          await api.menu.deleteItem(action.itemId);
          return;
        case "ADD_CATEGORY":
          await api.menu.addCategory({ name: action.name });
          return;
        case "UPDATE_CATEGORY":
          await api.menu.updateCategory(action.categoryId, { name: action.name });
          return;
        case "DELETE_CATEGORY":
          await api.menu.deleteCategory(action.categoryId);
          return;
        case "ADD_TABLE":
          await api.tables.create({
            label: action.label,
            seats: action.seats,
            room: action.room,
          });
          return;
        case "OPEN_SESSION":
          await api.orders.createForTable(action.tableId, {
            customerName: action.customerName,
            customerPhone: action.customerPhone,
          });
          return;
        case "REGEN_QR":
          await api.tables.regenerateQr(action.tableId);
          return;
        case "UPDATE_TABLE":
          await api.tables.update(action.tableId, {
            label: action.patch.label,
            seats: action.patch.seats,
            room: action.patch.room,
          });
          return;
        case "DELETE_TABLE":
          await api.tables.remove(action.tableId);
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
          await api.orders.addRound(orderId, { type: "bundled", items: roundItems });
          return;
        }
        case "CHANGE_QTY": {
          const orderId = orderIdFor(action.tableId);
          // Send the relative delta rather than computing `item.qty + delta`
          // from this client's cached snapshot — the server applies it as an
          // atomic DB increment, so two rapid taps (or two staff devices on
          // the same table) both land instead of the second silently
          // clobbering the first's write.
          if (orderId)
            await api.orders.updateItem(orderId, action.itemId, {
              qtyDelta: action.delta,
            });
          return;
        }
        case "CANCEL_ITEM": {
          const orderId = orderIdFor(action.tableId);
          if (orderId) {
            await api.orders.updateItem(orderId, action.itemId, {
              status: "cancelled",
            });
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
            await api.orders.cancel(orderId);
            // Drop the whole order from the KDS immediately (don't wait for the
            // stream round-trip). Idempotent with the closed-event handler.
            void kdsClient.cancelOrder?.(orderId);
          }
          return;
        }
        case "COMPLETE_PAYMENT": {
          const orderId = orderIdFor(action.tableId);
          if (orderId)
            // Server recomputes subtotal/tax from the order; amountCents is advisory.
            // tenderedCents (cash only) is persisted so a later receipt reprint
            // can still show change due.
            await api.orders.capturePayment(orderId, {
              method: action.method,
              tendered: action.tenderedCents,
            });
          return;
        }
      }
    },
    [api, orderIdFor],
  );

  // Menu/category actions change items the floor refetch doesn't cover
  // (categories, item fields, tenant taxRate/currency) — those need the full
  // 4-call refresh. Table/session/payment actions only ever change tables +
  // sales, so the lighter 2-call refreshFloor (already used by the SSE
  // handler) is enough and halves the API calls for the common case.
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

  // Of the refreshFloor-resynced actions, these two are the only callers that
  // read the refetched state right after `await dispatch(...)` resolves:
  // OpenSessionModal navigates into TableSessionPage expecting the new
  // session to already be in `state.tables` (its own comment says so), and
  // QrModal's regenerate() re-renders the QR from the refetched `table.qrToken`
  // — showing the OLD code even a moment longer risks staff printing/scanning
  // a QR that's about to stop working. Every other refreshFloor caller either
  // only closes a modal (no state read) or navigates to a page that re-syncs
  // itself (TableSessionPage's own mount effect) or just needs the shared
  // context to catch up shortly after (TablesPage), so they don't need to
  // block on the refetch — see BLOCKING_RESYNC_TYPES below.
  const BLOCKING_RESYNC_TYPES = useMemo(
    () => new Set<Action["type"]>(["OPEN_SESSION", "REGEN_QR"]),
    [],
  );

  const dispatch = useCallback(
    async (action: Action): Promise<void> => {
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
      try {
        await apply(action);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        const resync = MENU_ACTION_TYPES.has(action.type) ? refresh : refreshFloor;
        const resynced = resync().catch(() => {});
        const settle = () => {
          setMutateCount((c) => Math.max(0, c - 1));
          if (tempId)
            setPendingItems((p) => p.filter((x) => x.tempId !== tempId));
        };
        // mutateCount (→ mutatingRef) stays true until `resynced` settles
        // either way, so an SSE event arriving mid-refetch still gets skipped
        // (see the stream handler below) — only whether the CALLER waits changes.
        if (MENU_ACTION_TYPES.has(action.type) || BLOCKING_RESYNC_TYPES.has(action.type)) {
          await resynced;
          settle();
        } else {
          void resynced.then(settle);
        }
      }
    },
    [apply, refresh, refreshFloor, MENU_ACTION_TYPES, BLOCKING_RESYNC_TYPES],
  );

  const uploadImage = useCallback(
    async (file: File): Promise<string> => {
      const { url } = await api.menu.uploadImage(file, file.name);
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
      money,
      currencySymbol,
      loading: !loaded,
      mutating: mutateCount > 0,
      pendingItems,
      error,
      subscribeOrderEvents,
    }),
    [state, dispatch, refresh, refreshFloor, uploadImage, money, currencySymbol, loaded, mutateCount, pendingItems, error, subscribeOrderEvents],
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
