import React from "react";
import ReactDOM from "react-dom/client";
import { TenantThemeProvider } from "@amber/ui";
// Baseline design tokens (default --ag-* CSS variables). The provider below
// overrides them with the active tenant's brand.
import "@amber/ui/tokens.css";
import "./index.css";
import App from "./App";
import { defaultTenant } from "./tenant/defaultTenant";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TenantThemeProvider tenant={defaultTenant}>
      <App />
    </TenantThemeProvider>
  </React.StrictMode>,
);
