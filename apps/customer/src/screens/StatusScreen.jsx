import { useSession } from "../context/SessionContext";
import TopAppBar from "../components/TopAppBar";

const STATUS_ORDER = ["placed", "preparing", "ready", "served"];
const STATUS_CONFIG = {
  placed:    { icon: "receipt",             label: "Placed",    color: "text-secondary bg-secondary-container/40" },
  preparing: { icon: "local_fire_department", label: "Preparing", color: "text-primary bg-primary-container",      pulse: true },
  ready:     { icon: "done_all",            label: "Ready",     color: "text-amber-700 bg-amber-100",            pulse: true },
  served:    { icon: "room_service",        label: "Served",    color: "text-green-700 bg-green-100" },
};

function StatusPill({ status, stage }) {
  const isDone = STATUS_ORDER.indexOf(stage) <= STATUS_ORDER.indexOf(status);
  const isActive = stage === status;
  const cfg = STATUS_CONFIG[stage];

  return (
    <div className={`flex-1 py-2.5 rounded-xl flex flex-col items-center gap-1 relative overflow-hidden transition-all ${
      isActive ? cfg.color : isDone ? "bg-surface-container text-on-surface-variant/60" : "border border-outline-variant/30 text-outline/40"
    }`}>
      {isActive && cfg.pulse && <div className="pulse-ring" />}
      <span className="material-symbols-outlined text-[18px] relative z-10" style={{ fontVariationSettings: "'FILL' 1" }}>
        {cfg.icon}
      </span>
      <span className="text-[10px] font-bold relative z-10">{cfg.label}</span>
    </div>
  );
}

function RoundCard({ round }) {
  // "Done" = served OR cancelled, so a round of served+cancelled items still
  // reads as finished (cancelled lines aren't pending kitchen work).
  const allServed =
    round.items.length > 0 &&
    round.items.every((i) => i.status === "served" || i.status === "cancelled");
  const time = round.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const label = round.type === "instant" ? "Instant" : `Round`;

  return (
    <div className={`bg-surface-container-lowest rounded-2xl shadow-[0px_2px_12px_rgba(26,26,26,0.04)] overflow-hidden transition-all fade-in ${allServed ? "opacity-70" : ""}`}>
      {/* Round header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-container">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold ${allServed ? "bg-green-100 text-green-700" : "bg-primary-container text-on-primary-container"}`}>
            {allServed
              ? <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
              : <span className="material-symbols-outlined text-[14px]">receipt</span>
            }
          </div>
          <span className="text-[13px] font-semibold text-on-surface-variant uppercase tracking-wide">{label} · {time}</span>
        </div>
        {allServed && (
          <span className="text-[11px] font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">All served ✓</span>
        )}
      </div>

      {/* Items */}
      <div className="divide-y divide-surface-container">
        {round.items.map((item) => {
          const cancelled = item.status === "cancelled";
          return (
            <div key={item.lineKey ?? item.id} className={`p-4 ${cancelled ? "opacity-70" : ""}`}>
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h4 className={`font-bold text-[15px] ${cancelled ? "text-on-surface-variant line-through" : "text-on-surface"}`}>{item.name}</h4>
                  {item.modifiers?.length > 0 && (
                    <p className={`text-[11px] text-on-surface-variant ${cancelled ? "line-through" : ""}`}>
                      {item.modifiers.map((m) => (m.textValue ? `“${m.textValue}”` : m.name)).join(", ")}
                    </p>
                  )}
                  <p className="text-[12px] text-on-surface-variant">Qty {item.qty}</p>
                </div>
                <span className={`font-bold text-[14px] ${cancelled ? "text-on-surface-variant line-through" : "text-on-surface"}`}>${(item.price * item.qty).toFixed(2)}</span>
              </div>
              {cancelled ? (
                <div className="flex items-center justify-center gap-1.5 rounded-xl bg-red-50 py-2.5 text-red-700">
                  <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>cancel</span>
                  <span className="text-[11px] font-bold uppercase tracking-wide">Cancelled by restaurant</span>
                </div>
              ) : (
                <div className="flex gap-2">
                  {STATUS_ORDER.map((stage) => (
                    <StatusPill key={stage} status={item.status} stage={stage} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function StatusScreen() {
  const { rounds } = useSession();

  // Amount accrued onto the session so far — items the kitchen has marked served.
  const servedTotal = rounds.reduce(
    (s, r) => s + r.items.filter((i) => i.status === "served").reduce((rs, i) => rs + i.price * i.qty, 0),
    0,
  );

  return (
    <div className="min-h-screen pb-28">
      <TopAppBar title="Your Orders" />

      <main className="px-5 py-4 max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[22px] font-bold text-on-surface font-serif">Order Status</h2>
          <div className="flex items-center gap-2 bg-surface-container px-3 py-1.5 rounded-full">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-[11px] font-semibold text-on-surface-variant">Live</span>
          </div>
        </div>

        {rounds.length > 0 && (
          <div className="mb-5 flex items-center justify-between bg-surface-container-lowest rounded-2xl px-4 py-3 shadow-[0px_2px_12px_rgba(26,26,26,0.04)]">
            <span className="text-[13px] text-on-surface-variant flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[18px] text-green-700" style={{ fontVariationSettings: "'FILL' 1" }}>room_service</span>
              Served so far
            </span>
            <span className="text-[16px] font-bold text-on-surface">${servedTotal.toFixed(2)}</span>
          </div>
        )}

        {rounds.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-16 text-center gap-4">
            <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center">
              <span className="material-symbols-outlined text-[32px] text-on-surface-variant">auto_timer</span>
            </div>
            <p className="text-on-surface-variant text-[15px]">No orders yet.<br />Start by ordering something from the menu.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {rounds.map((round) => (
              <RoundCard key={round.id} round={round} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
