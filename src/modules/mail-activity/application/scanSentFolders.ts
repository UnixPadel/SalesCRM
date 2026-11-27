import type { Clock, Logger } from "../../shared/kernel";
import { WEEK_MS, toStoredMessage, type MailActivityStore, type SentSource } from "../domain";

/**
 * Gönderilmiş klasörü taraması (saatlik iş): her hesap için yalnız son taramadan sonra gelen UID'ler okunur. İlk
 * taramada ya da klasörün UIDVALIDITY'si değişince (sunucu klasörü yeniden numaraladı) son `backfillWeeks` hafta
 * baştan okunur; daha önce yazılmış ileti anahtarıyla (Message-ID) tanınır, ikinci kez sayılmaz.
 * Hesaplar birbirinden bağımsızdır: biri hata verirse hata o hesabın durumuna yazılır, diğerleri devam eder.
 */
export interface ScanDeps {
  source: SentSource;
  store: MailActivityStore;
  mailboxes: readonly string[];
  clock: Clock;
  backfillWeeks: number;
  logger?: Logger | undefined;
}

export interface MailboxScanResult {
  mailbox: string;
  status: "ok" | "skipped" | "failed";
  /** Okunan yeni ileti. */
  seen: number;
  /** Depoya yazılan (daha önce yazılmamış) ileti. */
  added: number;
  /** Klasör baştan okundu (ilk tarama ya da UIDVALIDITY değişti). */
  reset: boolean;
  error?: string;
}

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)) || "unknown";

export async function scanSentFolders(deps: ScanDeps): Promise<MailboxScanResult[]> {
  const out: MailboxScanResult[] = [];
  for (const mailbox of deps.mailboxes) {
    if (!deps.source.configured(mailbox)) {
      out.push({ mailbox, status: "skipped", seen: 0, added: 0, reset: false });
      continue;
    }
    const now = deps.clock.now();
    try {
      const prev = await deps.store.state(mailbox);
      const result = await deps.source.open(mailbox, async (folder) => {
        const reset = !prev?.uidValidity || prev.uidValidity !== folder.uidValidity || prev.folder !== folder.path;
        const after = reset ? 0 : prev.lastUid;
        const raw = reset
          ? await folder.since(new Date(now.getTime() - deps.backfillWeeks * WEEK_MS))
          : await folder.fromUid(after + 1);
        const fresh = raw.filter((m) => m.uid > after);
        const added = await deps.store.addMessages(
          mailbox,
          fresh.map((m) => toStoredMessage(m, folder.uidValidity, now)),
        );
        const lastUid = fresh.reduce((max, m) => Math.max(max, m.uid), after);
        await deps.store.markOk(mailbox, { folder: folder.path, uidValidity: folder.uidValidity, lastUid }, now);
        return { seen: fresh.length, added, reset };
      });
      out.push({ mailbox, status: "ok", ...result });
    } catch (e) {
      const error = errorText(e);
      out.push({ mailbox, status: "failed", seen: 0, added: 0, reset: false, error });
      deps.logger?.warn("gönderilmiş klasörü okunamadı", { mailbox: mailbox.split("@")[0], error });
      try {
        await deps.store.markError(mailbox, error, now);
      } catch (e2) {
        deps.logger?.error("tarama hatası kaydedilemedi", { error: errorText(e2) });
      }
    }
  }
  return out;
}
