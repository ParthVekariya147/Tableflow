import { useSession } from "../context/SessionContext";
import TopAppBar from "../components/TopAppBar";

const STATUS_ORDER = ["placed", "preparing", "served"];
const STATUS_CONFIG = {
  placed:    { icon: "receipt",             label: "Placed",    color: "text-secondary bg-secondary-container/40" },
  preparing: { icon: "local_fire_department", label: "Preparing", color: "text-primary bg-primary-container",      pulse: true },
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

function RoundCard({ round, onAdvance }) {
  const allServed = round.items.every((i) => i.status === "served");
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
        {round.items.map((item) => (
          <div key={item.id} className="p-4">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h4 className="font-bold text-on-surface text-[15px]">{item.name}</h4>
                <p className="text-[12px] text-on-surface-variant">Qty {item.qty}</p>
              </div>
              <span className="font-bold text-on-surface text-[14px]">${(item.price * item.qty).toFixed(2)}</span>
            </div>
            <div className="flex gap-2">
              {STATUS_ORDER.map((stage) => (
                <StatusPill key={stage} status={item.status} stage={stage} />
              ))}
            </div>
            {/* Prototype: tap to advance status */}
            {item.status !== "served" && (
              <button
                onClick={() => onAdvance(round.id, item.id)}
                className="mt-2 w-full text-[11px] text-on-surface-variant/50 text-center py-1 border border-dashed border-outline-variant/30 rounded-lg"
              >
                [Demo: advance status →]
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StatusScreen() {
  const { rounds, advanceStatus, tableNumber } = useSession();

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
              <RoundCard key={round.id} round={round} onAdvance={advanceStatus} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
