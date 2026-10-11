import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The backend runs on :3000 by default; set BACKEND_URL to proxy elsewhere
// (e.g. BACKEND_URL=http://localhost:3100 npm run dev).
const backend = process.env.BACKEND_URL || "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Proxying keeps API calls same-origin in dev.
    proxy: {
      "/api": backend,
      "/health": backend,
      // Google OAuth start + callback, so the session cookie is set on this origin.
      "/auth": backend,
    },
  },
});
