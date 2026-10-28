/**
 * Meta sayfa aboneliği kurulumu (Faz 2 runbook: docs/runbooks/meta-lead-ads.md).
 *
 *   npx tsx scripts/meta-subscribe.ts --page <PAGE_ID> [--page-token <SAYFA_TOKENI>] [--check]
 *
 * `--check` yalnız mevcut abonelikleri listeler. Sayfa token'ı verilmezse META_SYSTEM_USER_TOKEN kullanılır
 * (sistem kullanıcısı sayfaya atanmış olmalı). Token argümanı loglanmaz.
 */
import { createLogger, loadConfig, readSecret } from "../src/modules/shared/kernel";
import { createGraphClient, metaConfig } from "../src/modules/lead-intake/adapters/meta";

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  loadConfig();
  const cfg = metaConfig(readSecret);
  const logger = createLogger({ script: "meta-subscribe" });
  const pageId = opt("--page") ?? cfg.pageId;
  if (!pageId) {
    console.error("Sayfa kimliği gerekli: --page <PAGE_ID> ya da META_PAGE_ID.");
    process.exit(2);
  }
  const pageToken = opt("--page-token");
  const graph = createGraphClient({ version: cfg.graphVersion, token: cfg.systemUserToken, logger });
  if (!args.includes("--check")) {
    const r = await graph.subscribePage(pageId, pageToken);
    logger.info("abonelik isteği", { pageId, success: r.success });
  }
  const apps = await graph.getSubscribedApps(pageId, pageToken);
  console.log(JSON.stringify(apps, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    process.exit(1);
  });
