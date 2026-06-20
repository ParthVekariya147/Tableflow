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
import { createApiClient } from "@amber/api-client";
import type {
  Menu as DomainMenu,
  FloorTable,
  Sale as DomainSale,
  Order as DomainOrder,
} from "@amber/domain";
import type {
  AdminState,
  MenuItem,
  PaymentMethod,
  Round,
  Table,
  TableSession,
} from "../data/types";
import { defaultTenant } from "../tenant/defaultTenant";

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
  | { type: "OPEN_SESSION"; tableId: string }
  | { type: "REGEN_QR"; tableId: string }
  | { type: "UPDATE_TABLE"; tableId: string; patch: Partial<Table> }
  | { type: "DELETE_TABLE"; tableId: string }
  | { type: "ADD_ORDER_ITEM"; tableId: string; menuItemId: string }
  | { type: "CHANGE_QTY"; tableId: string; roundId: string; itemId: string; delta: number }
  | { type: "CANCEL_ITEM"; tableId: string; roundId: string; itemId: string }
  | { type: "CANCEL_ORDER"; tableId: string }
  | { type: "COMPLETE_PAYMENT"; tableId: string; method: PaymentMethod; amountCents: number };

const EMPTY_STATE: AdminState = {
  taxRate: defaultTenant.taxRate ?? 0,
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
    })),
  };
}

function mapSession(order: DomainOrder): TableSession {
  return {
    orderId: order.id,
    openedAt: Date.parse(order.createdAt),
    rounds: order.rounds.map(mapRound),
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
  };
}

function mapState(
  menu: DomainMenu,
  floor: FloorTable[],
  sales: DomainSale[],
  taxRate: number,
): AdminState {
  const nameToId = new Map(menu.categories.map((c) => [c.name, c.id]));
  return {
    taxRate,
    categories: menu.categories.map((c) => ({ id: c.id, name: c.name })),
    items: menu.items.map((i): MenuItem => ({
      id: i.id,
      categoryId: nameToId.get(i.category) ?? "",
      name: i.name,
      description: i.description,
      priceCents: i.price,
      available: i.available,
      icon: i.icon ?? DEFAULT_ICON,
      swatch: i.swatch ?? DEFAULT_SWATCH,
      imageUrl: i.imageUrl,
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
  /** Upload an item photo to storage; resolves to its public URL. */
  uploadImage: (file: File) => Promise<string>;
  loading: boolean;
  /** True while any mutation (+ its refetch) is in flight — drives the top bar. */
  mutating: boolean;
  /** Items being created right now, shown as "crafting" skeletons in the grid. */
  pendingItems: PendingItem[];
  error: string | null;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminStoreProvider({ children }: { children: ReactNode }) {
  const api = useMemo(
    () =>
      createApiClient({
        baseUrl:
          (import.meta.env.VITE_API_URL as string | undefined) ??
          "http://localhost:3001",
        tenantSlug: defaultTenant.slug,
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

  const refresh = useCallback(async () => {
    const [tenant, menu, floor, sales] = await Promise.all([
      api.tenant.current(),
      api.menu.get(),
      api.tables.list(),
      api.orders.sales(),
    ]);
    setState(mapState(menu, floor, sales, tenant.taxRate ?? 0));
    setLoaded(true);
  }, [api]);

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [refresh]);

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
            imageUrl: p.imageUrl,
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
          await api.orders.createForTable(action.tableId);
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
        case "ADD_ORDER_ITEM": {
          const orderId = orderIdFor(action.tableId);
          if (orderId)
            await api.orders.addItem(orderId, { menuItemId: action.menuItemId });
          return;
        }
        case "CHANGE_QTY": {
          const orderId = orderIdFor(action.tableId);
          const table = stateRef.current.tables.find(
            (t) => t.id === action.tableId,
          );
          const item = table?.session?.rounds
            .flatMap((r) => r.items)
            .find((i) => i.id === action.itemId);
          if (orderId && item)
            await api.orders.updateItem(orderId, action.itemId, {
              qty: Math.max(0, item.qty + action.delta),
            });
          return;
        }
        case "CANCEL_ITEM": {
          const orderId = orderIdFor(action.tableId);
          if (orderId)
            await api.orders.updateItem(orderId, action.itemId, {
              status: "cancelled",
            });
          return;
        }
        case "CANCEL_ORDER": {
          const orderId = orderIdFor(action.tableId);
          if (orderId) await api.orders.cancel(orderId);
          return;
        }
        case "COMPLETE_PAYMENT": {
          const orderId = orderIdFor(action.tableId);
          if (orderId)
            // Server recomputes subtotal/tax from the order; amountCents is advisory.
            await api.orders.capturePayment(orderId, { method: action.method });
          return;
        }
      }
    },
    [api, orderIdFor],
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
        await refresh().catch(() => {});
        setMutateCount((c) => Math.max(0, c - 1));
        if (tempId)
          setPendingItems((p) => p.filter((x) => x.tempId !== tempId));
      }
    },
    [apply, refresh],
  );

  const uploadImage = useCallback(
    async (file: File): Promise<string> => {
      const { url } = await api.menu.uploadImage(file, file.name);
      return url;
    },
    [api],
  );

  const value = useMemo(
    () => ({
      state,
      dispatch,
      uploadImage,
      loading: !loaded,
      mutating: mutateCount > 0,
      pendingItems,
      error,
    }),
    [state, dispatch, uploadImage, loaded, mutateCount, pendingItems, error],
  );

  if (!loaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-background font-body-md text-body-md text-on-surface-variant">
        {error ? `Failed to load: ${error}` : "Loading…"}
      </div>
    );
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

// ── Derived selectors (unchanged contract) ────────────────────────────────

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
