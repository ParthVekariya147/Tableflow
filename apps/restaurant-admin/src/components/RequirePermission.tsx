import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Permission, TenantModule } from "@amber/domain";
import { TENANT_MODULE_META, isModuleEnabled } from "@amber/domain";
import { useTenant } from "@amber/ui";
import { useAuth } from "../context/AuthContext";
import { useTenantBrand } from "../context/TenantThemeGate";
import { homeRouteFor } from "../lib/nav";
import { Spinner } from "./Skeleton";

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-on-surface-variant">
      <p className="font-body-md text-body-md">{children}</p>
    </div>
  );
}

function FullScreenSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Spinner size={36} />
    </div>
  );
}

/**
 * Route guard. Redirects anonymous users to /login, and users who lack the
 * required permission to their own home route (hide, don't tease — a Kitchen
 * user typing /menu is bounced to /kds, not shown the page). With no `permission`
 * it just requires being signed in.
 *
 * `module` is the second, independent gate: a page belonging to a tenant module
 * that is switched off is unreachable even for a user who holds the permission,
 * so hiding it from the sidebar can't be undone by typing the URL or by a
 * bookmark from back when the module was on. The settings page that OWNS a
 * module's switch must never carry this prop — it is the way back on.
 */
export function RequirePermission({
  permission,
  module,
  children,
}: {
  permission?: Permission;
  module?: TenantModule;
  children: ReactNode;
}) {
  const { status, user, can } = useAuth();
  const tenant = useTenant();
  const { tenantResolved } = useTenantBrand();
  const location = useLocation();

  if (status === "loading") return <FullScreenSpinner />;
  if (status === "anon" || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  // A module verdict is only meaningful against the REAL tenant. Until it
  // lands, `useTenant()` is the platform placeholder, which reports every
  // optional module off — deciding on that would bounce a valid deep link.
  if (module && !tenantResolved) return <FullScreenSpinner />;

  const moduleOff = module ? !isModuleEnabled(tenant, module) : false;

  if (moduleOff || (permission && !can(permission))) {
    const home = homeRouteFor(user.permissions, tenant);
    // No allowed destination at all → show a neutral no-access state (no loop).
    if (!home || home === location.pathname) {
      return (
        <FullScreen>
          {moduleOff
            ? `${TENANT_MODULE_META[module!].label} is turned off for this restaurant. An admin can turn it back on in Settings.`
            : "You don't have access to this area. Ask an admin for permission."}
        </FullScreen>
      );
    }
    return <Navigate to={home} replace />;
  }

  return <>{children}</>;
}
