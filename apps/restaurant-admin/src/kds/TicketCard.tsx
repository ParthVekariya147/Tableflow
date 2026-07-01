import { MaterialIcon } from "@amber/ui";
import type { KdsStage, KdsTicket } from "@amber/api-client";
import { useTick, formatElapsed } from "./useTick";

/** Per-stage card chrome: accent bar, action button, icon + label. */
const STAGE_UI: Record<
  Exclude<KdsStage, "served">,
  {
    accent: string;
    button: string;
    actionLabel: string;
    actionIcon: string;
    typeColor: string;
  }
> = {
  placed: {
    accent: "bg-tertiary",
    button: "bg-primary-container text-on-primary",
    actionLabel: "START",
    actionIcon: "play_arrow",
    typeColor: "text-tertiary",
  },
  preparing: {
    accent: "bg-secondary-container",
    button: "bg-secondary-container text-on-secondary-container",
    actionLabel: "MARK READY",
    actionIcon: "check",
    typeColor: "text-secondary",
  },
  ready: {
    accent: "bg-outline",
    button:
      "border border-outline-variant text-on-surface-variant hover:bg-surface-container-high",
    actionLabel: "SERVED",
    actionIcon: "done_all",
    typeColor: "text-tertiary",
  },
};

function timerColor(seconds: number): string {
  if (seconds >= 600) return "text-error"; // 10 min+
  if (seconds >= 300) return "text-tertiary"; // 5 min+
  return "text-on-surface";
}

export function TicketCard({
  ticket,
  onAdvance,
  advancing = false,
}: {
  ticket: KdsTicket;
  onAdvance: (ticket: KdsTicket) => void;
  advancing?: boolean;
}) {
  useTick(1000); // keep the elapsed timer ticking
  const ui = STAGE_UI[ticket.stage as Exclude<KdsStage, "served">];
  if (!ui) return null;

  const elapsedSec = Math.max(
    0,
    (Date.now() - new Date(ticket.createdAt).getTime()) / 1000,
  );
  const isReady = ticket.stage === "ready";
  const placedAt = new Date(ticket.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const typeLabel = ticket.type === "instant" ? "Bring it" : "Order";

  return (
    <article
      className={`bg-surface rounded-lg shadow-sm relative overflow-hidden transition-card shrink-0 ${
        isReady ? "border-2 border-transparent pulse-ready" : "border border-outline-variant"
      }`}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${ui.accent}`} />
      <div className="p-3">
        {/* Header */}
        <div className="flex justify-between items-start mb-2">
          <div>
            <h3 className="font-serif text-[18px] font-semibold leading-tight">
              {ticket.tableLabel}
            </h3>
            <p className="text-[10px] text-on-surface-variant">{placedAt}</p>
          </div>
          <div className="flex flex-col items-end">
            <span
              className={`text-[18px] font-semibold leading-tight tabular-nums ${
                isReady ? "text-error" : timerColor(elapsedSec)
              }`}
            >
              {isReady ? "READY" : formatElapsed(elapsedSec)}
            </span>
            <span className={`text-[10px] uppercase font-bold ${ui.typeColor}`}>
              {typeLabel}
            </span>
          </div>
        </div>

        {/* Items */}
        <div className="space-y-1 mb-3 border-y border-outline-variant py-2">
          {ticket.items.map((item) => (
            <div
              key={item.id}
              className="flex justify-between text-sm text-on-surface"
            >
              <span>
                {item.qty}x {item.name}
                {item.notes ? (
                  <span className="text-on-surface-variant italic">
                    {" "}
                    · {item.notes}
                  </span>
                ) : null}
              </span>
              {item.ref ? (
                <span className="text-on-surface-variant text-[11px]">
                  {item.ref}
                </span>
              ) : null}
            </div>
          ))}
        </div>

        {/* Round-level note */}
        {ticket.note ? (
          <div className="bg-surface-container px-2 py-1.5 rounded mb-3 flex gap-2 items-start">
            <MaterialIcon
              name="sticky_note_2"
              size={14}
              className="text-secondary mt-0.5"
            />
            <p className="text-[11px] text-on-surface-variant italic">
              {ticket.note}
            </p>
          </div>
        ) : null}

        {/* Action */}
        <button
          onClick={() => onAdvance(ticket)}
          disabled={advancing}
          className={`w-full py-2 rounded-full font-bold text-[12px] tracking-wide flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-70 disabled:active:scale-100 ${ui.button}`}
        >
          <MaterialIcon
            name={advancing ? "progress_activity" : ui.actionIcon}
            size={16}
            className={advancing ? "ag-spin" : ""}
          />
          {advancing ? "Updating…" : ui.actionLabel}
        </button>
      </div>
    </article>
  );
}
