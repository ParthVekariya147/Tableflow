import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { AuthUser } from "@amber/domain";
import { MaterialIcon } from "@amber/ui";
import { signOut } from "../lib/supabase";
import { api } from "../api";

const NAV = [
  { to: "/", label: "Dashboard", icon: "dashboard", end: true },
  { to: "/tenants", label: "Tenants", icon: "apartment" },
  { to: "/customers", label: "Customers", icon: "loyalty" },
  { to: "/credentials", label: "Credentials", icon: "key" },
  { to: "/plans", label: "Plans", icon: "sell" },
  { to: "/subscriptions", label: "Subscriptions", icon: "sync" },
  { to: "/audit-log", label: "Audit log", icon: "history" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

function SideNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<AuthUser | null>(null);

  useEffect(() => {
    api.auth.syncProfile().then(setProfile).catch(() => setProfile(null));
  }, []);

  async function handleLogout() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onClose}
        />
      )}
      <nav
        className={`fixed left-0 top-0 z-50 flex h-full w-[260px] flex-col border-r border-outline-variant bg-surface-container-lowest px-4 py-6 transition-transform duration-200 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-8 flex items-center gap-2 px-2">
          <button
            onClick={onClose}
            className="mr-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg hover:bg-surface-container-low md:hidden"
            aria-label="Close menu"
          >
            <MaterialIcon name="close" size={20} />
          </button>
          <MaterialIcon name="shield_person" filled size={28} className="text-primary" />
          <div>
            <h1 className="font-serif text-lg font-bold leading-tight text-primary">
              Platform Admin
            </h1>
            <span className="text-xs uppercase tracking-wide text-on-surface-variant">
              Super Admin
            </span>
          </div>
        </div>

        <ul className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-xl px-3 py-2 transition-colors ${
                    isActive
                      ? "bg-surface-container-low font-semibold text-primary"
                      : "text-on-surface-variant hover:bg-surface-container-low hover:text-primary"
                  }`
                }
              >
                <MaterialIcon name={item.icon} size={20} />
                <span className="text-sm">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="mt-auto border-t border-outline-variant pt-3">
          {profile && (
            <div className="mb-1 flex items-center gap-2 px-2 py-1">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-on-secondary">
                {profile.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 leading-tight">
                <div className="truncate text-sm font-semibold">{profile.name}</div>
                <div className="truncate text-xs text-on-surface-variant">
                  {profile.email}
                </div>
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-error transition-colors hover:bg-error-container hover:text-on-error-container"
          >
            <MaterialIcon name="logout" size={20} />
            <span className="text-sm">Log out</span>
          </button>
        </div>
      </nav>
    </>
  );
}

/** App shell: fixed sidebar on desktop, slide-in drawer on mobile. */
export function Shell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background text-on-background">
      {/* Mobile top bar */}
      <header className="fixed left-0 right-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-outline-variant bg-surface-container-lowest px-4 md:hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface-container-low"
          aria-label="Open menu"
        >
          <MaterialIcon name="menu" size={22} />
        </button>
        <MaterialIcon name="shield_person" filled size={22} className="text-primary" />
        <span className="font-serif font-bold text-primary">Platform Admin</span>
      </header>

      <SideNav open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="min-h-screen p-4 pt-[72px] md:ml-[260px] md:p-8 md:pt-8">
        <Outlet />
      </main>
    </div>
  );
}
