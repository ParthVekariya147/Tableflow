import { Link } from "react-router-dom";
import { useTenant } from "@amber/ui";
import type { TenantModule } from "@amber/domain";
import { TENANT_MODULE_META, isModuleEnabled } from "@amber/domain";
import { useAuth } from "../context/AuthContext";
import { Icon } from "../components/Icon";

interface Card {
  to: string;
  icon: string;
  title: string;
  desc: string;
  ready?: boolean;
  /**
   * Set when this card is the home of a tenant module's master switch. Such a
   * card is ALWAYS listed — even with the module off, because it is the only
   * way back on — but is dimmed and chipped "Off" so the state is legible from
   * the landing grid. Every other surface of that module is gone entirely.
   */
  module?: TenantModule;
}

const CARDS: Card[] = [
  {
    to: "/settings/team",
    icon: "group",
    title: "Team",
    desc: "Add people, set roles, grant or revoke access.",
    ready: true,
  },
  {
    to: "/settings/roles",
    icon: "shield_person",
    title: "Roles",
    desc: "Create custom roles and choose their permissions.",
    ready: true,
  },
  {
    to: "/settings/profile",
    icon: "storefront",
    title: "Restaurant Profile",
    desc: "Name, currency, tax rate, and GST number.",
    ready: true,
  },
  {
    to: "/settings/branding",
    icon: "palette",
    title: "Branding",
    desc: "Colors, fonts, and logo for your restaurant.",
    ready: true,
  },
  {
    to: "/settings/payments",
    icon: "payments",
    title: "Payments",
    desc: "Configure UPI for instant QR-code billing at checkout.",
    ready: true,
  },
  {
    to: "/settings/loyalty",
    icon: "loyalty",
    title: "Loyalty",
    desc: "Reward returning guests with points on every visit.",
    ready: true,
    module: "loyalty",
  },
  {
    to: "/settings/printer",
    icon: "print",
    title: "Printer",
    desc: "Connect a thermal receipt printer via a local print agent.",
    ready: true,
    module: "printing",
  },
  {
    to: "/settings/quick-actions",
    icon: "bolt",
    title: "Quick Actions",
    desc: "Customize the guest Welcome screen's action buttons.",
    ready: true,
  },
];

/**
 * Settings landing — a grid of cards (Microsoft-style) routing to focused pages.
 * Gated by `settings.manage` (Admin only). Team & Roles are live; the rest are
 * placeholders for follow-up slices — see SETTINGS.md.
 *
 * Cards carrying a `module` (Printer, Loyalty) are the one place a switched-off
 * module still appears — see the `Card.module` note above and the module
 * registry in `@amber/domain`.
 */
export function SettingsPage() {
  const { user } = useAuth();
  const tenant = useTenant();
  return (
    <div className="space-y-lg">
      <header>
        <h1 className="font-headline-md text-headline-md text-on-surface">Settings</h1>
        <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
          Signed in as {user?.name} · {user?.roleName}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((card, i) => {
          const disabled = !card.ready;
          const off = !!card.module && !isModuleEnabled(tenant, card.module);
          const inner = (
            <div
              className={`flex h-full flex-col gap-sm rounded-card border border-outline-variant bg-surface-container-lowest p-lg transition-colors ${
                disabled ? "opacity-60" : "hover:border-primary hover:bg-surface-container-low"
              } ${off ? "opacity-70" : ""}`}
            >
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-card ${
                  off
                    ? "bg-surface-variant text-on-surface-variant"
                    : "bg-primary-container/20 text-primary"
                }`}
              >
                <Icon name={card.icon} />
              </div>
              <h2 className="flex items-center gap-xs font-label-md text-[15px] font-bold text-on-surface">
                {card.title}
                {off && (
                  <span className="rounded-full bg-surface-variant px-sm py-[1px] font-label-md text-[10px] uppercase tracking-wider text-on-surface-variant">
                    Off
                  </span>
                )}
              </h2>
              <p className="font-body-md text-body-md text-on-surface-variant">
                {off ? TENANT_MODULE_META[card.module!].offDescription : card.desc}
              </p>
            </div>
          );
          return disabled ? (
            <div key={`${card.title}-${i}`}>{inner}</div>
          ) : (
            <Link key={`${card.title}-${i}`} to={card.to}>
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
