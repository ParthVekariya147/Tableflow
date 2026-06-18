import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import menuData from "../data/menu.json";

function StarterCard({ item, onBringIt, onAdd, selected }) {
  return (
    <div className={`min-w-[140px] bg-surface-container-lowest rounded-2xl shadow-[0px_4px_16px_rgba(26,26,26,0.06)] overflow-hidden flex-shrink-0 transition-all ${selected ? "ring-2 ring-primary" : ""}`}>
      <div className="h-24 overflow-hidden">
        <img src={item.img} alt={item.name} className="w-full h-full object-cover" />
      </div>
      <div className="p-3 flex flex-col gap-2">
        <p className="text-[13px] font-semibold text-on-surface leading-tight truncate">{item.name}</p>
        <p className="text-[13px] font-bold text-primary">{item.price === 0 ? "Free" : `$${item.price}`}</p>
        <div className="flex gap-1.5">
          <button
            onClick={() => onBringIt(item)}
            className="flex-1 bg-primary text-on-primary text-[11px] font-bold py-1.5 rounded-full active:scale-95 transition-transform"
          >
            Bring it
          </button>
          <button
            onClick={() => onAdd(item)}
            className={`flex-1 text-[11px] font-bold py-1.5 rounded-full border active:scale-95 transition-transform ${
              selected ? "bg-primary-container border-primary text-on-primary-container" : "border-outline-variant text-on-surface-variant"
            }`}
          >
            {selected ? "Added" : "+ Order"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WelcomeScreen() {
  const navigate = useNavigate();
  const { tableNumber, bringIt, addToOrder, myOrderCount } = useSession();
  const [added, setAdded] = useState(new Set());

  const handleBringIt = (item) => {
    bringIt(item, 1);
    navigate("/status");
  };

  const handleAdd = (item) => {
    addToOrder(item, 1);
    setAdded((prev) => new Set(prev).add(item.id));
  };

  const sections = [
    { title: "Something to drink?", items: menuData.starters.drinks },
    { title: "Quick bites while you settle in?", items: menuData.starters.bites },
  ];

  return (
    <div className="min-h-screen bg-background pb-10">
      {/* Header */}
      <header className="px-5 pt-12 pb-6 text-center">
        <div className="inline-flex items-center gap-1.5 bg-primary-container/40 text-on-primary-container px-4 py-1.5 rounded-full mb-4">
          <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>table_restaurant</span>
          <span className="font-semibold text-[13px]">Table {tableNumber}</span>
        </div>
        <h1 className="text-[30px] font-bold text-on-surface font-serif leading-tight mb-2">
          Welcome to Amber & Grain
        </h1>
        <p className="text-on-surface-variant text-[16px]">
          Can we start you off with something while you settle in?
        </p>
      </header>

      {/* Starter sections */}
      <main>
        {sections.map((section, idx) => (
          <section key={idx} className="mb-6">
            <h2 className="text-[16px] font-semibold text-on-surface px-5 mb-3">{section.title}</h2>
            <div className="flex overflow-x-auto hide-scrollbar gap-3 px-5 pb-2">
              {section.items.map((item) => (
                <StarterCard
                  key={item.id}
                  item={item}
                  selected={added.has(item.id)}
                  onBringIt={handleBringIt}
                  onAdd={handleAdd}
                />
              ))}
            </div>
          </section>
        ))}

        {/* My Order banner if items queued */}
        {myOrderCount > 0 && (
          <div className="mx-5 bg-primary-container/30 border border-primary/20 rounded-2xl p-4 flex justify-between items-center mb-4 fade-in">
            <div>
              <p className="text-[13px] font-semibold text-on-primary-container">My Order · {myOrderCount} item{myOrderCount !== 1 ? "s" : ""}</p>
              <p className="text-[11px] text-on-surface-variant">Added to queue — send whenever you're ready</p>
            </div>
            <button
              onClick={() => navigate("/order")}
              className="bg-primary text-on-primary text-[12px] font-bold px-4 py-2 rounded-full active:scale-95 transition-transform flex items-center gap-1"
            >
              View <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </button>
          </div>
        )}

        {/* Skip link */}
        <div className="text-center mt-4 px-5">
          <button
            onClick={() => navigate("/menu")}
            className="text-primary/70 font-semibold inline-flex items-center gap-1.5 hover:text-primary transition-colors text-[15px]"
          >
            Skip, take me to the full menu
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
        </div>
      </main>
    </div>
  );
}
