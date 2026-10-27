import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/modules/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Genel plan: domain ve builder kodunda %90 satır kapsamı (Faz 1'den itibaren zorlanır).
      include: ["src/modules/**/domain/**", "src/modules/ad-feedback/builders/**"],
      exclude: ["**/*.test.ts", "**/index.ts"],
    },
  },
});
