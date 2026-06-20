import { useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";

const tabs = [
  { id: "menu",   path: "/menu",   label: "Menu",     icon: "restaurant_menu" },
  { id: "order",  path: "/order",  label: "My Order", icon: "shopping_bag" },
  { id: "status", path: "/status", label: "Status",   icon: "auto_timer" },
  { id: "bill",   path: "/bill",   label: "Bill",     icon: "receipt_long" },
];

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { myOrderCount, sessionEnded } = useSession();

  const hiddenPaths = ["/", "/welcome"];
  // Once the session is settled the visit is over — no nav back to ordering.
  if (sessionEnded || hiddenPaths.includes(location.pathname)) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl bg-surface/90 backdrop-blur-xl shadow-[0px_-4px_20px_rgba(26,26,26,0.06)] md:max-w-md md:left-1/2 md:-translate-x-1/2">
      <div className="flex justify-around items-center px-4 py-3">
        {tabs.map((tab) => {
          const isActive = location.pathname === tab.path;
          const showBadge = tab.id === "order" && myOrderCount > 0;
          return (
            <button
              key={tab.id}
              onClick={() => navigate(tab.path)}
              className={`flex flex-col items-center justify-center gap-0.5 relative transition-all duration-200 min-w-[56px] ${
                isActive ? "text-primary" : "text-on-surface-variant"
              }`}
            >
              <div className="relative">
                <span
                  className="material-symbols-outlined text-[24px] leading-none"
                  style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
                >
                  {tab.icon}
                </span>
                {showBadge && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-on-primary rounded-full text-[10px] font-bold flex items-center justify-center">
                    {myOrderCount}
                  </span>
                )}
              </div>
              <span className={`text-[11px] leading-none font-medium ${isActive ? "font-semibold" : ""}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
