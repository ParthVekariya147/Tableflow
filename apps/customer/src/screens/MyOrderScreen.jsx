import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { useMoney } from "../money";
import FoodImage from "../components/FoodImage";
import TopAppBar from "../components/TopAppBar";

export default function MyOrderScreen() {
  const navigate = useNavigate();
  const { myOrder, updateOrderQty, removeFromOrder, myOrderTotal, myOrderCount, bringThese } = useSession();
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
            <span className="material-symbols-outlined text-[40px] text-on-surface-variant">shopping_bag</span>
          </div>
          <h2 className="text-[22px] font-bold text-on-surface font-serif">Nothing here yet</h2>
          <p className="text-on-surface-variant text-[15px]">Browse the menu and add what you'd like — or tap "Bring it" for instant orders.</p>
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
          <h2 className="text-[24px] font-bold text-on-surface font-serif">My Order</h2>
          <p className="text-on-surface-variant text-[13px]">Not sent yet — add what you want, then send it all at once.</p>
        </div>

        <div className="flex flex-col gap-3 mt-5">
          {myOrder.map((item) => (
            <div key={item.lineKey} className="bg-surface-container-lowest rounded-2xl shadow-[0px_2px_12px_rgba(26,26,26,0.04)] overflow-hidden fade-in">
              <div className="flex">
                <div className="w-20 h-20 flex-shrink-0 overflow-hidden">
                  <FoodImage item={item} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 p-3">
                  <div className="flex justify-between items-start">
                    <h3 className="text-[15px] font-bold text-on-surface">{item.name}</h3>
                    <span className="text-primary font-bold text-[14px]">{money(item.price * item.qty)}</span>
                  </div>
                  {item.modifiers?.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {item.modifiers.map((m, i) => (
                        <li key={i} className="text-[11px] text-on-surface-variant">
                          {m.textValue ? `“${m.textValue}”` : m.name}
                          {m.priceCents > 0 ? ` +${money(m.price)}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[12px] text-on-surface-variant mt-0.5">{money(item.price)} each</p>
                </div>
              </div>
              <div className="flex justify-between items-center px-4 py-2.5 border-t border-surface-container">
                <button
                  onClick={() => removeFromOrder(item.lineKey)}
                  className="flex items-center gap-1 text-on-surface-variant text-[12px] active:text-error transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">delete</span> Remove
                </button>
                <div className="flex items-center bg-surface-container rounded-full px-1">
                  <button
                    onClick={() => updateOrderQty(item.lineKey, -1)}
                    className="w-8 h-8 flex items-center justify-center active:scale-90 transition-transform"
                  >
                    <span className="material-symbols-outlined text-[18px]">remove</span>
                  </button>
                  <span className="w-6 text-center font-bold text-[15px]">{item.qty}</span>
                  <button
                    onClick={() => updateOrderQty(item.lineKey, 1)}
                    className="w-8 h-8 flex items-center justify-center active:scale-90 transition-transform"
                  >
                    <span className="material-symbols-outlined text-[18px] text-primary">add</span>
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Note field */}
          <button className="w-full bg-transparent border-2 border-dashed border-outline-variant rounded-2xl p-4 flex items-center justify-center gap-2 text-on-surface-variant hover:text-primary transition-colors">
            <span className="material-symbols-outlined text-[20px]">edit_note</span>
            <span className="font-medium text-[14px]">Add a note for the kitchen</span>
          </button>
        </div>

        {/* Summary + CTA */}
        <div className="mt-6 pt-4 border-t border-outline-variant/30">
          <div className="flex justify-between items-center mb-1">
            <span className="text-on-surface-variant text-[14px]">Subtotal ({myOrderCount} items)</span>
            <span className="font-bold text-on-surface">{money(myOrderTotal)}</span>
          </div>
          <p className="text-[11px] text-on-surface-variant/60 mb-5">Taxes calculated at checkout</p>

          <button
            onClick={handleBringThese}
            className="w-full bg-primary text-on-primary font-bold py-4 rounded-full flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition-transform text-[16px]"
          >
            Bring these to our table
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
          <button
            onClick={() => navigate("/menu")}
            className="w-full text-center mt-3 text-primary/70 font-semibold text-[14px] py-2"
          >
            Keep browsing
          </button>
        </div>
      </main>
    </div>
  );
}
