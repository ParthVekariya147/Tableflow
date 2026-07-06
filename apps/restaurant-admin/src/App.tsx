import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Shell } from "./components/Shell";
import { RequirePermission } from "./components/RequirePermission";
import { Spinner } from "./components/Skeleton";
import { useAuth } from "./context/AuthContext";

// Eagerly loaded — always needed on first paint
import { LoginPage } from "./pages/LoginPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";

// Lazy-loaded — each becomes its own chunk, fetched only when navigated to
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const MenuPage = lazy(() =>
  import("./pages/MenuPage").then((m) => ({ default: m.MenuPage })),
);
const TablesPage = lazy(() =>
  import("./pages/TablesPage").then((m) => ({ default: m.TablesPage })),
);
const TableSessionPage = lazy(() =>
  import("./pages/TableSessionPage").then((m) => ({ default: m.TableSessionPage })),
);
const BillingPage = lazy(() =>
  import("./pages/BillingPage").then((m) => ({ default: m.BillingPage })),
);
const BillingQueuePage = lazy(() =>
  import("./pages/BillingQueuePage").then((m) => ({ default: m.BillingQueuePage })),
);
const QuickSalePage = lazy(() =>
  import("./pages/QuickSalePage").then((m) => ({ default: m.QuickSalePage })),
);
const PaymentCompletePage = lazy(() =>
  import("./pages/PaymentCompletePage").then((m) => ({ default: m.PaymentCompletePage })),
);
const AnalyticsPage = lazy(() =>
  import("./pages/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })),
);
const OrderHistoryPage = lazy(() =>
  import("./pages/OrderHistoryPage").then((m) => ({ default: m.OrderHistoryPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const TeamPage = lazy(() =>
  import("./pages/TeamPage").then((m) => ({ default: m.TeamPage })),
);
const RolesPage = lazy(() =>
  import("./pages/RolesPage").then((m) => ({ default: m.RolesPage })),
);
const BrandingPage = lazy(() =>
  import("./pages/BrandingPage").then((m) => ({ default: m.BrandingPage })),
);
const PaymentsPage = lazy(() =>
  import("./pages/PaymentsPage").then((m) => ({ default: m.PaymentsPage })),
);
const LoyaltySettingsPage = lazy(() =>
  import("./pages/LoyaltySettingsPage").then((m) => ({ default: m.LoyaltySettingsPage })),
);
const LoyaltyPage = lazy(() =>
  import("./pages/LoyaltyPage").then((m) => ({ default: m.LoyaltyPage })),
);
const RestaurantProfilePage = lazy(() =>
  import("./pages/RestaurantProfilePage").then((m) => ({
    default: m.RestaurantProfilePage,
  })),
);
const PrinterPage = lazy(() =>
  import("./pages/PrinterPage").then((m) => ({ default: m.PrinterPage })),
);
const KdsPage = lazy(() =>
  import("./kds/KdsPage").then((m) => ({ default: m.KdsPage })),
);

function PageFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner size={36} />
    </div>
  );
}

/**
 * Restaurant Admin — the manager "cockpit".
 *
 * Shell-wrapped pages share the sidebar + top bar (Dashboard, Menu, Tables,
 * KDS, Analytics). Login, Billing and the post-payment confirmation render
 * full-screen without the shell, matching the prototype. All screens read/write
 * the in-memory AdminStore, so edits and take-backs propagate live.
 */
export default function App() {
  const { status, user } = useAuth();

  // Block the whole app behind a forced password change while the member is
  // still on the fixed `changeme123` default — rendered above the router
  // (same pattern the customer app uses for its terminal session screens) so
  // no route/permission combination can be used to route around it.
  if (status === "authed" && user?.mustChangePassword) {
    return <ChangePasswordPage />;
  }

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* Full-screen, no shell. Each guarded by the permission it needs — a user
            who lacks it is redirected to their own home route (hide, don't tease). */}
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/tables/:id/billing"
          element={
            <RequirePermission permission="tables.manage">
              <BillingPage />
            </RequirePermission>
          }
        />
        <Route
          path="/tables/:id/complete"
          element={
            <RequirePermission permission="tables.manage">
              <PaymentCompletePage />
            </RequirePermission>
          }
        />
        {/* Dedicated full-screen kitchen board (kitchen staff open this URL — no
            admin sidebar/top bar). Same live KDS as the in-shell /kds route. */}
        <Route
          path="/kds/display"
          element={
            <RequirePermission permission="kds.use">
              <KdsPage />
            </RequirePermission>
          }
        />

        {/* Shell-wrapped */}
        <Route element={<Shell />}>
          <Route
            path="/"
            element={
              <RequirePermission permission="dashboard.view">
                <DashboardPage />
              </RequirePermission>
            }
          />
          <Route
            path="/menu"
            element={
              <RequirePermission permission="menu.manage">
                <MenuPage />
              </RequirePermission>
            }
          />
          <Route
            path="/tables"
            element={
              <RequirePermission permission="tables.manage">
                <TablesPage />
              </RequirePermission>
            }
          />
          <Route
            path="/tables/:id"
            element={
              <RequirePermission permission="tables.manage">
                <TableSessionPage />
              </RequirePermission>
            }
          />
          <Route
            path="/quick-sale"
            element={
              <RequirePermission permission="tables.manage">
                <QuickSalePage />
              </RequirePermission>
            }
          />
          <Route
            path="/billing"
            element={
              <RequirePermission permission="tables.manage">
                <BillingQueuePage />
              </RequirePermission>
            }
          />
          <Route
            path="/history"
            element={
              <RequirePermission permission="orders.history">
                <OrderHistoryPage />
              </RequirePermission>
            }
          />
          <Route
            path="/analytics"
            element={
              <RequirePermission permission="analytics.view">
                <AnalyticsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/kds"
            element={
              <RequirePermission permission="kds.use">
                <KdsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings"
            element={
              <RequirePermission permission="settings.manage">
                <SettingsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings/team"
            element={
              <RequirePermission permission="team.manage">
                <TeamPage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings/roles"
            element={
              <RequirePermission permission="team.manage">
                <RolesPage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings/branding"
            element={
              <RequirePermission permission="settings.manage">
                <BrandingPage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings/payments"
            element={
              <RequirePermission permission="settings.manage">
                <PaymentsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings/loyalty"
            element={
              <RequirePermission permission="settings.manage">
                <LoyaltySettingsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/loyalty"
            element={
              <RequirePermission permission="loyalty.manage">
                <LoyaltyPage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings/profile"
            element={
              <RequirePermission permission="settings.manage">
                <RestaurantProfilePage />
              </RequirePermission>
            }
          />
          <Route
            path="/settings/printer"
            element={
              <RequirePermission permission="settings.manage">
                <PrinterPage />
              </RequirePermission>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
