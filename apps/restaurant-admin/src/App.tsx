import { Routes, Route, Navigate } from "react-router-dom";
import { Shell } from "./components/Shell";
import { DashboardPage } from "./pages/DashboardPage";
import { MenuPage } from "./pages/MenuPage";
import { TablesPage } from "./pages/TablesPage";
import { TableSessionPage } from "./pages/TableSessionPage";
import { BillingPage } from "./pages/BillingPage";
import { PaymentCompletePage } from "./pages/PaymentCompletePage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
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
      {/* Full-screen, no shell */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/tables/:id/billing" element={<BillingPage />} />
      <Route path="/tables/:id/complete" element={<PaymentCompletePage />} />

      {/* Shell-wrapped */}
      <Route element={<Shell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/tables" element={<TablesPage />} />
        <Route path="/tables/:id" element={<TableSessionPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/kds" element={<KdsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
