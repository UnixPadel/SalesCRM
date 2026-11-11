import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // VITE_PORT / API_PORT: ikinci bir yerel kopya (ör. veri kopyasıyla deneme) ana sunucuyla çakışmadan çalışsın.
    port: Number(process.env["VITE_PORT"]) || 5173,
    open: false,
    // API + IMAP live in server/index.mjs (npm run dev starts both).
    proxy: { "/api": `http://localhost:${Number(process.env["API_PORT"]) || 8787}` },
  },
});
