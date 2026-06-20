import type { KdsTicket } from "@amber/api-client";
import { TicketCard } from "./TicketCard";

/** One board column (NEW / PREPARING / READY). */
export function KdsColumn({
  title,
  badge,
  tickets,
  onAdvance,
}: {
  title: string;
  badge?: string;
  tickets: KdsTicket[];
  onAdvance: (ticket: KdsTicket) => void;
}) {
  return (
    <section className="flex flex-col h-full bg-surface-container-low rounded-lg border border-outline-variant overflow-hidden">
      <div className="px-4 py-2 bg-surface-bright border-b border-outline-variant flex justify-between items-center sticky top-0 z-10 shadow-sm">
        <h2 className="text-[13px] font-bold text-primary flex items-center gap-2 uppercase tracking-widest">
          {title}
          <span className="text-[12px] font-normal text-on-surface-variant opacity-60">
            ({tickets.length})
          </span>
        </h2>
        {badge ? (
          <span className="bg-secondary-container text-on-secondary-container text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
            {badge}
          </span>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar flex flex-col">
        {tickets.length === 0 ? (
          <p className="text-center text-[12px] text-on-surface-variant/50 py-6">
            No tickets
          </p>
        ) : (
          tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              onAdvance={onAdvance}
            />
          ))
        )}
      </div>
    </section>
  );
}
