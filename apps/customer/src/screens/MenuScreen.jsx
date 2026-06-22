import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { useMenu } from "../context/MenuContext";
import FoodImage from "../components/FoodImage";
import DietaryMark from "../components/DietaryMark";
import TopAppBar from "../components/TopAppBar";

export default function MenuScreen() {
  const [activeCategory, setActiveCategory] = useState("All");
  const { setSheetItem, myOrderCount, myOrderTotal, bringThese } = useSession();
  const { items, categories, loading } = useMenu();
  const navigate = useNavigate();

  const filtered = activeCategory === "All"
    ? items
    : items.filter((i) => i.category === activeCategory);

  const featured = filtered[0];
  const rest = filtered.slice(1);

  return (
    <div className="min-h-screen pb-36">
      <TopAppBar />

      {/* Category tabs */}
      <div className="sticky top-[57px] z-40 bg-surface/95 backdrop-blur-md py-3 border-b border-outline-variant/20">
        <div className="flex overflow-x-auto hide-scrollbar gap-2 px-5">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`flex-none px-4 py-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap transition-all ${
                activeCategory === cat
                  ? "bg-primary text-on-primary shadow-sm"
                  : "bg-surface-container text-on-surface-variant"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <main className="px-5 py-4 max-w-2xl mx-auto">
        {loading && (
          <div className="py-20 text-center text-on-surface-variant text-[14px]">
            Loading menu…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="py-20 text-center text-on-surface-variant text-[14px]">
            No items in this category.
          </div>
        )}
        {/* Featured card */}
        {featured && (
          <article
            onClick={() => setSheetItem(featured)}
            className="mb-4 bg-surface-container-lowest rounded-2xl shadow-[0px_4px_20px_rgba(26,26,26,0.05)] overflow-hidden cursor-pointer active:scale-[0.99] transition-all group"
          >
            <div className="h-48 overflow-hidden relative">
              <FoodImage item={featured} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
              {featured.badge && (
                <span className="absolute top-3 left-3 bg-secondary-container text-on-secondary-container text-[11px] px-3 py-1 rounded-full font-semibold">
                  {featured.badge}
                </span>
              )}
              {(featured.dietary || featured.jain) && (
                <div className="absolute top-3 right-3 rounded-md bg-white/85 p-1 shadow-sm backdrop-blur-sm">
                  <DietaryMark dietary={featured.dietary} jain={featured.jain} size={20} />
                </div>
              )}
            </div>
            <div className="p-4 flex justify-between items-end">
              <div className="flex-1 pr-4">
                <h2 className="text-[18px] font-bold text-on-surface mb-1 font-serif">{featured.name}</h2>
                <p className="text-on-surface-variant text-[13px] line-clamp-2">{featured.desc}</p>
              </div>
              <span className="text-[20px] font-bold text-primary">${featured.price.toFixed(2)}</span>
            </div>
          </article>
        )}

        {/* Rest of items */}
        <div className="flex flex-col gap-3">
          {rest.map((item) => (
            <article
              key={item.id}
              onClick={() => setSheetItem(item)}
              className="bg-surface-container-lowest rounded-2xl shadow-[0px_2px_12px_rgba(26,26,26,0.04)] overflow-hidden flex cursor-pointer active:scale-[0.99] transition-all group"
            >
              <div className="relative w-24 h-24 flex-shrink-0 overflow-hidden">
                <FoodImage item={item} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                {(item.dietary || item.jain) && (
                  <div className="absolute top-1.5 right-1.5 rounded-md bg-white/85 p-0.5 shadow-sm backdrop-blur-sm">
                    <DietaryMark dietary={item.dietary} jain={item.jain} size={16} />
                  </div>
                )}
              </div>
              <div className="flex-1 p-3 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start">
                    <h3 className="text-[15px] font-bold text-on-surface leading-tight flex-1 pr-2">{item.name}</h3>
                    {item.badge && (
                      <span className="text-[10px] font-semibold bg-secondary-container/50 text-on-secondary-container px-2 py-0.5 rounded-full flex-shrink-0">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-on-surface-variant text-[12px] line-clamp-1 mt-0.5">{item.desc}</p>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-primary font-bold text-[15px]">${item.price.toFixed(2)}</span>
                  <span className="text-[12px] text-on-surface-variant font-medium flex items-center gap-1">
                    Tap to order <span className="material-symbols-outlined text-[14px]">touch_app</span>
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>

      {/* My Order floating bar */}
      {myOrderCount > 0 && (
        <div className="fixed bottom-[72px] left-0 right-0 px-4 z-40 md:max-w-md md:left-1/2 md:-translate-x-1/2 fade-in">
          <div className="bg-inverse-surface rounded-2xl px-4 py-3 flex items-center justify-between shadow-xl">
            <div>
              <p className="text-inverse-on-surface text-[14px] font-bold">My Order · {myOrderCount} item{myOrderCount !== 1 ? "s" : ""}</p>
              <p className="text-inverse-on-surface/60 text-[12px]">${myOrderTotal.toFixed(2)} · not sent yet</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={bringThese}
                className="bg-primary text-on-primary text-[13px] font-bold px-4 py-2 rounded-full active:scale-95 transition-transform"
              >
                Bring these
              </button>
              <button
                onClick={() => navigate("/order")}
                className="bg-surface/20 text-inverse-on-surface text-[13px] font-bold px-3 py-2 rounded-full active:scale-95 transition-transform border border-white/20"
              >
                Edit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
