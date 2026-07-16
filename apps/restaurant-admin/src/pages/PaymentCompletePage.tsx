import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  buildUpiPaymentUrl,
  orderItemUnitPrice,
  orderSubtotal,
  type Order,
  type Payment,
  type PrinterSettings,
  type Receipt,
  type Tenant,
} from "@amber/domain";
import { Icon } from "../components/Icon";
import { useAdmin, useMoney } from "../store/AdminStore";
import { api } from "../lib/api";
import { printReceipt, type PrintResult } from "../lib/printAgent";
import type { PaymentMethod } from "../data/types";

interface CompleteState {
  method: PaymentMethod;
  totalCents: number;
  tableLabel: string;
}

/**
 * Rebuilds the full receipt from the API rather than trusting router state,
 * which doesn't survive a refresh/direct link — see PRINT_RECEIPT_PLAN.md §6.3.
 * Router state (`data` below) is only used as a fast-path hint for the
 * on-screen summary; printing always goes through this rebuilt payload.
 */
function buildReceipt(
  orderId: string,
  tableId: string | undefined,
  tableLabel: string,
  tenant: Tenant,
  order: Order,
  payment: Payment | null,
): Receipt {
  const lines = order.rounds.flatMap((round) =>
    round.items
      .filter((item) => item.status !== "cancelled")
      .map((item) => ({
        name: item.name,
        qty: item.qty,
        unitPrice: orderItemUnitPrice(item),
        modifiers: (item.modifiers ?? [])
          .map((m) => (m.textValue ? `"${m.textValue}"` : m.name))
          .filter(Boolean),
      })),
  );

  const subtotal = payment?.subtotal ?? orderSubtotal(order);
  const total = payment?.total ?? subtotal;

  return {
    tenantName: tenant.name,
    address: tenant.address,
    phone: tenant.phone,
    gstNumber: tenant.gstNumber,
    fssaiNumber: tenant.fssaiNumber,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    tableLabel,
    checkNumber: (tableId ?? orderId).slice(-6).toUpperCase(),
    createdAt: payment?.createdAt ?? order.closedAt ?? new Date().toISOString(),
    lines,
    subtotal,
    taxRate: tenant.taxRate,
    // A captured Payment row = the bill is settled; without one the receipt
    // must print "TOTAL DUE" (and the UPI QR), never claim it was paid.
    settled: !!payment,
    tax: payment?.tax ?? 0,
    gratuity: payment?.tip,
    total,
    method: payment?.method ?? "cash",
    tendered: payment?.tendered,
    change:
      payment?.tendered !== undefined ? Math.max(0, payment.tendered - total) : undefined,
    currency: tenant.currency,
    footerMessage: tenant.printer.footerMessage ?? "Thank you for dining with us!",
    logoUrl: tenant.theme.logoUrl,
    upiPaymentUrl: tenant.upiId
      ? buildUpiPaymentUrl({
          upiId: tenant.upiId,
          payeeName: tenant.name,
          amountCents: total,
          note: `${tableLabel} receipt`,
        })
      : undefined,
    reviewUrl: tenant.theme.reviewLink,
    sections: tenant.printer.sections,
  };
}

export function PaymentCompletePage() {
  const navigate = useNavigate();
  const money = useMoney();
  const { state: adminState } = useAdmin();
  const { state } = useLocation();
  const [searchParams] = useSearchParams();
  const { id: tableId } = useParams();
  const data = (state as CompleteState | null) ?? {
    method: "card",
    totalCents: 0,
    tableLabel: "Table",
  };
  const orderId = searchParams.get("order");

  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [printerSettings, setPrinterSettings] = useState<PrinterSettings | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printResult, setPrintResult] = useState<PrintResult | null>(null);

  useEffect(() => {
    if (!orderId) {
      setReceiptError("No order reference in the URL — can't rebuild the receipt.");
      return;
    }
    let active = true;
    // All three are independent — fetch them together instead of waiting on
    // tenant.current() before even starting the order/payment fetch.
    Promise.all([api.tenant.current(), api.orders.get(orderId), api.orders.getPayment(orderId)])
      .then(([tenant, order, payment]) => {
        if (!active) return;
        setPrinterSettings(tenant.printer);
        setReceipt(buildReceipt(orderId, tableId, data.tableLabel, tenant, order, payment));
      })
      .catch(() => active && setReceiptError("Couldn't load the receipt for printing."));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function handlePrint() {
    if (!receipt || !printerSettings || printing) return;
    setPrinting(true);
    setPrintResult(null);
    const result = await printReceipt(printerSettings, receipt);
    setPrintResult(result);
    setPrinting(false);
  }

  const printLabel = printing
    ? "Printing…"
    : printResult
    ? "Print Again"
    : "Print Receipt";

  // A Quick Sale (no-table counter checkout) returns to /quick-sale to ring up
  // the next customer, instead of the dine-in floor plan.
  const isQuickSale = !!adminState.tables.find((t) => t.id === tableId)?.isCounter;

  return (
    <div className="flex min-h-screen w-full items-center justify-center overflow-hidden bg-surface-bright px-xl">
      <main className="flex w-full max-w-lg flex-col items-center text-center">
        <div className="relative mb-xl flex animate-scale-in items-center justify-center">
          <div className="absolute inset-0 scale-150 rounded-full bg-primary-container opacity-10" />
          <div className="absolute inset-0 scale-110 rounded-full bg-primary-container opacity-20" />
          <Icon name="task_alt" fill size={80} className="relative z-10 text-primary" />
        </div>

        <h1 className="mb-lg animate-slide-up font-headline-lg text-headline-lg tracking-tight text-on-background">
          Session Completed
        </h1>

        <div
          className="mb-xl flex w-full animate-slide-up flex-col gap-sm rounded-card border border-outline-variant bg-surface p-lg text-left shadow-card"
          style={{ animationDelay: "0.1s" }}
        >
          <div className="flex items-center justify-between border-b border-outline-variant pb-sm">
            <span className="font-label-md text-label-md uppercase text-on-surface-variant">
              Status Update
            </span>
            <span className="inline-flex items-center gap-xs rounded-full bg-surface-container-high px-sm py-base">
              <span className="h-2 w-2 rounded-full bg-primary" />
              <span className="font-label-md text-label-md text-on-background">
                {isQuickSale ? "Ready for next order" : `${data.tableLabel} Free`}
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between pt-xs">
            <span className="font-body-md text-body-md text-on-surface-variant">Total Paid</span>
            <span className="font-data-mono text-data-mono text-lg text-on-background">
              {money(receipt?.total ?? data.totalCents)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-body-md text-body-md text-on-surface-variant">Payment Method</span>
            <span className="flex items-center gap-xs font-body-md text-body-md capitalize text-on-background">
              <Icon name={data.method === "card" ? "credit_card" : "payments"} size={16} />
              {receipt?.method ?? data.method}
            </span>
          </div>
        </div>

        <div
          className="flex w-full animate-slide-up flex-col justify-center gap-md sm:flex-row"
          style={{ animationDelay: "0.2s" }}
        >
          <button
            onClick={() => navigate(isQuickSale ? "/quick-sale" : "/tables")}
            className="flex-1 rounded-full bg-primary px-xl py-sm font-label-md text-label-md text-on-primary shadow-sm transition-colors hover:bg-primary-container sm:flex-none"
          >
            {isQuickSale ? "New Sale" : "Back to Tables"}
          </button>
          <button
            onClick={handlePrint}
            disabled={printing || !receipt || !printerSettings}
            className="flex flex-1 items-center justify-center gap-xs rounded-full border border-primary bg-transparent px-xl py-sm font-label-md text-label-md text-primary transition-colors hover:bg-primary/5 disabled:opacity-50 sm:flex-none"
          >
            {printing && <Icon name="progress_activity" size={16} className="ag-spin" />}
            {printLabel}
          </button>
        </div>

        {(receiptError || (printResult && !printResult.ok)) && (
          <p
            className="mt-md animate-slide-up font-body-md text-body-md text-error"
            style={{ animationDelay: "0.25s" }}
          >
            {printResult && !printResult.ok ? printResult.message : receiptError}
          </p>
        )}
        {printResult?.ok && (
          <p
            className="mt-md flex animate-slide-up items-center gap-xs font-body-md text-body-md text-[#2e7d32]"
            style={{ animationDelay: "0.25s" }}
          >
            <Icon name="check_circle" size={16} fill /> Sent to the printer.
          </p>
        )}
      </main>
    </div>
  );
}
