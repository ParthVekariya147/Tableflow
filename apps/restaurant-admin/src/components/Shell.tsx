import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useTenant } from "@amber/ui";
import { SERVICE_REQUEST_META, type ServiceRequest } from "@amber/domain";
import { Icon } from "./Icon";
import { useAuth } from "../context/AuthContext";
import { useAdmin } from "../store/AdminStore";
import { useServiceRequests } from "../notifications/useServiceRequests";
import { NAV_ITEMS } from "../lib/nav";

const NAV_PREF_KEY = "amber-admin-nav";

function SideNav({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const navigate = useNavigate();
  const { can, logout } = useAuth();
  // The active tenant's brand (name + logo) — set by TenantThemeGate.
  const tenant = useTenant();
  // Live count of tables awaiting their bill, badged on the Billing nav item so
  // staff notice a rush of checkout requests without opening the page.
  const { state } = useAdmin();
  const awaitingBillCount = state.tables.filter((t) => t.status === "bill").length;

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
                  {item.to === "/billing" && awaitingBillCount > 0 && (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ffb300] px-xs font-label-md text-[11px] font-bold text-[#4e342e]">
                      {awaitingBillCount}
                    </span>
                  )}
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

/** Short "Xm ago" / "Xs ago" label, re-derived from a live tick so it counts up. */
function timeAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

/** Bell + dropdown for live guest service requests (water / call staff /
 *  call manager) — a notification channel fully separate from Order/KDS. */
function NotificationBell() {
  const { can } = useAuth();
  const { requests, pendingCount, acknowledge, resolve, muted, toggleMuted } =
    useServiceRequests();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);

  // Only re-render the "Xm ago" labels while the panel is actually open.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!can("tables.manage")) return null;

  async function handleAcknowledge(r: ServiceRequest) {
    try {
      await acknowledge(r.id);
    } catch {
      /* the stream will re-sync state either way */
    }
  }
  async function handleResolve(r: ServiceRequest) {
    try {
      await resolve(r.id);
    } catch {
      /* the stream will re-sync state either way */
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-full p-sm text-on-surface-variant transition-colors hover:bg-primary-container/10"
        aria-label="Service requests"
      >
        <Icon name="notifications" />
        {pendingCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-on-error">
            {pendingCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-outline-variant bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-outline-variant px-md py-sm">
            <span className="font-label-md text-label-md font-bold text-on-surface">
              Service requests
            </span>
            <button
              onClick={toggleMuted}
              title={muted ? "Unmute new-request sound" : "Mute new-request sound"}
              className="rounded-full p-1 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-primary"
            >
              <Icon name={muted ? "notifications_off" : "volume_up"} size={18} />
            </button>
          </div>
          {requests.length === 0 ? (
            <p className="px-md py-lg text-center text-body-md text-on-surface-variant">
              Nothing needs attention.
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {requests.map((r) => {
                const meta = SERVICE_REQUEST_META[r.type];
                return (
                  <li
                    key={r.id}
                    className="flex items-center gap-sm border-b border-outline-variant px-md py-sm last:border-0"
                  >
                    <Icon name={meta.icon} size={20} className="shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-body-md text-body-md font-medium text-on-surface">
                        Table {r.tableLabel} — {meta.label}
                      </p>
                      <p className="text-[11px] text-on-surface-variant">
                        {timeAgo(r.createdAt, now)}
                        {r.status === "acknowledged" ? " · Acknowledged" : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-xs">
                      {r.status === "pending" && (
                        <button
                          onClick={() => handleAcknowledge(r)}
                          className="rounded-full border border-outline-variant px-sm py-xs text-[11px] font-bold text-on-surface-variant hover:bg-surface-container-low"
                        >
                          Ack
                        </button>
                      )}
                      <button
                        onClick={() => handleResolve(r)}
                        className="rounded-full bg-primary px-sm py-xs text-[11px] font-bold text-on-primary hover:opacity-90"
                      >
                        Done
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
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
        <NotificationBell />
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
