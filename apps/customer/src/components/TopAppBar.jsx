import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import { useBoot } from "../context/BootContext";

export default function TopAppBar({ showBack = false, title }) {
  const navigate = useNavigate();
  const { tableNumber } = useSession();
  const { tenant } = useBoot();
  // Default the title to the scanned tenant's name (not a hardcoded brand).
  const heading = title ?? tenant?.name ?? "Menu";

  return (
    <header className="sticky top-0 z-50 bg-surface/90 backdrop-blur-md border-b border-outline-variant/30">
      <div className="flex items-center justify-between gap-2 px-4 py-2 max-w-2xl mx-auto">
        {showBack ? (
          <button
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="tap-square w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-full transition-colors active:scale-95 hover:bg-surface-container-low cursor-pointer"
          >
            <span className="material-symbols-outlined text-on-surface-variant text-[1.375rem]">arrow_back</span>
          </button>
        ) : (
          <div aria-hidden="true" className="tap-square w-11 h-11 flex-shrink-0 flex items-center justify-center">
            <span className="material-symbols-outlined text-on-surface-variant text-[1.375rem]">local_cafe</span>
          </div>
        )}

        {/* Tenant names are arbitrary length — truncate the title rather than
            let it shove the table chip off the right edge. */}
        <h1 className="text-[1.125rem] font-semibold text-primary font-serif min-w-0 flex-1 text-center truncate">{heading}</h1>

        <div className="flex flex-shrink-0 items-center gap-1 bg-primary-container/30 px-3 py-1 rounded-full">
          <span className="material-symbols-outlined text-primary text-[0.875rem]" style={{ fontVariationSettings: "'FILL' 1" }}>
            table_restaurant
          </span>
          <span className="text-[0.8125rem] font-semibold text-on-primary-container">T{tableNumber}</span>
        </div>
      </div>
    </header>
  );
}
