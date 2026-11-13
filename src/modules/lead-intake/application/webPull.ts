/**
 * Web sitesi çekme modu: site talepleri kendi tarafında saklar; bu iş imzalı isteklerle `/pending`'i okur, her
 * öğeyi push ucunun kullandığı kapıdan (AcceptInboundEvent, aynı sağlayıcı ve aynı dedupe anahtarı) gelen kutusuna
 * yazar, yazımı kesinleşenleri `/ack` ile onaylar; `more` ise tur başına üst sınıra kadar devam eder.
 *
 *  - Geçerli `submission_id` taşıyan her öğe, bot ya da bozuk olsa da önce inbox'a yazılır ve onaylanır: sitenin
 *    kuyruğu hep ilerler. Ayıklama inbox işleyicisinde yapılır (honeypot → lead açılmadan kapanır; bozuk → failed).
 *  - Hata (ağ, 429, 5xx, 401, 400, 503): o sayfa için onay gönderilmez, durum kaydedilir, sonraki tur yeniden dener.
 *    İki süreç aynı anda çekse de tek lead açılır: inbox UNIQUE dedupe anahtarı + işleyicide SKIP LOCKED.
 *  - Kişisel veri loglanmaz: yalnız sayılar ve hata kodları.
 */
import type { Clock, Logger } from "../../shared/kernel";
import type { AcceptInboundEvent } from "./inboxJobs";
import {
  PullSourceError,
  type PulledItem,
  type PullAckStatus,
  type PullSource,
  type WebPullErrorKind,
  type WebPullRound,
  type WebPullStatus,
  type WebPullStatusStore,
} from "./ports";

export interface PullWebSubmissionsDeps {
  source: PullSource;
  accept: Pick<AcceptInboundEvent, "execute">;
  /** Inbox sağlayıcısı (push ile aynı: "web"). */
  provider: string;
  /** Sözleşme öğesi → inbox kaydı; geçersizse null (onaylanamaz, sayılır). */
  toInbox(item: PulledItem): { platformLeadId: string; payload: unknown } | null;
  clock: Clock;
  logger: Logger;
  status?: WebPullStatusStore;
  /** `/pending` limit (1–100); varsayılan 50. */
  pageSize?: number;
  /** Tur başına en çok sayfa; varsayılan 10. */
  maxPages?: number;
}

export const EMPTY_WEB_PULL_STATUS: WebPullStatus = {
  lastRunAt: null,
  lastPullAt: null,
  lastRunOk: null,
  lastErrorCode: null,
  lastErrorKind: null,
  lastErrorAt: null,
  lastRound: null,
};

export class PullWebSubmissions {
  private current: WebPullStatus = { ...EMPTY_WEB_PULL_STATUS };
  private loaded = false;

  constructor(private readonly deps: PullWebSubmissionsDeps) {}

  /** Bu süreçteki son durum (worker'ın /health ucu). */
  status(): WebPullStatus {
    return this.current;
  }

  async runOnce(): Promise<WebPullRound> {
    const { source, clock, logger } = this.deps;
    const pageSize = Math.min(100, Math.max(1, Math.floor(this.deps.pageSize ?? 50)));
    const maxPages = Math.max(1, Math.floor(this.deps.maxPages ?? 10));
    await this.loadOnce();
    const startedAt = clock.now().toISOString();
    const round: WebPullRound = { pages: 0, fetched: 0, inserted: 0, duplicate: 0, invalid: 0, acked: 0, unknown: 0 };
    let failure: { code: string; kind: WebPullErrorKind } | null = null;

    try {
      for (let page = 0; page < maxPages; page++) {
        const { items, more } = await source.pending(pageSize);
        round.pages += 1;
        round.fetched += items.length;
        if (!items.length) break;
        const acks: { submissionId: string; status: PullAckStatus }[] = [];
        let inboxError: unknown = null;
        for (const item of items) {
          const rec = this.deps.toInbox(item);
          if (!rec) {
            round.invalid += 1;
            continue;
          }
          try {
            const out = await this.deps.accept.execute({
              provider: this.deps.provider,
              kind: "webhook",
              platformLeadId: rec.platformLeadId,
              payload: rec.payload,
            });
            round[out.status] += 1;
            acks.push({ submissionId: rec.platformLeadId, status: out.status });
          } catch (e) {
            // Veritabanı yazamadı: yazılanları onayla, kalanını site tutsun; turu bitir.
            inboxError = e;
            break;
          }
        }
        if (acks.length) {
          const r = await source.ack(acks);
          round.acked += r.acked;
          round.unknown += r.unknown.length;
          if (r.unknown.length) logger.warn("web-pull: site bazı onayları tanımadı", { unknown: r.unknown.length });
        }
        if (inboxError) {
          failure = { code: "inbox.write_failed", kind: "inbox" };
          logger.error("web-pull: gelen kutusuna yazılamadı, tur durdu", { error: inboxError });
          break;
        }
        // Onaylanacak öğe yoksa site aynı sayfayı yine verir: dönmeyi bırak.
        if (!more || !acks.length) break;
      }
    } catch (e) {
      if (e instanceof PullSourceError) {
        failure = { code: e.code, kind: e.kind };
        const meta = { code: e.code, httpStatus: e.httpStatus };
        if (e.kind === "transient") logger.warn("web-pull: site geçici hata verdi, sonraki turda denenecek", meta);
        else logger.error("web-pull: site isteği reddetti (anahtar / sözleşme / yapılandırma)", meta);
      } else {
        failure = { code: "web_pull.unexpected", kind: "transient" };
        logger.error("web-pull: beklenmeyen hata", { error: e });
      }
    }

    const endedAt = clock.now().toISOString();
    this.current = {
      ...this.current,
      lastRunAt: startedAt,
      lastRunOk: failure === null,
      lastRound: round,
      ...(failure
        ? { lastErrorCode: failure.code, lastErrorKind: failure.kind, lastErrorAt: endedAt }
        : { lastPullAt: endedAt }),
    };
    if (round.invalid) logger.warn("web-pull: submission_id'siz öğe onaylanamadı", { invalid: round.invalid });
    if (round.fetched || failure) {
      logger.info("web-pull: tur bitti", { ...round, ok: failure === null, code: failure?.code ?? null });
    }
    await this.save();
    return round;
  }

  private async loadOnce(): Promise<void> {
    if (this.loaded || !this.deps.status) return;
    this.loaded = true;
    try {
      const prev = await this.deps.status.load();
      if (prev) this.current = { ...EMPTY_WEB_PULL_STATUS, ...prev };
    } catch (e) {
      this.deps.logger.warn("web-pull: önceki durum okunamadı", { error: e });
    }
  }

  private async save(): Promise<void> {
    if (!this.deps.status) return;
    try {
      await this.deps.status.save(this.current);
    } catch (e) {
      this.deps.logger.warn("web-pull: durum yazılamadı", { error: e });
    }
  }
}
