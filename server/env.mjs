// Loads ../.env into process.env before anything else reads it (imported first by index.mjs).
// Node 20.12+ has this built in; missing file = no-op. Values already set in the environment win.
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
try {
  const before = { ...process.env };
  process.loadEnvFile(file);
  for (const k of Object.keys(before)) process.env[k] = before[k];
} catch {
  /* no .env file */
}
