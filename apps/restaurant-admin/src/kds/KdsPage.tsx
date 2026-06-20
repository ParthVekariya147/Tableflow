import { MaterialIcon, useTenant } from "@amber/ui";
import type { KdsStage } from "@amber/api-client";
import { useKds } from "./useKds";
import { KdsColumn } from "./KdsColumn";
import { useTick } from "./useTick";

const COLUMNS: { stage: KdsStage; title: string; badge?: string }[] = [
  { stage: "placed", title: "New", badge: "Pending" },
  { stage: "preparing", title: "Preparing" },
  { stage: "ready", title: "Ready" },
];

export function KdsPage() {
  const { tickets, connected, advance } = useKds();
  const tenant = useTenant();
  useTick(1000);

  const clock = new Date().toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="flex h-screen overflow-hidden bg-background text-on-surface">
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 flex justify-between items-center w-full px-6 bg-surface border-b border-outline-variant shrink-0 z-20">
          <div className="flex items-center gap-4">
            <span className="font-serif text-2xl font-bold text-primary italic">
              {tenant.name}
            </span>
            <div className="h-6 w-px bg-outline-variant" />
            <div className="flex flex-col -space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    connected ? "bg-tertiary animate-pulse" : "bg-error"
                  }`}
                />
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
                  {connected ? "Live System" : "Offline"}
                </span>
              </div>
              <span className="text-[12px] text-on-surface-variant font-bold">
                Main Kitchen • Station 01
              </span>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-[22px] font-serif font-semibold text-primary tabular-nums">
              {clock}
            </div>
            <span className="text-[14px] font-bold text-primary bg-secondary-fixed px-3 py-1 rounded-full border border-secondary">
              {tickets.length} Orders
            </span>
            <button className="text-primary hover:bg-surface-container-high transition-colors p-2 rounded-full">
              <MaterialIcon name="settings" size={20} />
            </button>
          </div>
        </header>

        {/* Board */}
        <div className="flex-1 overflow-hidden p-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          {COLUMNS.map((col) => (
            <KdsColumn
              key={col.stage}
              title={col.title}
              badge={col.badge}
              tickets={tickets.filter((t) => t.stage === col.stage)}
              onAdvance={advance}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
