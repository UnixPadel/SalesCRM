/**
 * EUR kurlarının kaynağı (Faz 7b): yönetim ekranındaki ayar (`integration_settings app/eur_rates`) → `EUR_RATES`
 * ortam değişkeni → varsayılan tablo. Pano ve raporlar kurları her sorguda buradan okur; değer 60 sn önbellekte
 * durur, ekrandan kaydedince önbellek hemen düşer (toplam aynı istekten sonra yeni kurla hesaplanır).
 *
 * Otomatik güncelleme (2026-11-20): TCMB'nin günlük `today.xml` bülteninden döviz alış kurları çekilir, EUR
 * karşılığına çevrilir ve aynı ayara yazılır (`fx-rates` işi, 3 saatte bir). Kaynak ve bülten tarihi
 * `app/eur_rates_meta` ayarında durur; yönetim ekranından otomatik güncelleme kapatılabilir.
 */
import { RuleError, err, ok, type Clock, type Logger, type Result } from "../modules/shared/kernel";
import { DEFAULT_EUR_RATES, parseEurRates, type EurRates } from "../modules/sales-pipeline/domain";

export const EUR_RATES_SETTING = { provider: "app", key: "eur_rates" } as const;
export const EUR_RATES_META_SETTING = { provider: "app", key: "eur_rates_meta" } as const;
export const TCMB_URL = "https://www.tcmb.gov.tr/kurlar/today.xml";

export interface EurRatesInfo {
  rates: Record<string, number>;
  /** `tcmb`: otomatik çekildi; `setting`: yönetim ekranından elle girildi. */
  source: "tcmb" | "setting" | "env" | "default";
  updatedAt: string | null;
  /** TCMB bülteninin tarihi (YYYY-MM-DD); elle girilen kurlarda null. */
  rateDate: string | null;
  /** Otomatik güncelleme açık mı (varsayılan açık). */
  auto: boolean;
}

interface RatesMeta {
  source: "tcmb" | "manual";
  rateDate: string | null;
  auto: boolean;
}

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const sig6 = (n: number): number => Number(n.toPrecision(6));
const num = (v: string | undefined): number | null => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * TCMB `today.xml` -> "1 birim = X EUR" tablosu. Döviz alış (ForexBuying) kullanılır; birim (Unit, ör. JPY 100)
 * hesaba katılır. TRY = 1 / EUR alış. Kuru olmayan para birimi (ör. XDR) atlanır.
 */
export function parseTcmbXml(
  xml: string,
): Result<{ rates: Record<string, number>; rateDate: string | null }, RuleError> {
  const tryPer: Record<string, number> = {};
  for (const m of xml.matchAll(/<Currency\b[^>]*CurrencyCode="([A-Z]{3})"[^>]*>([\s\S]*?)<\/Currency>/g)) {
    const code = m[1] ?? "";
    const body = m[2] ?? "";
    const unit = num(/<Unit>([^<]*)<\/Unit>/.exec(body)?.[1]) ?? 1;
    const buying = num(/<ForexBuying>([^<]*)<\/ForexBuying>/.exec(body)?.[1]);
    if (code && code !== "XDR" && buying) tryPer[code] = buying / unit;
  }
  const eurTry = tryPer["EUR"];
  if (!eurTry) return err(new RuleError("eur_rates.tcmb_unreadable", "TCMB bülteninde EUR kuru bulunamadı."));
  const rates: Record<string, number> = { EUR: 1, TRY: sig6(1 / eurTry) };
  for (const [code, tl] of Object.entries(tryPer)) if (code !== "EUR") rates[code] = sig6(tl / eurTry);
  const d = /Tarih="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  return ok({ rates, rateDate: d ? `${d[3]}-${d[2]}-${d[1]}` : null });
}

export interface EurRatesStore {
  /** Sorgular için güncel kurlar (önbellekli). */
  current(): Promise<EurRates>;
  describe(): Promise<EurRatesInfo>;
  /**
   * Ekrandan gelen tabloyu doğrular ve ayara yazar (kaynak "elle"). `auto` verilirse otomatik güncelleme anahtarı da
   * değişir; yalnız `auto` verilirse kurlar değişmez.
   */
  save(rates: unknown, opts?: { auto?: boolean }): Promise<Result<EurRatesInfo, RuleError>>;
  /** TCMB'den çeker ve yazar (anahtardan bağımsız; zamanlanmış iş anahtara bakar). */
  refresh(): Promise<Result<EurRatesInfo, RuleError>>;
}

export interface EurRatesStoreDeps {
  settings: {
    get(provider: string, key: string): Promise<{ value: string; updatedAt: Date } | undefined>;
    set(provider: string, key: string, value: string, now: Date): Promise<void>;
  };
  /** `EUR_RATES` ortam değişkeninin değeri (boş olabilir). */
  envJson: string;
  clock: Clock;
  logger: Logger;
  ttlMs?: number;
  /** Testler için; verilmezse global fetch. */
  fetchImpl?: FetchLike;
}

export function createEurRatesStore(deps: EurRatesStoreDeps): EurRatesStore {
  const ttl = deps.ttlMs ?? 60_000;
  let cache: { at: number; info: EurRatesInfo } | null = null;

  const readMeta = async (): Promise<RatesMeta> => {
    const row = await deps.settings.get(EUR_RATES_META_SETTING.provider, EUR_RATES_META_SETTING.key);
    try {
      const m = (row?.value ? JSON.parse(row.value) : {}) as Partial<RatesMeta>;
      return {
        source: m.source === "tcmb" ? "tcmb" : "manual",
        rateDate: typeof m.rateDate === "string" ? m.rateDate : null,
        auto: m.auto !== false,
      };
    } catch {
      return { source: "manual", rateDate: null, auto: true };
    }
  };
  const writeMeta = (m: RatesMeta) =>
    deps.settings.set(EUR_RATES_META_SETTING.provider, EUR_RATES_META_SETTING.key, JSON.stringify(m), deps.clock.now());

  const load = async (): Promise<EurRatesInfo> => {
    const meta = await readMeta();
    const tail = { rateDate: null, auto: meta.auto };
    const stored = await deps.settings.get(EUR_RATES_SETTING.provider, EUR_RATES_SETTING.key);
    if (stored && stored.value.trim()) {
      const parsed = parseEurRates(stored.value);
      if (parsed.ok)
        return {
          rates: { ...parsed.value },
          source: meta.source === "tcmb" ? "tcmb" : "setting",
          updatedAt: stored.updatedAt.toISOString(),
          rateDate: meta.source === "tcmb" ? meta.rateDate : null,
          auto: meta.auto,
        };
      deps.logger.warn("kur ayarı geçersiz, ortam değişkenine düşülüyor", { code: parsed.error.code });
    }
    if (deps.envJson.trim()) {
      const parsed = parseEurRates(deps.envJson);
      if (parsed.ok) return { rates: { ...parsed.value }, source: "env", updatedAt: null, ...tail };
      deps.logger.warn("EUR_RATES geçersiz, varsayılan kurlar kullanılıyor", { code: parsed.error.code });
    }
    return { rates: { ...DEFAULT_EUR_RATES }, source: "default", updatedAt: null, ...tail };
  };

  const describe = async (): Promise<EurRatesInfo> => {
    const now = deps.clock.now().getTime();
    if (!cache || now - cache.at > ttl) cache = { at: now, info: await load() };
    return cache.info;
  };

  return {
    describe,
    current: async () => (await describe()).rates,
    async save(rates, opts) {
      const meta = await readMeta();
      const auto = typeof opts?.auto === "boolean" ? opts.auto : meta.auto;
      if (rates === undefined && typeof opts?.auto === "boolean") {
        await writeMeta({ ...meta, auto });
        cache = null;
        return ok(await describe());
      }
      if (!rates || typeof rates !== "object" || Array.isArray(rates)) {
        return err(new RuleError("eur_rates.invalid_shape", 'Kurlar {"USD":0.92,…} biçiminde olmalı.'));
      }
      const parsed = parseEurRates(JSON.stringify(rates));
      if (!parsed.ok) return parsed;
      await deps.settings.set(
        EUR_RATES_SETTING.provider,
        EUR_RATES_SETTING.key,
        JSON.stringify(parsed.value),
        deps.clock.now(),
      );
      await writeMeta({ source: "manual", rateDate: null, auto });
      cache = null;
      return ok(await describe());
    },
    async refresh() {
      const fetchImpl: FetchLike = deps.fetchImpl ?? ((u, i) => fetch(u, i));
      let xml: string;
      try {
        const res = await fetchImpl(TCMB_URL, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) return err(new RuleError("eur_rates.tcmb_unreachable", `TCMB yanıtı ${res.status}.`));
        xml = await res.text();
      } catch (e) {
        return err(new RuleError("eur_rates.tcmb_unreachable", "TCMB'ye ulaşılamadı.", { cause: String(e) }));
      }
      const parsed = parseTcmbXml(xml);
      if (!parsed.ok) return parsed;
      const meta = await readMeta();
      const current = (await describe()).rates;
      await deps.settings.set(
        EUR_RATES_SETTING.provider,
        EUR_RATES_SETTING.key,
        JSON.stringify({ ...current, ...parsed.value.rates }),
        deps.clock.now(),
      );
      await writeMeta({ source: "tcmb", rateDate: parsed.value.rateDate, auto: meta.auto });
      cache = null;
      deps.logger.info("kurlar TCMB'den güncellendi", {
        rateDate: parsed.value.rateDate,
        currencies: Object.keys(parsed.value.rates).length,
      });
      return ok(await describe());
    },
  };
}

/** Zamanlanmış iş: otomatik güncelleme açıksa TCMB'den çeker (hata loglanır, eski kurlar kalır). */
export function fxRatesJob(store: EurRatesStore, logger: Logger, everyMs: number) {
  return {
    name: "fx-rates",
    everyMs,
    runAtStart: true,
    async run() {
      if (!(await store.describe()).auto) return;
      const r = await store.refresh();
      if (!r.ok) logger.warn("TCMB kurları alınamadı, eski kurlar kullanılıyor", { code: r.error.code });
    },
  };
}
