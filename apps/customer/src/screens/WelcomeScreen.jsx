import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { mergeQuickActions } from "@amber/domain";
import { useSession } from "../context/SessionContext";
import { useMenu } from "../context/MenuContext";
import { useBoot } from "../context/BootContext";
import { useMoney } from "../money";
import FoodImage from "../components/FoodImage";

// Tailwind gradient per swatch — kept alongside the shared quick-action
// config (@amber/domain's quick-action.ts only carries the swatch *name*)
// since the actual gradient is a customer-app styling detail, not part of
// the cross-app contract.
const SWATCH_CLASSES = {
  neutral: "from-stone-100 to-stone-200",
  sky: "from-sky-100 to-blue-200",
  amber: "from-amber-100 to-orange-200",
  violet: "from-purple-100 to-violet-200",
  rose: "from-rose-100 to-pink-200",
  emerald: "from-emerald-100 to-teal-200",
};

// ── Menu item card ────────────────────────────────────────────────────────
function ItemCard({ item, onBringIt, onAdd, added, money }) {
  return (
    <div
      className={`w-[11.25rem] flex-shrink-0 rounded-3xl bg-surface-container-lowest shadow-[0px_2px_16px_rgba(26,26,26,0.07)] overflow-hidden transition-all active:scale-[0.97] ${
        added ? "ring-2 ring-primary" : ""
      }`}
    >
      <div className="relative h-[6.25rem] overflow-hidden">
        <FoodImage item={item} className="w-full h-full object-cover" />
        {item.badge && (
          <span className="absolute top-2 left-2 bg-secondary-container/90 text-on-secondary-container text-[0.625rem] px-2 py-0.5 rounded-full font-semibold backdrop-blur-sm">
            {item.badge}
          </span>
        )}
      </div>
      <div className="p-3 flex flex-col gap-2">
        <div>
          <p className="text-[0.8125rem] font-semibold text-on-surface line-clamp-1 leading-tight">
            {item.name}
          </p>
          <p className="text-[0.8125rem] font-bold text-primary mt-0.5">
            {item.price === 0 ? "Free" : money(item.price)}
          </p>
        </div>
        {/* `tap-target` holds these at a finger-sized 44px regardless of how
            far the root font-size scales down — they were 61x34px before,
            well under the WCAG 2.5.5 / HIG minimum. `whitespace-nowrap` keeps
            "Bring it" on one line in the narrow carousel card. */}
        <div className="flex gap-1.5">
          <button
            onClick={() => onBringIt(item)}
            className="tap-target flex-1 min-w-0 whitespace-nowrap px-1 bg-primary text-on-primary text-[0.6875rem] font-bold rounded-full active:scale-95 transition-transform"
          >
            Bring it
          </button>
          <button
            onClick={() => onAdd(item)}
            className={`tap-target flex-1 min-w-0 whitespace-nowrap px-1 text-[0.6875rem] font-bold rounded-full border active:scale-95 transition-transform ${
              added
                ? "bg-primary-container border-primary text-on-primary-container"
                : "border-outline-variant text-on-surface-variant"
            }`}
          >
            {added ? "✓" : "+ Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Quick-action card — renders both built-in + tenant-custom buttons, and
// the navigational Full Menu entry (kind:"full_menu", which never shows a
// "Sent" state) from one shared shape (@amber/domain's mergeQuickActions). ─
function QuickCard({ action, onTap, sent }) {
  const neutral = action.swatch === "neutral";
  return (
    <button
      onClick={() => onTap(action)}
      className={`min-w-0 flex flex-col items-center gap-2 py-4 px-1.5 rounded-3xl border transition-all active:scale-[0.96] ${
        sent
          ? "bg-primary-container border-primary"
          : "bg-surface-container-lowest border-outline-variant shadow-[0px_2px_12px_rgba(26,26,26,0.05)]"
      }`}
    >
      <div
        className={`w-12 h-12 flex-shrink-0 rounded-2xl flex items-center justify-center bg-gradient-to-br ${SWATCH_CLASSES[action.swatch] ?? SWATCH_CLASSES.neutral}`}
      >
        <span
          className={`material-symbols-outlined text-[1.5rem] drop-shadow-sm ${neutral ? "text-stone-500" : "text-white"}`}
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          {sent ? "check_circle" : action.icon}
        </span>
      </div>
      {/* Tenant-authored labels are free text, so they must be allowed to
          wrap rather than widen the card. */}
      <div className="text-center min-w-0 w-full">
        <p
          className={`text-[0.75rem] font-bold leading-tight ${
            sent ? "text-primary" : "text-on-surface"
          }`}
        >
          {action.label}
        </p>
        <p className="text-[0.625rem] text-on-surface-variant leading-tight mt-0.5 line-clamp-2">
          {sent ? "Sent ✓" : action.sublabel}
        </p>
      </div>
    </button>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────
export default function WelcomeScreen() {
  const navigate = useNavigate();
  const { tableNumber, bringIt, addToOrder, myOrderCount, sendServiceRequest, showToast } = useSession();
  const { welcome } = useMenu();
  const { tenant } = useBoot();
  const money = useMoney();
  const [added, setAdded] = useState(new Set());
  const [sent, setSent] = useState(new Set());
  // Pending "sent" reset timers, keyed by action.id — cleared on unmount so
  // a screen change before the 4s tick doesn't call setState on an unmounted
  // component.
  const sentTimersRef = useRef(new Map());

  // Tenant-configured row: built-in service requests + Full Menu (toggled/
  // reordered from restaurant-admin Settings → Quick Actions) plus any
  // custom buttons, merged against the defaults so an unconfigured tenant
  // still gets today's 4-button row.
  const quickActions = useMemo(
    () => mergeQuickActions(tenant?.quickActions).filter((a) => a.enabled),
    [tenant?.quickActions],
  );

  useEffect(() => {
    const timers = sentTimersRef.current;
    return () => {
      for (const id of timers.values()) clearTimeout(id);
      timers.clear();
    };
  }, []);

  async function handleQuickTap(action) {
    if (action.kind === "full_menu") {
      navigate("/menu");
      return;
    }
    if (sent.has(action.id)) return;
    // Optimistic — the server dedupes identical pending requests per table,
    // so a double-tap before this resolves is safe either way.
    setSent((prev) => new Set(prev).add(action.id));
    const id = setTimeout(() => {
      sentTimersRef.current.delete(action.id);
      setSent((prev) => { const n = new Set(prev); n.delete(action.id); return n; });
    }, 4000);
    sentTimersRef.current.set(action.id, id);
    try {
      await sendServiceRequest(action.id);
    } catch {
      showToast("Couldn't send — please try again", "error");
    }
  }

  function handleBringIt(item) {
    bringIt(item, 1);
    navigate("/status");
  }

  function handleAdd(item) {
    addToOrder(item, 1);
    setAdded((prev) => new Set(prev).add(item.id));
  }

  const sections = [
    { title: "Something to drink?", emoji: "🥤", items: welcome.drinks },
    { title: "Quick bite?", emoji: "🍽️", items: welcome.bites },
  ];

  return (
    <div className="min-h-screen bg-background pb-10">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="px-5 pt-10 pb-5 text-center">
        <div className="inline-flex items-center gap-1.5 bg-primary-container/40 text-on-primary-container px-4 py-1.5 rounded-full mb-3">
          <span
            className="material-symbols-outlined text-[0.875rem]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            table_restaurant
          </span>
          <span className="font-semibold text-[0.8125rem]">Table {tableNumber}</span>
        </div>
        <h1 className="text-[1.75rem] font-bold text-on-surface font-serif leading-tight">
          Welcome to{" "}
          <span className="text-primary">{tenant?.name ?? "our restaurant"}</span>
        </h1>
        <p className="text-on-surface-variant text-[0.875rem] mt-1">
          What can we get started for you?
        </p>
      </header>

      <main className="px-5 space-y-6">

        {/* ── Quick Actions ──────────────────────────────────────────────── */}
        <section>
          <p className="text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant mb-3">
            Quick actions
          </p>
          {/* A grid, not a single flex row: a tenant can enable up to 8
              actions (4 built-in + MAX_CUSTOM_QUICK_ACTIONS), which as
              flex-1 siblings squeezed each card to ~19px on a small phone.
              Four per row wraps instead, and keeps every card the same size. */}
          <div className="grid grid-cols-4 gap-2 sm:gap-3">
            {quickActions.map((action) => (
              <QuickCard
                key={action.id}
                action={action}
                onTap={handleQuickTap}
                sent={sent.has(action.id)}
              />
            ))}
          </div>
        </section>

        {/* ── Drink & Bite Carousels ──────────────────────────────────────── */}
        {sections.map((section) =>
          section.items.length === 0 ? null : (
            <section key={section.title}>
              <h2 className="text-[0.9375rem] font-semibold text-on-surface mb-3 flex items-center gap-2">
                <span>{section.emoji}</span>
                {section.title}
              </h2>
              <div className="flex overflow-x-auto hide-scrollbar gap-3 pb-1 -mx-5 px-5">
                {section.items.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    added={added.has(item.id)}
                    onBringIt={handleBringIt}
                    onAdd={handleAdd}
                    money={money}
                  />
                ))}
              </div>
            </section>
          ),
        )}

        {/* ── My Order banner ─────────────────────────────────────────────── */}
        {myOrderCount > 0 && (
          <div className="bg-primary-container/30 border border-primary/20 rounded-2xl p-4 flex justify-between items-center gap-3 fade-in">
            <div className="min-w-0 flex-1">
              <p className="text-[0.8125rem] font-semibold text-on-primary-container truncate">
                My Order · {myOrderCount} item{myOrderCount !== 1 ? "s" : ""}
              </p>
              <p className="text-[0.6875rem] text-on-surface-variant truncate">
                Added · send when ready
              </p>
            </div>
            <button
              onClick={() => navigate("/order")}
              className="tap-target-sm flex-shrink-0 bg-primary text-on-primary text-[0.75rem] font-bold px-4 py-2 rounded-full active:scale-95 transition-transform flex items-center gap-1 whitespace-nowrap"
            >
              View
              <span className="material-symbols-outlined text-[0.875rem]">
                arrow_forward
              </span>
            </button>
          </div>
        )}

        {/* ── Skip link ───────────────────────────────────────────────────── */}
        <div className="text-center pb-4">
          <button
            onClick={() => navigate("/menu")}
            className="tap-target text-primary/60 font-semibold inline-flex items-center justify-center gap-1.5 px-4 hover:text-primary transition-colors text-[0.875rem]"
          >
            Skip, take me to the full menu
            <span className="material-symbols-outlined text-[1rem]">
              arrow_forward
            </span>
          </button>
        </div>

      </main>
    </div>
  );
}
