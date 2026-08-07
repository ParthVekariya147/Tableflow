import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  isPrintingEnabled,
  type PrinterSettings,
  type Receipt,
} from "@amber/domain";
import { Icon } from "../components/Icon";
import { useAdmin, useMoney } from "../store/AdminStore";
import { api } from "../lib/api";
import { buildReceipt } from "../lib/receipt";
import { printReceipt, type PrintResult } from "../lib/printAgent";
import type { PaymentMethod } from "../data/types";

interface CompleteState {
  method: PaymentMethod;
  totalCents: number;
  tableLabel: string;
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
  /** Master switch (Settings → Printer). Off = this restaurant doesn't print,
   *  so the whole Print Receipt affordance is hidden, not just disabled.
   *  Starts false and is set from the fetched tenant, so the button never
   *  flashes into view before we know. */
  const [printingOn, setPrintingOn] = useState(false);
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
        setPrintingOn(isPrintingEnabled(tenant.printer));
        setReceipt(
          buildReceipt({
            orderId,
            tableId,
            tableLabel: data.tableLabel,
            tenant,
            order,
            payment,
          }),
        );
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
          {printingOn && (
            <button
              onClick={handlePrint}
              disabled={printing || !receipt || !printerSettings}
              className="flex flex-1 items-center justify-center gap-xs rounded-full border border-primary bg-transparent px-xl py-sm font-label-md text-label-md text-primary transition-colors hover:bg-primary/5 disabled:opacity-50 sm:flex-none"
            >
              {printing && <Icon name="progress_activity" size={16} className="ag-spin" />}
              {printLabel}
            </button>
          )}
        </div>

        {printingOn && (receiptError || (printResult && !printResult.ok)) && (
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
