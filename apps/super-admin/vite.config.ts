import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Bind to 0.0.0.0 so the app is reachable from other devices on the LAN.
  server: { host: true },
});
