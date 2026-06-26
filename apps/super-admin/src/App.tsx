import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { RequireSession } from "./components/RequireSession";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { TenantsPage } from "./pages/TenantsPage";
import { TenantDetailPage } from "./pages/TenantDetailPage";
import { TenantEditPage } from "./pages/TenantEditPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { PlansPage } from "./pages/PlansPage";
import { SubscriptionsPage } from "./pages/SubscriptionsPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireSession />}>
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          <Route path="tenants" element={<TenantsPage />} />
          <Route path="tenants/new" element={<OnboardingPage />} />
          <Route path="tenants/:id" element={<TenantDetailPage />} />
          <Route path="tenants/:id/edit" element={<TenantEditPage />} />
          <Route path="plans" element={<PlansPage />} />
          <Route path="subscriptions" element={<SubscriptionsPage />} />
          <Route path="audit-log" element={<AuditLogPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
