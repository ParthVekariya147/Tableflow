import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Permission } from "@amber/domain";
import { useAuth } from "../context/AuthContext";
import { homeRouteFor } from "../lib/nav";

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-on-surface-variant">
      <p className="font-body-md text-body-md">{children}</p>
    </div>
  );
}

/**
 * Route guard. Redirects anonymous users to /login, and users who lack the
 * required permission to their own home route (hide, don't tease — a Kitchen
 * user typing /menu is bounced to /kds, not shown the page). With no `permission`
 * it just requires being signed in.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission?: Permission;
  children: ReactNode;
}) {
  const { status, user, can } = useAuth();
  const location = useLocation();

  if (status === "loading") return <FullScreen>Loading…</FullScreen>;
  if (status === "anon" || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (permission && !can(permission)) {
    const home = homeRouteFor(user.permissions);
    // No allowed destination at all → show a neutral no-access state (no loop).
    if (!home || home === location.pathname) {
      return (
        <FullScreen>
          You don't have access to this area. Ask an admin for permission.
        </FullScreen>
      );
    }
    return <Navigate to={home} replace />;
  }

  return <>{children}</>;
}
