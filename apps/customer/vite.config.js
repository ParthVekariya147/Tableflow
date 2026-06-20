import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Bind to 0.0.0.0 so the app is reachable from other devices (e.g. your
  // phone) on the same LAN, not just localhost.
  server: { host: true },
})
