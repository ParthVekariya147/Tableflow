import { useCallback, useEffect, useState } from "react";
import { ApiError, type LoyaltyOrderSummary } from "@amber/api-client";
import type { LoyaltyAccount, LoyaltyTransaction } from "@amber/domain";
import { api } from "../lib/api";
import { Icon } from "../components/Icon";
import { Modal } from "../components/Modal";
import { CenteredSpinner, PinnerLoader, TableSkeleton } from "../components/Skeleton";
import { useMoney } from "../store/AdminStore";

const METHOD_LABEL: Record<string, string> = { cash: "Cash", card: "Card", upi: "UPI" };

/**
 * Loyalty customer directory (`/loyalty`) — search accounts, view transaction
 * history, and make manual point corrections. Staff-only (`loyalty.manage`);
 * guests never see this. Points themselves accrue/redeem automatically from
 * the order flow (createForTable / capturePayment / redeemPoints) — this page
 * is purely a lookup + audit + correction tool.
 */
export function LoyaltyPage() {
  const [accounts, setAccounts] = useState<LoyaltyAccount[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback((q?: string) => {
    setLoading(true);
    setError(null);
    setLoadFailed(false);
    api.loyalty.accounts
      .list(q || undefined)
      .then(setAccounts)
      .catch((e) => {
        setError(messageOf(e));
        setLoadFailed(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="space-y-lg">
      <header>
        <h1 className="font-headline-md text-headline-md text-on-surface">Loyalty</h1>
        <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
          Search customers by phone or name to view their points balance and history.
        </p>
      </header>

      <div className="relative max-w-[360px]">
        <span className="absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant">
          <Icon name="search" size={18} />
        </span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search phone or name…"
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-sm pl-xl pr-md font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
        />
      </div>

      {error && (
        <p className="rounded-lg bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-card border border-outline-variant bg-surface-container-lowest">
        {loading ? (
          <>
            <PinnerLoader />
            <TableSkeleton rows={5} cols={2} />
          </>
        ) : loadFailed ? (
          <div className="flex items-center justify-between gap-md px-xl py-lg">
            <p className="font-body-md text-body-md text-on-surface-variant">
              Couldn't load the loyalty directory.
            </p>
            <button
              onClick={() => load(search)}
              className="flex items-center gap-xs rounded-full border border-outline-variant px-lg py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-low"
            >
              <Icon name="refresh" size={18} /> Retry
            </button>
          </div>
        ) : accounts.length === 0 ? (
          <p className="px-xl py-lg font-body-md text-body-md text-on-surface-variant">
            {search ? "No matching customers." : "No loyalty program activity yet."}
          </p>
        ) : (
          <ul className="divide-y divide-outline-variant">
            {accounts.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => setDetailId(a.id)}
                  className="flex w-full items-center justify-between gap-md px-xl py-lg text-left transition-colors hover:bg-surface-container-low"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-sm">
                      <span className="font-label-md text-[15px] font-bold text-on-surface">
                        {a.name || "Unnamed guest"}
                      </span>
                    </div>
                    <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
                      {a.phone}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-headline-md text-[20px] text-primary">
                      {a.pointsBalance}
                    </p>
                    <p className="font-body-md text-[12px] text-on-surface-variant">
                      {a.lifetimePoints} lifetime
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {detailId && (
        <AccountDetailModal
          id={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => load(search)}
        />
      )}
    </div>
  );
}

function AccountDetailModal({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const money = useMoney();
  const [account, setAccount] = useState<LoyaltyAccount | null>(null);
  const [transactions, setTransactions] = useState<LoyaltyTransaction[]>([]);
  const [orders, setOrders] = useState<LoyaltyOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustPoints, setAdjustPoints] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.loyalty.accounts
      .get(id)
      .then(({ account, transactions, orders }) => {
        setAccount(account);
        setTransactions(transactions);
        setOrders(orders);
      })
      .catch((e) => setError(messageOf(e)))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  async function submitAdjust() {
    const points = Number(adjustPoints);
    if (!points) return;
    setSaving(true);
    setError(null);
    try {
      await api.loyalty.accounts.adjust(id, {
        points,
        note: adjustNote.trim() || undefined,
      });
      setAdjustPoints("");
      setAdjustNote("");
      setAdjusting(false);
      load();
      onChanged();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={account?.name || account?.phone || "Customer"} onClose={onClose}>
      {loading ? (
        <CenteredSpinner />
      ) : !account ? (
        <p className="font-body-md text-body-md text-on-surface-variant">Not found.</p>
      ) : (
        <div className="space-y-lg">
          {error && (
            <p className="rounded-lg bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border border-outline-variant px-md py-sm">
            <div>
              <p className="font-body-md text-body-md text-on-surface-variant">{account.phone}</p>
              <p className="font-body-md text-[12px] text-on-surface-variant">
                {account.lifetimePoints} lifetime points
              </p>
            </div>
            <p className="font-headline-md text-[24px] text-primary">{account.pointsBalance}</p>
          </div>

          {adjusting ? (
            <div className="space-y-sm rounded-lg border border-outline-variant p-md">
              <label className="block font-label-md text-label-md text-on-surface">
                Adjustment (+/- points)
              </label>
              <input
                type="number"
                value={adjustPoints}
                onChange={(e) => setAdjustPoints(e.target.value)}
                placeholder="e.g. 50 or -20"
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
              />
              <input
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                placeholder="Reason (optional)"
                className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none"
              />
              <div className="flex justify-end gap-sm pt-xs">
                <button
                  onClick={() => setAdjusting(false)}
                  className="rounded-full px-lg py-sm font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-surface-container-low"
                >
                  Cancel
                </button>
                <button
                  onClick={submitAdjust}
                  disabled={saving || !Number(adjustPoints)}
                  className="rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Apply"}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdjusting(true)}
              className="flex items-center gap-xs rounded-full border border-outline-variant px-lg py-sm font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-low"
            >
              <Icon name="tune" size={16} /> Adjust points
            </button>
          )}

          <div>
            <h3 className="mb-sm font-title-lg text-title-lg text-on-surface">
              Order history
            </h3>
            {orders.length === 0 ? (
              <p className="font-body-md text-body-md text-on-surface-variant">
                No orders on record for this customer yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-md">
                {orders.map((o) => (
                  <li
                    key={o.id}
                    className="rounded-lg border border-outline-variant p-md"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-label-md text-label-md font-semibold text-on-surface">
                          {o.tableLabel}
                        </p>
                        <p className="font-body-md text-[12px] text-on-surface-variant">
                          {new Date(o.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="text-right">
                        {o.payment ? (
                          <>
                            <p className="font-data-mono text-data-mono text-on-surface">
                              {money(o.payment.total)}
                            </p>
                            <p className="font-body-md text-[12px] text-on-surface-variant">
                              {METHOD_LABEL[o.payment.method] ?? o.payment.method}
                            </p>
                          </>
                        ) : (
                          <span className="rounded-full bg-surface-container-low px-sm py-[2px] font-label-md text-[11px] capitalize text-on-surface-variant">
                            {o.status}
                          </span>
                        )}
                      </div>
                    </div>
                    {o.items.length > 0 && (
                      <ul className="mt-sm space-y-xs border-t border-outline-variant pt-sm">
                        {o.items.map((i, idx) => (
                          <li
                            key={idx}
                            className="flex items-center justify-between font-body-md text-[12px] text-on-surface-variant"
                          >
                            <span>
                              {i.qty}× {i.name}
                            </span>
                            <span className="font-data-mono">{money(i.unitPrice * i.qty)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-sm font-title-lg text-title-lg text-on-surface">
              Points history
            </h3>
            {transactions.length === 0 ? (
              <p className="font-body-md text-body-md text-on-surface-variant">
                No transactions yet.
              </p>
            ) : (
              <ul className="divide-y divide-outline-variant">
                {transactions.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-md py-sm">
                    <div>
                      <p className="font-label-md text-label-md capitalize text-on-surface">
                        {t.type}
                        {t.note && (
                          <span className="ml-xs font-body-md text-[12px] text-on-surface-variant">
                            — {t.note}
                          </span>
                        )}
                      </p>
                      <p className="font-body-md text-[12px] text-on-surface-variant">
                        {new Date(t.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`font-data-mono text-data-mono ${
                        t.points >= 0 ? "text-primary" : "text-error"
                      }`}
                    >
                      {t.points >= 0 ? "+" : ""}
                      {t.points}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function messageOf(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}
