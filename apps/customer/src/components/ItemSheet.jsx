import { useState } from "react";
import { useSession } from "../context/SessionContext";

export default function ItemSheet() {
  const { sheetItem, setSheetItem, bringIt, addToOrder } = useSession();
  const [qty, setQty] = useState(1);

  if (!sheetItem) return null;

  const item = sheetItem;

  const handleBringIt = () => {
    bringIt(item, qty);
    setSheetItem(null);
    setQty(1);
  };

  const handleAddToOrder = () => {
    addToOrder(item, qty);
    setSheetItem(null);
    setQty(1);
  };

  return (
    <>
      {/* Backdrop — above the bottom nav (z-50) so the modal fully covers it */}
      <div
        className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
        onClick={() => { setSheetItem(null); setQty(1); }}
      />
      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-[60] slide-up md:max-w-md md:left-1/2 md:-translate-x-1/2">
        <div className="bg-surface rounded-t-3xl overflow-hidden shadow-2xl max-h-[92vh] flex flex-col">
          {/* Image */}
          <div className="h-72 overflow-hidden relative flex-shrink-0">
            {/* Drag handle */}
            <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-10 w-10 h-1.5 rounded-full bg-white/70" />
            <img src={item.img} alt={item.name} className="w-full h-full object-cover" />
            <button
              onClick={() => { setSheetItem(null); setQty(1); }}
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
              <span className="text-[22px] font-bold text-primary">${item.price.toFixed(2)}</span>
            </div>
            <p className="text-on-surface-variant text-[14px] mb-5">{item.desc}</p>

            {/* Qty selector */}
            <div className="flex items-center justify-between mb-5">
              <span className="text-[14px] font-semibold text-on-surface">Quantity</span>
              <div className="flex items-center gap-4 bg-surface-container rounded-full px-2 py-1">
                <button
                  onClick={() => setQty(Math.max(1, qty - 1))}
                  className="w-8 h-8 flex items-center justify-center active:scale-90 transition-transform"
                >
                  <span className="material-symbols-outlined text-[20px] text-on-surface">remove</span>
                </button>
                <span className="text-[18px] font-bold text-on-surface w-6 text-center">{qty}</span>
                <button
                  onClick={() => setQty(qty + 1)}
                  className="w-8 h-8 flex items-center justify-center active:scale-90 transition-transform"
                >
                  <span className="material-symbols-outlined text-[20px] text-primary">add</span>
                </button>
              </div>
            </div>

            {/* Action buttons — extra bottom padding clears the phone's home indicator */}
            <div className="flex gap-3 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
              <button
                onClick={handleBringIt}
                className="flex-1 bg-primary text-on-primary font-bold py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95 transition-transform shadow-md"
              >
                <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  local_shipping
                </span>
                Bring it
              </button>
              <button
                onClick={handleAddToOrder}
                className="flex-1 border-2 border-primary text-primary font-bold py-3.5 rounded-full flex items-center justify-center gap-2 active:scale-95 transition-transform"
              >
                <span className="material-symbols-outlined text-[18px]">add_shopping_cart</span>
                Add to order
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
