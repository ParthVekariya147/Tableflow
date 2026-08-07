import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { TenantThemeProvider } from "@amber/ui";
import { BootProvider, useBoot } from "./context/BootContext";
import { SessionProvider, useSession } from "./context/SessionContext";
import { MenuProvider } from "./context/MenuContext";
import BottomNav from "./components/BottomNav";
import Toast from "./components/Toast";
import ItemSheet from "./components/ItemSheet";
import SplashScreen from "./screens/SplashScreen";
import WelcomeScreen from "./screens/WelcomeScreen";
import MenuScreen from "./screens/MenuScreen";
import MyOrderScreen from "./screens/MyOrderScreen";
import StatusScreen from "./screens/StatusScreen";
import BillScreen from "./screens/BillScreen";
import SessionEndScreen from "./screens/SessionEndScreen";

/**
 * Once the visit is settled (or awaiting cash at the counter) the session is
 * terminal: render the end screen INSTEAD of the router, so the phone's back
 * button — which pops browser history back through the ordering screens — can't
 * re-enter the order flow. The terminal screen wins regardless of the URL.
 */
function AppRoutes() {
  const { sessionEnded, awaitingCash, sessionStarted } = useSession();
  if (sessionEnded || awaitingCash) return <SessionEndScreen />;

  /**
   * Before the table is reserved there is no session, so the reserve form is the
   * ONLY screen — rendered above the router for the same reason as the terminal
   * screen above: the ordering screens must not be reachable by a typed URL, the
   * back button, or (the bug this fixes) simply landing on the QR path, which
   * `BottomNav`'s hardcoded hidden-path list didn't cover — it painted Menu /
   * My Order / Status / Bill under the reserve form.
   */
  if (!sessionStarted) return <SplashScreen />;

  return (
    <>
      <Routes>
        {/* Session is live: the splash paths are behind us. Redirect instead of
            re-rendering the reserve form — this is also what a resumed session
            (mid-meal refresh, still on the QR URL) lands on. */}
        <Route path="/" element={<Navigate to="/welcome" replace />} />
        <Route path="/:slug/t/:qrToken" element={<Navigate to="/welcome" replace />} />
        <Route path="/welcome" element={<WelcomeScreen />} />
        <Route path="/menu" element={<MenuScreen />} />
        <Route path="/order" element={<MyOrderScreen />} />
        <Route path="/status" element={<StatusScreen />} />
        <Route path="/bill" element={<BillScreen />} />
      </Routes>
      <BottomNav />
    </>
  );
}

/**
 * Rendered only once boot has resolved a tenant + free table. The tenant drives
 * the dynamic theme (one codebase, many brands); the QR entry path and `/` both
 * land on the reserve splash, after which the in-app screens are relative.
 */
function BootedApp() {
  const { tenant } = useBoot();
  // Tab title = the scanned restaurant's name (one codebase, many brands);
  // index.html ships the neutral platform fallback "Amber" until boot resolves.
  useEffect(() => {
    if (tenant?.name) document.title = tenant.name;
  }, [tenant?.name]);
  return (
    <TenantThemeProvider tenant={tenant}>
      <MenuProvider>
        <SessionProvider>
          <div className="min-h-screen bg-background max-w-md mx-auto relative">
            <Toast />
            <ItemSheet />
            <AppRoutes />
          </div>
        </SessionProvider>
      </MenuProvider>
    </TenantThemeProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <BootProvider>
        <BootedApp />
      </BootProvider>
    </BrowserRouter>
  );
}
