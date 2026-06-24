import { Routes, Route, Navigate } from "react-router-dom";
import { Shell } from "./components/Shell";
import { RequirePermission } from "./components/RequirePermission";
import { DashboardPage } from "./pages/DashboardPage";
import { MenuPage } from "./pages/MenuPage";
import { TablesPage } from "./pages/TablesPage";
import { TableSessionPage } from "./pages/TableSessionPage";
import { BillingPage } from "./pages/BillingPage";
import { PaymentCompletePage } from "./pages/PaymentCompletePage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { OrderHistoryPage } from "./pages/OrderHistoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TeamPage } from "./pages/TeamPage";
import { RolesPage } from "./pages/RolesPage";
import { BrandingPage } from "./pages/BrandingPage";
import { LoginPage } from "./pages/LoginPage";
import { KdsPage } from "./kds/KdsPage";

/**
 * Restaurant Admin — the manager "cockpit".
 *
 * Shell-wrapped pages share the sidebar + top bar (Dashboard, Menu, Tables,
 * KDS, Analytics). Login, Billing and the post-payment confirmation render
 * full-screen without the shell, matching the prototype. All screens read/write
 * the in-memory AdminStore, so edits and take-backs propagate live.
 */
export default function App() {
  return (
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
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
