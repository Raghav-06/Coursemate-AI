import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // The backend runs on :3000; proxying keeps API calls same-origin in dev.
    proxy: {
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000",
      // Google OAuth start + callback, so the session cookie is set on this origin.
      "/auth": "http://localhost:3000",
    },
  },
});
