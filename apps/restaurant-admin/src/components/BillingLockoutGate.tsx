import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { SubscriptionWithPlan } from "@amber/domain";
import { Icon } from "./Icon";
import { api } from "../lib/api";

const LOCKED_STATUSES: SubscriptionWithPlan["status"][] = ["past_due", "canceled"];

/**
 * Blocks the app behind a full-screen notice when the tenant's subscription
 * has lapsed — don't silently keep working, that's the point of having a
 * subscription. /settings/billing stays reachable so staff can see *why*
 * they're locked out. See PLATFORM_PLAN.md.
 */
export function BillingLockoutGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [subscription, setSubscription] = useState<SubscriptionWithPlan | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.billing
      .me()
      .then(setSubscription)
      .catch(() => setSubscription(null))
      .finally(() => setLoaded(true));
  }, []);

  const onBillingPage = location.pathname === "/settings/billing";
  const locked = loaded && subscription && LOCKED_STATUSES.includes(subscription.status);

  if (locked && !onBillingPage) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-md rounded-card bg-error-container/20 p-xl text-center">
        <Icon name="lock" size={40} className="text-error" />
        <h2 className="font-headline-md text-headline-md text-error">
          Subscription {subscription.status === "canceled" ? "Canceled" : "Past Due"}
        </h2>
        <p className="max-w-md font-body-md text-body-md text-on-surface-variant">
          This restaurant's subscription needs attention before the cockpit can be used again.
        </p>
        <Link
          to="/settings/billing"
          className="rounded-full bg-primary px-lg py-sm font-label-md text-label-md uppercase tracking-wider text-on-primary transition-colors hover:bg-primary-container"
        >
          View Plan &amp; Billing
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
