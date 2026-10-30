/**
 * Tek seferlik geriye doldurma (Faz 4): Faz 2'den beri biriken platform lead'lerinin aşama olayları için
 * eksik outbox satırlarını açar. Açılan satırları çalışan sunucudaki dağıtıcı gönderir.
 *
 *   npx tsx scripts/outbox-backfill.ts --provider meta [--since 2026-10-28] [--sources meta_form,web_form] [--dry-run]
 *
 * Varsayılan: since = 2026-10-28 (Faz 2 devreye alma), sources = meta_form. Mevcut satırlara dokunmaz.
 */
import "../server/env.mjs";
import { BackfillOutbox } from "../src/modules/ad-feedback/application";
import { pgOutboxRepository } from "../src/modules/ad-feedback/infrastructure";
import { createLogger, systemClock } from "../src/modules/shared/kernel";
import { bootSalesPipeline } from "../src/bootstrap/salesPipeline";

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq?.slice(name.length + 3);
};
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const provider = arg("provider") ?? "meta";
const since = new Date(arg("since") ?? "2026-10-28T00:00:00Z");
if (Number.isNaN(since.getTime())) {
  console.error("--since geçerli bir tarih olmalı (ör. 2026-10-28)");
  process.exit(1);
}
const allowed = ["meta_form", "google_form", "web_form"] as const;
type Source = (typeof allowed)[number];
const sources = (arg("sources") ?? "meta_form")
  .split(",")
  .map((s) => s.trim())
  .filter((s): s is Source => (allowed as readonly string[]).includes(s));
if (!sources.length) {
  console.error(`--sources şunlardan olmalı: ${allowed.join(", ")}`);
  process.exit(1);
}

const logger = createLogger({ module: "outbox-backfill" });
const app = await bootSalesPipeline({ logger });
const backfill = new BackfillOutbox({
  outbox: pgOutboxRepository(app.db),
  events: app.pipeline.queries,
  clock: systemClock,
  logger,
});
const result = await backfill.run({ provider, since, sources, dryRun: flag("dry-run") });
console.log(
  `[outbox-backfill] sağlayıcı ${provider}, ${since.toISOString()} sonrası, kaynaklar ${sources.join(",")}: ` +
    `${result.candidates} aday olay, ${result.dryRun ? "deneme (yazılmadı)" : `${result.enqueued} yeni satır`}`,
);
await app.close();
