// Starts the API server and the Vite dev server together (npm run dev).
// `node scripts/dev.mjs --dev-login=<password>` lets any @domain address sign in with that
// password instead of a real mailbox (local testing only; see README).
import { spawn } from "node:child_process";

// `--set=KEY=VALUE` (tekrarlanabilir): yalnız bu çalıştırma için ortam değişkeni; webhook smoke testleri
// gibi yerel denemelerde .env dosyasına dokunmadan secret vermek için.
const node = process.execPath;
const devLogin = process.argv.find((a) => a.startsWith("--dev-login="))?.slice("--dev-login=".length);
const sets = Object.fromEntries(
  process.argv
    .filter((a) => a.startsWith("--set="))
    .map((a) => a.slice("--set=".length))
    .map((kv) => [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)]),
);
const env = { ...process.env, ...(devLogin ? { CRM_DEV_PASSWORD: devLogin } : {}), ...sets };

// PORT belongs to Vite (preview tooling sets it); the API listens on API_PORT (default 8787).
const { PORT: _vitePort, ...apiEnv } = env;
const procs = [
  spawn(node, ["node_modules/tsx/dist/cli.mjs", "server/index.mjs"], { stdio: "inherit", env: apiEnv }),
  spawn(node, ["node_modules/vite/bin/vite.js"], { stdio: "inherit", env }),
];
let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill();
  process.exit(code);
};
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
for (const p of procs) p.on("exit", (code) => stop(code ?? 0));
