import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { useMenu } from "../context/MenuContext";
import { useMoney } from "../money";
import FoodImage from "../components/FoodImage";
import DietaryMark from "../components/DietaryMark";
import TopAppBar from "../components/TopAppBar";

export default function MenuScreen() {
  const [activeCategory, setActiveCategory] = useState("All");
  const [search, setSearch] = useState("");
  const { setSheetItem, myOrderCount, myOrderTotal, bringThese } = useSession();
  const { items, categories, loading } = useMenu();
  const money = useMoney();
  const navigate = useNavigate();

  const q = search.trim().toLowerCase();
  // A guest searching means "find this dish on the menu", not "inside this tab" —
  // so a query searches everything and the tab row snaps back to All (below).
  const filtered = q
    ? items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.desc ?? "").toLowerCase().includes(q),
      )
    : activeCategory === "All"
      ? items
      : items.filter((i) => i.category === activeCategory);

  // The hero card is a browsing flourish; in results, every match is equal.
  const featured = q ? null : filtered[0];
  const rest = q ? filtered : filtered.slice(1);

  function onSearch(value) {
    setSearch(value);
    if (value.trim()) setActiveCategory("All");
  }

  return (
    <div className="min-h-screen pb-36">
      <TopAppBar />

      {/* Search + category tabs */}
      {/* Sits directly under the sticky TopAppBar, whose height is
          h-11 (2.75rem) + py-2 (1rem) = 3.75rem. In rem so the two stay
          locked together as the root font-size scales. */}
      <div className="sticky top-[3.75rem] z-40 bg-surface/95 backdrop-blur-md py-3 border-b border-outline-variant/20">
        <div className="px-5 pb-3">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[1.25rem] pointer-events-none">
              search
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search dishes…"
              aria-label="Search the menu"
              className="w-full rounded-full bg-surface-container py-2.5 pl-10 pr-10 text-[0.875rem] text-on-surface placeholder:text-on-surface-variant outline-none focus:ring-2 focus:ring-primary/40"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearch("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant active:scale-95"
              >
                <span className="material-symbols-outlined text-[1.125rem]">close</span>
              </button>
            )}
          </div>
        </div>
        <div className="flex overflow-x-auto hide-scrollbar gap-2 px-5">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`tap-target-sm flex-none inline-flex items-center px-4 py-1.5 rounded-full text-[0.8125rem] font-semibold whitespace-nowrap transition-all ${
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
          <div className="flex flex-col items-center gap-2 py-20 text-center text-on-surface-variant text-[0.875rem]">
            <span className="material-symbols-outlined text-[1.75rem] animate-spin">
              progress_activity
            </span>
            Loading menu…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="py-20 flex flex-col items-center gap-2 text-center text-on-surface-variant text-[0.875rem]">
            <span className="material-symbols-outlined text-[1.75rem]">
              {q ? "search_off" : "restaurant_menu"}
            </span>
            {q ? `No dishes match “${search.trim()}”.` : "No items in this category."}
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
                <span className="absolute top-3 left-3 bg-secondary-container text-on-secondary-container text-[0.6875rem] px-3 py-1 rounded-full font-semibold">
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
                <h2 className="text-[1.125rem] font-bold text-on-surface mb-1 font-serif">{featured.name}</h2>
                <p className="text-on-surface-variant text-[0.8125rem] line-clamp-2">{featured.desc}</p>
              </div>
              <span className="text-[1.25rem] font-bold text-primary">{money(featured.price)}</span>
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
                    <h3 className="text-[0.9375rem] font-bold text-on-surface leading-tight flex-1 pr-2">{item.name}</h3>
                    {item.badge && (
                      <span className="text-[0.625rem] font-semibold bg-secondary-container/50 text-on-secondary-container px-2 py-0.5 rounded-full flex-shrink-0">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-on-surface-variant text-[0.75rem] line-clamp-1 mt-0.5">{item.desc}</p>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-primary font-bold text-[0.9375rem]">{money(item.price)}</span>
                  <span className="text-[0.75rem] text-on-surface-variant font-medium flex items-center gap-1">
                    Tap to order <span className="material-symbols-outlined text-[0.875rem]">touch_app</span>
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>

      {/* My Order floating bar. The bottom offset is in rem so the bar keeps
          clearing the bottom nav as the root font-size scales the nav down on
          small phones. */}
      {myOrderCount > 0 && (
        <div className="fixed bottom-[4.5rem] left-0 right-0 px-4 z-40 md:max-w-md md:left-1/2 md:-translate-x-1/2 fade-in">
          <div className="bg-inverse-surface rounded-2xl px-4 py-3 flex items-center justify-between gap-3 shadow-xl">
            {/* min-w-0 + truncate: without it a long total pushed the two
                actions off the right edge instead of the text shrinking. */}
            <div className="min-w-0 flex-1">
              <p className="text-inverse-on-surface text-[0.875rem] font-bold truncate">My Order · {myOrderCount} item{myOrderCount !== 1 ? "s" : ""}</p>
              <p className="text-inverse-on-surface/60 text-[0.75rem] truncate">{money(myOrderTotal)} · not sent yet</p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={bringThese}
                className="tap-target-sm bg-primary text-on-primary text-[0.8125rem] font-bold px-4 py-2 rounded-full active:scale-95 transition-transform whitespace-nowrap"
              >
                Bring these
              </button>
              {/* Secondary, and the bottom nav already has a My Order tab —
                  under 360px its width is what forced the summary text into
                  an ellipsis, so drop it there. */}
              <button
                onClick={() => navigate("/order")}
                className="tap-target-sm max-[359px]:hidden bg-surface/20 text-inverse-on-surface text-[0.8125rem] font-bold px-3 py-2 rounded-full active:scale-95 transition-transform border border-white/20"
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
