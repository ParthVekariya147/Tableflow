import React from "react";
import ReactDOM from "react-dom/client";
// Baseline design tokens (default --ag-* CSS variables). The dynamic
// TenantThemeProvider inside <App> overrides them once the scanned tenant is
// resolved; until then the boot/loading screens use these neutral defaults.
import "@amber/ui/tokens.css";
import "./index.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
