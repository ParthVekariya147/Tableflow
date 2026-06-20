import { useCallback, useEffect, useMemo, useState } from "react";
import type { Order, Sale } from "@amber/domain";
import { Icon } from "../components/Icon";
import { api } from "../lib/api";
import { money } from "../lib/money";

/** Local day boundary helper (00:00:00 of the given date, local time). */
function dayStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

type RangeKey = "today" | "yesterday" | "week" | "all";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "Last 7 days" },
  { key: "all", label: "All time" },
];

/** Resolve a range key to an ISO {from,to} window. */
function rangeWindow(key: RangeKey): { from: string; to: string } {
  const now = new Date();
  const today = dayStart(now);
  const day = 86_400_000;
  switch (key) {
    case "today":
      return { from: today.toISOString(), to: now.toISOString() };
    case "yesterday":
      return {
        from: new Date(today.getTime() - day).toISOString(),
        to: today.toISOString(),
      };
    case "week":
      return {
        from: new Date(today.getTime() - 6 * day).toISOString(),
        to: now.toISOString(),
      };
    case "all":
      return { from: new Date(2000, 0, 1).toISOString(), to: now.toISOString() };
  }
}

const METHOD_META: Record<string, { label: string; icon: string; chip: string }> = {
  cash: { label: "Cash", icon: "payments", chip: "bg-secondary-container text-on-secondary-container" },
  card: { label: "Card", icon: "credit_card", chip: "bg-primary-container/20 text-primary" },
};

export function OrderHistoryPage() {
  const [range, setRange] = useState<RangeKey>("today");
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api.orders
      .sales(rangeWindow(range))
      .then((rows) => {
        if (active) setSales(rows);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [range]);

  const totals = useMemo(() => {
    const revenue = sales.reduce((s, x) => s + x.total, 0);
    return {
      count: sales.length,
      revenue,
      avg: sales.length ? Math.round(revenue / sales.length) : 0,
    };
  }, [sales]);

  return (
    <>
      <div className="mb-lg flex flex-col justify-between gap-md md:flex-row md:items-end">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-on-background">Order History</h2>
          <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
            Completed & paid orders — what sold, and which table ordered what.
          </p>
        </div>
        <div className="flex items-center gap-sm self-start rounded-full border border-outline-variant bg-surface-container-high p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-full px-md py-sm font-label-md text-label-md transition-all ${
                range === r.key
                  ? "bg-surface-container-lowest text-primary shadow-sm"
                  : "text-on-surface-variant hover:text-primary"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-lg grid grid-cols-1 gap-md sm:grid-cols-3">
        <StatCard label="Orders" value={String(totals.count)} icon="receipt_long" />
        <StatCard label="Revenue" value={money(totals.revenue)} icon="payments" />
        <StatCard label="Average order" value={money(totals.avg)} icon="trending_up" />
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-sm py-xxl text-on-surface-variant">
          <Icon name="progress_activity" size={36} className="ag-spin" />
          <p className="font-body-md text-body-md">Loading orders…</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-sm py-xxl text-error">
          <Icon name="error" size={36} />
          <p className="font-body-md text-body-md">Couldn’t load history: {error}</p>
        </div>
      ) : sales.length === 0 ? (
        <div className="flex flex-col items-center gap-sm rounded-card border border-dashed border-outline-variant bg-surface-container-lowest py-xxl text-on-surface-variant">
          <Icon name="history" size={40} />
          <p className="font-body-md text-body-md">No completed orders in this period.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-outline-variant bg-surface-container-lowest shadow-card">
          <div className="hidden grid-cols-[1fr_1fr_1fr_1fr_auto] gap-md border-b border-outline-variant bg-surface-container-low px-lg py-sm font-label-md text-label-md uppercase text-on-surface-variant md:grid">
            <span>Time</span>
            <span>Table</span>
            <span>Payment</span>
            <span className="text-right">Total</span>
            <span className="w-6" />
          </div>
          {sales.map((sale) => (
            <SaleRow key={sale.id} sale={sale} />
          ))}
        </div>
      )}
    </>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="flex items-center gap-md rounded-card border border-outline-variant bg-surface-container-lowest p-md shadow-card">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-container/20 text-primary">
        <Icon name={icon} size={22} />
      </div>
      <div>
        <div className="font-label-md text-label-md uppercase text-on-surface-variant">{label}</div>
        <div className="font-headline-md text-headline-md text-on-background">{value}</div>
      </div>
    </div>
  );
}

function SaleRow({ sale }: { sale: Sale }) {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  const method = METHOD_META[sale.method] ?? {
    label: sale.method,
    icon: "payments",
    chip: "bg-surface-container-high text-on-surface-variant",
  };

  const time = new Date(sale.createdAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const toggle = useCallback(() => {
    setOpen((v) => !v);
    if (!order && !loadingOrder) {
      setLoadingOrder(true);
      setOrderError(null);
      api.orders
        .get(sale.orderId)
        .then(setOrder)
        .catch((e) => setOrderError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoadingOrder(false));
    }
  }, [order, loadingOrder, sale.orderId]);

  return (
    <div className="border-b border-outline-variant/60 last:border-0">
      <button
        onClick={toggle}
        className="grid w-full grid-cols-2 items-center gap-md px-lg py-md text-left transition-colors hover:bg-primary/5 md:grid-cols-[1fr_1fr_1fr_1fr_auto]"
      >
        <span className="font-body-md text-body-md text-on-surface">{time}</span>
        <span className="font-title-md text-title-md text-on-background">{sale.tableLabel}</span>
        <span>
          <span className={`inline-flex items-center gap-xs rounded-full px-sm py-base font-label-md text-label-md ${method.chip}`}>
            <Icon name={method.icon} size={14} /> {method.label}
          </span>
        </span>
        <span className="text-right font-data-mono text-data-mono font-semibold text-on-background">
          {money(sale.total)}
        </span>
        <span className="hidden justify-self-end text-on-surface-variant md:block">
          <Icon name={open ? "expand_less" : "expand_more"} size={20} />
        </span>
      </button>

      {open && (
        <div className="border-t border-outline-variant/60 bg-surface-container-low/40 px-lg py-md">
          {loadingOrder ? (
            <div className="flex items-center gap-sm font-body-md text-body-md text-on-surface-variant">
              <Icon name="progress_activity" size={16} className="ag-spin" /> Loading items…
            </div>
          ) : orderError ? (
            <p className="font-body-md text-body-md text-error">Couldn’t load items: {orderError}</p>
          ) : order ? (
            <OrderItems order={order} />
          ) : null}
        </div>
      )}
    </div>
  );
}

function OrderItems({ order }: { order: Order }) {
  const lines = order.rounds.flatMap((r) =>
    r.items
      .filter((i) => i.status !== "cancelled")
      .map((i) => ({ ...i, roundType: r.type, roundId: r.id })),
  );

  return (
    <div className="flex flex-col gap-sm">
      {(order.customerName || order.customerPhone) && (
        <div className="flex flex-wrap items-center gap-md font-body-md text-body-md text-on-surface-variant">
          {order.customerName && (
            <span className="flex items-center gap-xs">
              <Icon name="person" size={16} /> {order.customerName}
            </span>
          )}
          {order.customerPhone && (
            <span className="flex items-center gap-xs">
              <Icon name="call" size={16} /> {order.customerPhone}
            </span>
          )}
        </div>
      )}
      {lines.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">No items on this order.</p>
      ) : (
        <ul className="flex flex-col gap-xs">
          {lines.map((i) => (
            <li key={i.id} className="flex items-center justify-between font-body-md text-body-md text-on-surface">
              <span>
                <span className="font-data-mono text-on-surface-variant">{i.qty}×</span> {i.name}
                {i.notes && <span className="ml-xs text-on-surface-variant">· {i.notes}</span>}
              </span>
              <span className="font-data-mono text-data-mono text-on-surface-variant">
                {money(i.unitPrice * i.qty)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
