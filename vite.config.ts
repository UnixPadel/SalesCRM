import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
    // API + IMAP live in server/index.mjs (npm run dev starts both).
    proxy: { "/api": "http://localhost:8787" },
  },
});
