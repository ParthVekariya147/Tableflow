import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { useMoney } from "../money";
import FoodImage from "../components/FoodImage";
import TopAppBar from "../components/TopAppBar";

export default function MyOrderScreen() {
  const navigate = useNavigate();
  const { myOrder, updateOrderQty, removeFromOrder, updateOrderNote, myOrderTotal, myOrderCount, bringThese } = useSession();
  const money = useMoney();

  const handleBringThese = () => {
    bringThese();
    navigate("/status");
  };

  if (myOrderCount === 0) {
    return (
      <div className="min-h-screen pb-28">
        <TopAppBar title="My Order" showBack />
        <div className="flex flex-col items-center justify-center px-6 pt-24 text-center gap-4">
          <div className="w-20 h-20 rounded-full bg-surface-container flex items-center justify-center">
            <span className="material-symbols-outlined text-[2.5rem] text-on-surface-variant">shopping_bag</span>
          </div>
          <h2 className="text-[1.375rem] font-bold text-on-surface font-serif">Nothing here yet</h2>
          <p className="text-on-surface-variant text-[0.9375rem]">Browse the menu and add what you'd like — or tap "Bring it" for instant orders.</p>
          <button
            onClick={() => navigate("/menu")}
            className="mt-2 bg-primary text-on-primary font-semibold px-6 py-3 rounded-full active:scale-95 transition-transform"
          >
            Browse menu
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-36">
      <TopAppBar title="My Order" showBack />

      <main className="px-5 py-4 max-w-lg mx-auto">
        <div className="mb-2">
          <h2 className="text-[1.5rem] font-bold text-on-surface font-serif">My Order</h2>
          <p className="text-on-surface-variant text-[0.8125rem]">Not sent yet — add what you want, then send it all at once.</p>
        </div>

        <div className="flex flex-col gap-3 mt-5">
          {myOrder.map((item) => (
            <CartItemRow
              key={item.lineKey}
              item={item}
              money={money}
              updateOrderQty={updateOrderQty}
              removeFromOrder={removeFromOrder}
              updateOrderNote={updateOrderNote}
            />
          ))}
        </div>

        {/* Summary + CTA */}
        <div className="mt-6 pt-4 border-t border-outline-variant/30">
          <div className="flex justify-between items-center mb-1">
            <span className="text-on-surface-variant text-[0.875rem]">Subtotal ({myOrderCount} items)</span>
            <span className="font-bold text-on-surface">{money(myOrderTotal)}</span>
          </div>
          <p className="text-[0.6875rem] text-on-surface-variant/60 mb-5">Taxes calculated at checkout</p>

          <button
            onClick={handleBringThese}
            className="w-full bg-primary text-on-primary font-bold py-4 rounded-full flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition-transform text-[1rem]"
          >
            Bring these to our table
            <span className="material-symbols-outlined text-[1.125rem]">arrow_forward</span>
          </button>
          <button
            onClick={() => navigate("/menu")}
            className="tap-target w-full text-center mt-3 text-primary/70 font-semibold text-[0.875rem] py-2"
          >
            Keep browsing
          </button>
        </div>
      </main>
    </div>
  );
}

function CartItemRow({ item, money, updateOrderQty, removeFromOrder, updateOrderNote }) {
  const [editingNote, setEditingNote] = useState(false);

  return (
    <div className="bg-surface-container-lowest rounded-2xl shadow-[0px_2px_12px_rgba(26,26,26,0.04)] overflow-hidden fade-in">
      <div className="flex">
        <div className="w-20 h-20 flex-shrink-0 overflow-hidden">
          <FoodImage item={item} className="w-full h-full object-cover" />
        </div>
        <div className="flex-1 p-3">
          <div className="flex justify-between items-start gap-2">
            <h3 className="text-[0.9375rem] font-bold text-on-surface min-w-0 flex-1">{item.name}</h3>
            <span className="text-primary font-bold text-[0.875rem] flex-shrink-0 tabular-nums">{money(item.price * item.qty)}</span>
          </div>
          {item.modifiers?.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {item.modifiers.map((m, i) => (
                <li key={i} className="text-[0.6875rem] text-on-surface-variant">
                  {m.textValue ? `“${m.textValue}”` : m.name}
                  {m.priceCents > 0 ? ` +${money(m.price)}` : ""}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[0.75rem] text-on-surface-variant mt-0.5">{money(item.price)} each</p>
          {item.note && !editingNote && (
            <p className="text-[0.75rem] text-primary mt-1 italic">“{item.note}”</p>
          )}
        </div>
      </div>

      {editingNote && (
        <div className="px-3 pb-3">
          <textarea
            autoFocus
            rows={2}
            maxLength={200}
            defaultValue={item.note ?? ""}
            onBlur={(e) => {
              updateOrderNote(item.lineKey, e.target.value.trim());
              setEditingNote(false);
            }}
            placeholder="e.g. less spicy, no onion…"
            className="w-full resize-none rounded-xl border border-outline-variant bg-surface-container px-3 py-2 text-[0.8125rem] text-on-surface outline-none focus:border-primary"
          />
        </div>
      )}

      {/* Row wraps rather than squashing: on a 320px screen "Remove" +
          "Add note" + the qty stepper do not fit on one line. */}
      <div className="flex flex-wrap gap-y-1 justify-between items-center px-4 py-2 border-t border-surface-container">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => removeFromOrder(item.lineKey)}
            className="tap-target-sm flex items-center gap-1 pr-2 text-on-surface-variant text-[0.75rem] active:text-error transition-colors"
          >
            <span className="material-symbols-outlined text-[1rem]">delete</span> Remove
          </button>
          <button
            onClick={() => setEditingNote((v) => !v)}
            className="tap-target-sm flex items-center gap-1 pr-2 text-on-surface-variant text-[0.75rem] active:text-primary transition-colors"
          >
            <span className="material-symbols-outlined text-[1rem]">edit_note</span>
            {item.note ? "Edit note" : "Add note"}
          </button>
        </div>
        {/* Qty steppers are the most-tapped control on this screen and were
            28x28 — sized in px so they stay finger-sized on small phones. */}
        <div className="flex items-center bg-surface-container rounded-full px-1 flex-shrink-0">
          <button
            onClick={() => updateOrderQty(item.lineKey, -1)}
            aria-label="Decrease quantity"
            className="tap-square w-11 h-11 flex items-center justify-center active:scale-90 transition-transform"
          >
            <span className="material-symbols-outlined text-[1.125rem]">remove</span>
          </button>
          <span className="w-6 text-center font-bold text-[0.9375rem] tabular-nums">{item.qty}</span>
          <button
            onClick={() => updateOrderQty(item.lineKey, 1)}
            aria-label="Increase quantity"
            className="tap-square w-11 h-11 flex items-center justify-center active:scale-90 transition-transform"
          >
            <span className="material-symbols-outlined text-[1.125rem] text-primary">add</span>
          </button>
        </div>
      </div>
    </div>
  );
}
