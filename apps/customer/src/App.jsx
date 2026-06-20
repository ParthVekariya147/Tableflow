import { BrowserRouter, Routes, Route } from "react-router-dom";
import { TenantThemeProvider } from "@amber/ui";
import { BootProvider, useBoot } from "./context/BootContext";
import { SessionProvider } from "./context/SessionContext";
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

/**
 * Rendered only once boot has resolved a tenant + free table. The tenant drives
 * the dynamic theme (one codebase, many brands); the QR entry path and `/` both
 * land on the reserve splash, after which the in-app screens are relative.
 */
function BootedApp() {
  const { tenant } = useBoot();
  return (
    <TenantThemeProvider tenant={tenant}>
      <MenuProvider>
        <SessionProvider>
          <div className="min-h-screen bg-background max-w-md mx-auto relative">
            <Toast />
            <ItemSheet />
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
