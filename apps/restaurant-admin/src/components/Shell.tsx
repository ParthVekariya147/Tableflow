import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Icon } from "./Icon";
import { useAuth } from "../context/AuthContext";
import { NAV_ITEMS } from "../lib/nav";

function SideNav() {
  const navigate = useNavigate();
  const { user, can, logout } = useAuth();
  // Hide, don't grey out: render only the destinations this user can reach.
  const nav = NAV_ITEMS.filter((item) => can(item.perm));

  function signOut() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <nav className="fixed left-0 top-0 z-50 flex h-full w-[280px] flex-col border-r border-outline-variant bg-surface-container-lowest px-md py-lg shadow-md">
      <div className="mb-xxl flex items-center gap-sm px-sm">
        <div className="flex h-10 w-10 items-center justify-center rounded-card bg-primary text-[20px] font-bold text-on-primary">
          A
        </div>
        <div>
          <h1 className="font-headline-md text-[18px] font-bold leading-tight text-primary">
            Amber &amp; Grain
          </h1>
          <span className="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
            Main Kitchen
          </span>
        </div>
      </div>

      <ul className="flex flex-1 flex-col gap-xs">
        {nav.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
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

function TopBar() {
  const { user } = useAuth();
  return (
    <header className="fixed right-0 top-0 z-40 ml-[280px] flex h-20 w-[calc(100%-280px)] items-center justify-between border-b border-outline-variant bg-surface px-xl">
      <div className="flex items-center gap-lg">
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

/** App shell: fixed sidebar + top bar, with routed pages in the main canvas. */
export function Shell() {
  return (
    <div className="min-h-screen bg-background text-on-background">
      <SideNav />
      <TopBar />
      <main className="ml-[280px] mt-20 min-h-[calc(100vh-80px)] p-xl">
        <div className="mx-auto max-w-container-max">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
