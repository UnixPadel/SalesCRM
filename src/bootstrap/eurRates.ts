/**
 * EUR kurlarının kaynağı (Faz 7b): yönetim ekranındaki ayar (`integration_settings app/eur_rates`) → `EUR_RATES`
 * ortam değişkeni → varsayılan tablo. Pano ve raporlar kurları her sorguda buradan okur; değer 60 sn önbellekte
 * durur, ekrandan kaydedince önbellek hemen düşer (toplam aynı istekten sonra yeni kurla hesaplanır).
 */
import { RuleError, err, ok, type Clock, type Logger, type Result } from "../modules/shared/kernel";
import { DEFAULT_EUR_RATES, parseEurRates, type EurRates } from "../modules/sales-pipeline/domain";

export const EUR_RATES_SETTING = { provider: "app", key: "eur_rates" } as const;

export interface EurRatesInfo {
  rates: Record<string, number>;
  source: "setting" | "env" | "default";
  updatedAt: string | null;
}

export interface EurRatesStore {
  /** Sorgular için güncel kurlar (önbellekli). */
  current(): Promise<EurRates>;
  describe(): Promise<EurRatesInfo>;
  /** Ekrandan gelen tabloyu doğrular ve ayara yazar. */
  save(rates: unknown): Promise<Result<EurRatesInfo, RuleError>>;
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
}

export function createEurRatesStore(deps: EurRatesStoreDeps): EurRatesStore {
  const ttl = deps.ttlMs ?? 60_000;
  let cache: { at: number; info: EurRatesInfo } | null = null;

  const load = async (): Promise<EurRatesInfo> => {
    const stored = await deps.settings.get(EUR_RATES_SETTING.provider, EUR_RATES_SETTING.key);
    if (stored && stored.value.trim()) {
      const parsed = parseEurRates(stored.value);
      if (parsed.ok)
        return { rates: { ...parsed.value }, source: "setting", updatedAt: stored.updatedAt.toISOString() };
      deps.logger.warn("kur ayarı geçersiz, ortam değişkenine düşülüyor", { code: parsed.error.code });
    }
    if (deps.envJson.trim()) {
      const parsed = parseEurRates(deps.envJson);
      if (parsed.ok) return { rates: { ...parsed.value }, source: "env", updatedAt: null };
      deps.logger.warn("EUR_RATES geçersiz, varsayılan kurlar kullanılıyor", { code: parsed.error.code });
    }
    return { rates: { ...DEFAULT_EUR_RATES }, source: "default", updatedAt: null };
  };

  const describe = async (): Promise<EurRatesInfo> => {
    const now = deps.clock.now().getTime();
    if (!cache || now - cache.at > ttl) cache = { at: now, info: await load() };
    return cache.info;
  };

  return {
    describe,
    current: async () => (await describe()).rates,
    async save(rates) {
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
      cache = null;
      return ok(await describe());
    },
  };
}
