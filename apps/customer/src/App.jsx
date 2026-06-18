import { MemoryRouter, Routes, Route } from "react-router-dom";
import { SessionProvider } from "./context/SessionContext";
import BottomNav from "./components/BottomNav";
import Toast from "./components/Toast";
import ItemSheet from "./components/ItemSheet";
import SplashScreen from "./screens/SplashScreen";
import WelcomeScreen from "./screens/WelcomeScreen";
import MenuScreen from "./screens/MenuScreen";
import MyOrderScreen from "./screens/MyOrderScreen";
import StatusScreen from "./screens/StatusScreen";
import BillScreen from "./screens/BillScreen";

export default function App() {
  return (
    <SessionProvider>
      <MemoryRouter>
        <div className="min-h-screen bg-background max-w-md mx-auto relative">
          <Toast />
          <ItemSheet />
          <Routes>
            <Route path="/"        element={<SplashScreen />} />
            <Route path="/welcome" element={<WelcomeScreen />} />
            <Route path="/menu"    element={<MenuScreen />} />
            <Route path="/order"   element={<MyOrderScreen />} />
            <Route path="/status"  element={<StatusScreen />} />
            <Route path="/bill"    element={<BillScreen />} />
          </Routes>
          <BottomNav />
        </div>
      </MemoryRouter>
    </SessionProvider>
  );
}
