import { Icon } from "./Icon";
import { getActiveTenantSlug, isImpersonating } from "../lib/auth";

/**
 * Persistent strip shown whenever the active session is a master-password
 * impersonation token, so no one mistakes it for the tenant's own session.
 * See PLATFORM_PLAN.md "Master-password impersonation".
 */
export function ImpersonationBanner() {
  if (!isImpersonating()) return null;

  return (
    <div className="fixed left-[280px] right-0 top-0 z-[60] flex h-9 items-center justify-center gap-xs bg-error text-on-error">
      <Icon name="visibility" size={16} />
      <span className="font-label-md text-label-md uppercase tracking-wider">
        Viewing as platform support — {getActiveTenantSlug()}
      </span>
    </div>
  );
}
