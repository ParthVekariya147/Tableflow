import { useCallback, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useTenant } from "@amber/ui";
import { Icon } from "./Icon";
import { useAuth } from "../context/AuthContext";
import { NAV_ITEMS } from "../lib/nav";

const NAV_PREF_KEY = "amber-admin-nav";

function SideNav({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const navigate = useNavigate();
  const { user, can, logout } = useAuth();
  // The active tenant's brand (name + logo) — set by TenantThemeGate.
  const tenant = useTenant();

  // Hide, don't grey out: render only the destinations this user can reach.
  const nav = NAV_ITEMS.filter((item) => can(item.perm));

  function signOut() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <nav
      className={`fixed left-0 top-0 z-50 flex h-full w-[280px] flex-col border-r border-outline-variant bg-surface-container-lowest px-md py-lg shadow-md transition-transform duration-300 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="mb-xxl flex items-center gap-sm px-sm">
        {tenant.theme.logoUrl ? (
          <img
            src={tenant.theme.logoUrl}
            alt={tenant.name}
            className="h-10 w-10 rounded-card object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-card bg-primary text-[20px] font-bold text-on-primary">
            {tenant.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate font-headline-md text-[18px] font-bold leading-tight text-primary">
            {tenant.name}
          </h1>
          <span className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
            Powered by Amber
          </span>
        </div>
      </div>

      <ul className="flex flex-1 flex-col gap-xs">
        {nav.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex items-center gap-sm rounded-lg px-md py-sm transition-colors duration-200 ${
                  isActive
                    ? "border-r-4 border-primary bg-surface-container-low font-bold text-primary"
                    : "text-on-surface-variant hover:bg-surface-container-low hover:text-primary"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={item.icon} fill={isActive} />
                  <span className="font-label-md text-label-md">{item.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-col gap-xs border-t border-outline-variant pt-md">
        {can("settings.manage") && (
          <NavLink
            to="/settings"
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-sm rounded-lg px-md py-sm transition-colors duration-200 ${
                isActive
                  ? "border-r-4 border-primary bg-surface-container-low font-bold text-primary"
                  : "text-on-surface-variant hover:bg-surface-container-low hover:text-primary"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon name="settings" fill={isActive} />
                <span className="font-label-md text-label-md">Settings</span>
              </>
            )}
          </NavLink>
        )}
        <a
          href="#"
          className="flex items-center gap-sm rounded-lg px-md py-sm text-on-surface-variant transition-colors duration-200 hover:bg-surface-container-low hover:text-primary"
        >
          <Icon name="help" />
          <span className="font-label-md text-label-md">Support</span>
        </a>
        <button
          onClick={signOut}
          className="mt-sm flex items-center gap-sm rounded-lg px-md py-sm text-error transition-colors duration-200 hover:bg-error-container hover:text-on-error-container"
        >
          <Icon name="logout" />
          <span className="font-label-md text-label-md">Logout</span>
        </button>
      </div>
    </nav>
  );
}

function TopBar({
  navOpen,
  onToggleNav,
}: {
  navOpen: boolean;
  onToggleNav: () => void;
}) {
  const { user } = useAuth();
  return (
    <header
      className={`fixed right-0 top-0 z-40 flex h-20 items-center justify-between border-b border-outline-variant bg-surface px-md transition-all duration-300 md:px-xl ${
        navOpen ? "ml-0 w-full lg:ml-[280px] lg:w-[calc(100%-280px)]" : "ml-0 w-full"
      }`}
    >
      <div className="flex items-center gap-sm md:gap-lg">
        <button
          onClick={onToggleNav}
          title={navOpen ? "Hide sidebar" : "Show sidebar"}
          aria-label="Toggle sidebar"
          className="rounded-full p-sm text-on-surface-variant transition-colors hover:bg-primary-container/10"
        >
          <Icon name={navOpen ? "menu_open" : "menu"} />
        </button>
        <button className="rounded-full p-sm text-on-surface-variant transition-colors hover:bg-primary-container/10">
          <Icon name="search" />
        </button>
        <nav className="hidden items-center gap-lg md:flex">
          <a
            href="#"
            className="font-label-md text-label-md font-semibold text-primary after:absolute after:bottom-[-8px] after:left-0 after:h-[2px] after:w-full after:bg-primary relative"
          >
            Live Status
          </a>
          <a
            href="#"
            className="rounded-lg px-sm py-xs font-label-md text-label-md text-on-surface-variant transition-colors hover:bg-primary-container/10"
          >
            Global Orders
          </a>
        </nav>
      </div>

      <div className="flex items-center gap-md">
        <button className="relative rounded-full p-sm text-on-surface-variant transition-colors hover:bg-primary-container/10">
          <Icon name="notifications" />
          <span className="absolute right-2 top-1 h-2 w-2 rounded-full bg-error" />
        </button>
        <button className="rounded-full p-sm text-on-surface-variant transition-colors hover:bg-primary-container/10">
          <Icon name="sync" />
        </button>
        <div className="mx-sm h-8 w-px bg-outline-variant" />
        <div className="flex cursor-pointer items-center gap-sm transition-opacity hover:opacity-80">
          <div className="text-right">
            <span className="block font-label-md text-label-md leading-tight text-on-surface">
              {user?.name ?? "Signed in"}
            </span>
            <span className="block font-body-md text-[11px] leading-tight text-on-surface-variant">
              {user?.roleName ?? "Active Shift"}
            </span>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-outline-variant bg-secondary-container text-primary">
            <Icon name="person" />
          </div>
        </div>
      </div>
    </header>
  );
}

const isDesktop = () =>
  typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;

/** App shell: responsive sidebar + top bar, with routed pages in the main canvas. */
export function Shell() {
  // On desktop the sidebar pushes content and remembers your last on/off choice.
  // On tablet/phone it's an overlay drawer that defaults closed (so content gets
  // the full width) and we ignore the persisted desktop preference.
  const [navOpen, setNavOpen] = useState(() => {
    if (!isDesktop()) return false;
    try {
      return localStorage.getItem(NAV_PREF_KEY) !== "closed";
    } catch {
      return true;
    }
  });

  // Persist only on an explicit toggle, and only for the desktop layout, so the
  // mobile drawer never clobbers the desktop preference.
  const toggleNav = useCallback(() => {
    setNavOpen((open) => {
      const next = !open;
      if (isDesktop()) {
        try {
          localStorage.setItem(NAV_PREF_KEY, next ? "open" : "closed");
        } catch {
          /* storage unavailable — keep in-memory only */
        }
      }
      return next;
    });
  }, []);

  // After navigating on a small screen, close the overlay drawer.
  const closeOnMobile = useCallback(() => {
    if (!isDesktop()) setNavOpen(false);
  }, []);

  return (
    <div className="min-h-screen bg-background text-on-background">
      <SideNav open={navOpen} onNavigate={closeOnMobile} />

      {/* Scrim behind the overlay drawer on small screens (tap to close). */}
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-[45] bg-on-background/40 backdrop-blur-sm lg:hidden"
          aria-hidden
        />
      )}

      <TopBar navOpen={navOpen} onToggleNav={toggleNav} />
      <main
        className={`mt-20 min-h-[calc(100vh-80px)] p-md transition-[margin] duration-300 md:p-xl ${
          navOpen ? "ml-0 lg:ml-[280px]" : "ml-0"
        }`}
      >
        <div className="mx-auto max-w-container-max">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
