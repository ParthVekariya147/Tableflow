import { useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useMoney } from "../store/AdminStore";
import type { PaymentMethod } from "../data/types";

interface CompleteState {
  method: PaymentMethod;
  totalCents: number;
  tableLabel: string;
}

export function PaymentCompletePage() {
  const navigate = useNavigate();
  const money = useMoney();
  const { state } = useLocation();
  const data = (state as CompleteState | null) ?? {
    method: "card",
    totalCents: 0,
    tableLabel: "Table",
  };

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
                {data.tableLabel} Free
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between pt-xs">
            <span className="font-body-md text-body-md text-on-surface-variant">Total Paid</span>
            <span className="font-data-mono text-data-mono text-lg text-on-background">
              {money(data.totalCents)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-body-md text-body-md text-on-surface-variant">Payment Method</span>
            <span className="flex items-center gap-xs font-body-md text-body-md capitalize text-on-background">
              <Icon name={data.method === "card" ? "credit_card" : "payments"} size={16} />
              {data.method}
            </span>
          </div>
        </div>

        <div
          className="flex w-full animate-slide-up flex-col justify-center gap-md sm:flex-row"
          style={{ animationDelay: "0.2s" }}
        >
          <button
            onClick={() => navigate("/tables")}
            className="flex-1 rounded-full bg-primary px-xl py-sm font-label-md text-label-md text-on-primary shadow-sm transition-colors hover:bg-primary-container sm:flex-none"
          >
            Back to Tables
          </button>
          <button
            onClick={() => window.print()}
            className="flex-1 rounded-full border border-primary bg-transparent px-xl py-sm font-label-md text-label-md text-primary transition-colors hover:bg-primary/5 sm:flex-none"
          >
            Print Receipt
          </button>
        </div>
      </main>
    </div>
  );
}
