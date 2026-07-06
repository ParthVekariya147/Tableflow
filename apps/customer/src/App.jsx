import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
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
  const { sessionEnded, awaitingCash } = useSession();
  if (sessionEnded || awaitingCash) return <SessionEndScreen />;
  return (
    <>
      <Routes>
        <Route path="/" element={<SplashScreen />} />
        <Route path="/:slug/t/:qrToken" element={<SplashScreen />} />
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
