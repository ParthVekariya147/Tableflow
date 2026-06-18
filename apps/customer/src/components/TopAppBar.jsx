import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";

export default function TopAppBar({ showBack = false, title = "Amber & Grain" }) {
  const navigate = useNavigate();
  const { tableNumber } = useSession();

  return (
    <header className="sticky top-0 z-50 bg-surface/90 backdrop-blur-md border-b border-outline-variant/30">
      <div className="flex items-center justify-between px-5 py-3 max-w-2xl mx-auto">
        <button
          onClick={() => showBack ? navigate(-1) : null}
          className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors active:scale-95 ${
            showBack ? "hover:bg-surface-container-low cursor-pointer" : "cursor-default"
          }`}
        >
          <span className="material-symbols-outlined text-on-surface-variant text-[22px]">
            {showBack ? "arrow_back" : "local_cafe"}
          </span>
        </button>

        <h1 className="text-[18px] font-semibold text-primary font-serif">{title}</h1>

        <div className="flex items-center gap-1 bg-primary-container/30 px-3 py-1 rounded-full">
          <span className="material-symbols-outlined text-primary text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
            table_restaurant
          </span>
          <span className="text-[13px] font-semibold text-on-primary-container">T{tableNumber}</span>
        </div>
      </div>
    </header>
  );
}
