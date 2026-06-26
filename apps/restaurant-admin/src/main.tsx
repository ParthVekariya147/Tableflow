import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// Baseline design tokens (default --ag-* CSS variables). TenantThemeGate below
// overrides them with the *logged-in tenant's* brand at runtime (multi-tenant
// theming — same engine as the customer app). It sits inside AuthProvider because
// the brand depends on who's signed in.
import "@amber/ui/tokens.css";
import "./index.css";
import App from "./App";
import { AdminStoreProvider } from "./store/AdminStore";
import { AuthProvider } from "./context/AuthContext";
import { TenantThemeGate } from "./context/TenantThemeGate";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <TenantThemeGate>
        <AdminStoreProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AdminStoreProvider>
      </TenantThemeGate>
    </AuthProvider>
  </React.StrictMode>,
);
