import { useEffect, useState } from "react";
import { useSession } from "../context/SessionContext";
import { useMoney } from "../money";
import FoodImage from "./FoodImage";
import DietaryMark from "./DietaryMark";

/** Initial selection state per group: "" for single/text, [] for multiple/toggle. */
function initSelections(groups) {
  const s = {};
  for (const g of groups) {
    s[g.id] = g.inputType === "single" || g.inputType === "text" ? "" : [];
  }
  return s;
}

export default function ItemSheet() {
  const { sheetItem, setSheetItem, bringIt, addToOrder } = useSession();
  const money = useMoney();
  const [qty, setQty] = useState(1);
  const [sel, setSel] = useState({});
  const [note, setNote] = useState("");

  const groups = sheetItem?.modifierGroups ?? [];

  // Reset qty + selections whenever a different item opens.
  useEffect(() => {
    setQty(1);
    setSel(initSelections(sheetItem?.modifierGroups ?? []));
    setNote("");
  }, [sheetItem?.id]);

  if (!sheetItem) return null;
  const item = sheetItem;

  const close = () => setSheetItem(null);

  // ── Selection helpers ───────────────────────────────────────────────────────
  const setSingle = (gid, optionId) =>
    setSel((s) => ({ ...s, [gid]: s[gid] === optionId ? "" : optionId }));
  const toggleMany = (gid, optionId, max) =>
    setSel((s) => {
      const cur = s[gid] ?? [];
      if (cur.includes(optionId)) return { ...s, [gid]: cur.filter((x) => x !== optionId) };
      if (max != null && cur.length >= max) return s; // respect maxSelect
      return { ...s, [gid]: [...cur, optionId] };
    });
  const setText = (gid, value) => setSel((s) => ({ ...s, [gid]: value }));

  // ── Build the chosen-modifier payload + validate required groups ────────────
  const chosen = [];
  let valid = true;
  for (const g of groups) {
    if (g.inputType === "text") {
      const text = (sel[g.id] ?? "").trim();
      if (text) chosen.push({ groupName: g.name, name: "", price: 0, priceCents: 0, textValue: text });
      else if (g.required) valid = false;
    } else {
      const ids = g.inputType === "single" ? (sel[g.id] ? [sel[g.id]] : []) : (sel[g.id] ?? []);
      for (const id of ids) {
        const opt = g.options.find((o) => o.id === id);
        if (opt) chosen.push({ optionId: opt.id, groupName: g.name, name: opt.name, price: opt.price, priceCents: opt.priceCents });
      }
      const min = g.required ? Math.max(g.minSelect ?? 0, 1) : g.minSelect ?? 0;
      if (ids.length < min) valid = false;
    }
  }

  const unitPrice = item.price + chosen.reduce((s, m) => s + m.price, 0);

  const handleBringIt = () => {
    if (!valid) return;
    bringIt(item, qty, chosen, note.trim());
    close();
  };
  const handleAddToOrder = () => {
    if (!valid) return;
    addToOrder(item, qty, chosen, note.trim());
    close();
  };

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" onClick={close} />
      <div className="fixed bottom-0 left-0 right-0 z-[60] slide-up md:max-w-md md:left-1/2 md:-translate-x-1/2">
        <div className="bg-surface rounded-t-3xl overflow-hidden shadow-2xl max-h-[92vh] flex flex-col">
          {/* Image */}
          <div className="h-60 overflow-hidden relative flex-shrink-0">
            <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-10 w-10 h-1.5 rounded-full bg-white/70" />
            <FoodImage item={item} className="w-full h-full object-cover" />
            <button
              onClick={close}
              className="absolute top-3 right-3 w-9 h-9 bg-surface/80 backdrop-blur rounded-full flex items-center justify-center active:scale-95"
            >
              <span className="material-symbols-outlined text-[20px] text-on-surface">close</span>
            </button>
            {item.badge && (
              <span className="absolute top-3 left-3 bg-secondary-container text-on-secondary-container text-[11px] px-3 py-1 rounded-full font-semibold">
                {item.badge}
              </span>
            )}
          </div>

          {/* Content */}
          <div className="p-5 overflow-y-auto">
            <div className="flex justify-between items-start mb-1">
              <h2 className="text-[22px] font-bold text-on-surface font-serif flex-1 pr-4">{item.name}</h2>
              <span className="text-[22px] font-bold text-primary">{money(unitPrice)}</span>
            </div>
            {(item.dietary || item.jain) && (
              <div className="mb-2">
                <DietaryMark dietary={item.dietary} jain={item.jain} size={18} />
              </div>
            )}
            <p className="text-on-surface-variant text-[14px] mb-5">{item.desc}</p>

            {/* Modifier groups */}
            {groups.map((g) => (
              <div key={g.id} className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[14px] font-bold text-on-surface">{g.name}</h3>
                  <span className="text-[11px] text-on-surface-variant">
                    {g.required ? "Required" : "Optional"}
                    {g.inputType === "multiple" && g.maxSelect ? ` · up to ${g.maxSelect}` : ""}
                  </span>
                </div>

                {/* text */}
                {g.inputType === "text" && (
                  <textarea
                    rows={2}
                    maxLength={g.maxLength ?? undefined}
                    value={sel[g.id] ?? ""}
                    onChange={(e) => setText(g.id, e.target.value)}
                    placeholder={g.placeholder || "Add a note…"}
                    className="w-full resize-none rounded-2xl border border-outline-variant bg-surface-container px-4 py-3 text-[14px] text-on-surface outline-none focus:border-primary"
                  />
                )}

                {/* single / multiple / toggle */}
                {g.inputType !== "text" &&
                  g.options
                    .filter((o) => o.available !== false)
                    .map((o) => {
                      const selectedIds = g.inputType === "single" ? (sel[g.id] ? [sel[g.id]] : []) : (sel[g.id] ?? []);
                      const on = selectedIds.includes(o.id);
                      const onPick = () =>
                        g.inputType === "single"
                          ? setSingle(g.id, o.id)
                          : toggleMany(g.id, o.id, g.maxSelect);
                      return (
                        <button
                          key={o.id}
                          onClick={onPick}
                          className="w-full flex items-center justify-between py-2.5 px-1 active:opacity-70"
                        >
                          <span className="flex items-center gap-3">
                            <Indicator kind={g.inputType} on={on} />
                            <span className="text-[14px] text-on-surface">{o.name}</span>
                          </span>
                          <span className="text-[13px] text-on-surface-variant">
                            {o.priceCents > 0 ? `+${money(o.price)}` : o.priceCents < 0 ? money(o.price) : ""}
                          </span>
                        </button>
                      );
                    })}
              </div>
            ))}

            {/* Note for the kitchen */}
            <div className="mb-5">
              <h3 className="text-[14px] font-bold text-on-surface mb-2">Note for the kitchen</h3>
              <textarea
                rows={2}
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. less spicy, no onion…"
                className="w-full resize-none rounded-2xl border border-outline-variant bg-surface-container px-4 py-3 text-[14px] text-on-surface outline-none focus:border-primary"
              />
            </div>

            {/* Qty selector */}
            <div className="flex items-center justify-between mb-5">
              <span className="text-[14px] font-semibold text-on-surface">Quantity</span>
              <div className="flex items-center gap-4 bg-surface-container rounded-full px-2 py-1">
                <button onClick={() => setQty(Math.max(1, qty - 1))} className="w-8 h-8 flex items-center justify-center active:scale-90 transition-transform">
                  <span className="material-symbols-outlined text-[20px] text-on-surface">remove</span>
                </button>
                <span className="text-[18px] font-bold text-on-surface w-6 text-center">{qty}</span>
                <button onClick={() => setQty(qty + 1)} className="w-8 h-8 flex items-center justify-center active:scale-90 transition-transform">
                  <span className="material-symbols-outlined text-[20px] text-primary">add</span>
                </button>
              </div>
            </div>

            {!valid && (
              <p className="text-[12px] text-error mb-3 text-center">Please complete the required options above.</p>
            )}

            {/* Action buttons */}
            <div className="flex gap-3 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
              <button
                onClick={handleBringIt}
                disabled={!valid}
                className="flex-1 bg-primary text-on-primary font-bold py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95 transition-transform shadow-md disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>local_shipping</span>
                Bring it · {money(unitPrice * qty)}
              </button>
              <button
                onClick={handleAddToOrder}
                disabled={!valid}
                className="flex-1 border-2 border-primary text-primary font-bold py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">add_shopping_cart</span>
                Add
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** The radio dot / checkbox / switch indicator next to an option. */
function Indicator({ kind, on }) {
  if (kind === "toggle") {
    return (
      <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${on ? "bg-primary" : "bg-surface-container-highest"}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
      </span>
    );
  }
  const round = kind === "single";
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center border-2 ${round ? "rounded-full" : "rounded-md"} ${on ? "border-primary bg-primary text-on-primary" : "border-outline-variant text-transparent"}`}
    >
      <span className="material-symbols-outlined text-[14px]">{round ? "circle" : "check"}</span>
    </span>
  );
}
