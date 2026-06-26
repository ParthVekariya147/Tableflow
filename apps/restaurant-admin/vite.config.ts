import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Bind to 0.0.0.0 so the admin is reachable from other devices on the LAN.
  server: { host: true },
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id: string) {
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-router")
          ) {
            return "vendor";
          }
          if (id.includes("node_modules/qrcode.react")) return "qr";
        },
      },
    },
  },
});
