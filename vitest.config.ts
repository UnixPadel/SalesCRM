import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/modules/**/*.test.ts", "src/bootstrap/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text"],
      // Genel plan: domain ve application (ve Faz 4–5'te builder) kodunda %90 satır kapsamı.
      include: ["src/modules/*/domain/**", "src/modules/*/application/**", "src/modules/ad-feedback/builders/**"],
      exclude: ["**/*.test.ts", "**/fakes.ts", "**/index.ts", "**/types.ts", "**/ports.ts", "**/events.ts"],
      thresholds: { lines: 90, statements: 90, functions: 90 },
    },
  },
});
