// ESLint 9+ flat config. Kurallar ADR-0007'de.
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**", "legacy/**", "server/data/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Arayüz: tarayıcı ortamı, React hook kuralları.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/modules/**"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // Sunucu, betikler, modüller ve testler: Node ortamı.
    files: ["server/**/*.{mjs,ts}", "scripts/**/*.mjs", "src/modules/**/*.ts", "tests/**/*.ts", "*.{js,mjs,ts}"],
    languageOptions: { globals: globals.node },
  },
  {
    // ADR-0004: secret'lar ve config tek yerden okunur; modüller process.env'e dokunmaz.
    files: ["src/modules/**/*.ts"],
    ignores: ["src/modules/shared/kernel/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Config ve secret yalnız shared/kernel içindeki yükleyiciden okunur (ADR-0004).",
        },
      ],
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    // Faz 0 geçişi: mevcut arayüz ve sunucu kodu Faz 1'de modüllere taşınana kadar bu kurallar uyarı.
    // Yeni kod (src/modules, tests) için hepsi hata (yukarıdaki varsayılanlar).
    files: ["src/**/*.{ts,tsx}", "server/**/*.mjs", "scripts/**/*.mjs"],
    ignores: ["src/modules/**"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "no-useless-assignment": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
    },
  },
  prettier,
);
