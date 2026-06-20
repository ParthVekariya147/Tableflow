import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { TenantThemeProvider } from "@amber/ui";
// Baseline design tokens (default --ag-* CSS variables). The provider below
// overrides them with the active tenant's brand — same engine as the customer app.
import "@amber/ui/tokens.css";
import "./index.css";
import App from "./App";
import { defaultTenant } from "./tenant/defaultTenant";
import { AdminStoreProvider } from "./store/AdminStore";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TenantThemeProvider tenant={defaultTenant}>
      <AdminStoreProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AdminStoreProvider>
    </TenantThemeProvider>
  </React.StrictMode>,
);
