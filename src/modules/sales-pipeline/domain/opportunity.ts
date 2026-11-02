import { RuleError, err, ok, type Result } from "../../shared/kernel";
import type { Lead, StageEvent } from "./lead";
import { STAGE_CODES, type StageCode } from "./stage";

/**
 * Fırsat alanları ve pano istatistikleri (satış panosu, Faz 6b). Saf kod: doğrulama, aşamaya giriş anı,
 * son tutar ve kolon istatistikleri (kural 4: adet, toplam EUR, ortalama bekleme günü).
 */

/** Satışçının lead detayında düzenleyebildiği alanlar; kimlik alanları (e-posta, telefon) burada değil. */
export interface LeadFields {
  courtCount: number | null;
  courtModel: string;
  /** Takvim günü, YYYY-MM-DD; saat yok. */
  expectedCloseDate: string | null;
  company: string;
  city: string;
  productInterest: string;
  notes: string;
  /** Kuruluş bağı; null = bağı kaldır. */
  organizationId: string | null;
}

export const LEAD_FIELD_KEYS = [
  "courtCount",
  "courtModel",
  "expectedCloseDate",
  "company",
  "city",
  "productInterest",
  "notes",
  "organizationId",
] as const satisfies readonly (keyof LeadFields)[];

export const LEAD_FIELD_LIMITS = {
  courtCountMax: 999,
  courtModel: 64,
  text: 200,
  notes: 4000,
} as const;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD ve gerçek bir takvim günü mü (2026-02-30 değil). */
export function isCalendarDate(v: string): boolean {
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Ham girdi (API gövdesi) → doğrulanmış kısmi alan seti. Yalnız verilen anahtarlar döner; boş metin ve null
 * kort sayısı / kapanış tarihi için "temizle" demektir. İlk hata RuleError olarak döner.
 */
export function parseLeadFields(raw: Record<string, unknown>): Result<Partial<LeadFields>, RuleError> {
  const out: Partial<LeadFields> = {};
  const text = (key: keyof LeadFields, max: number): Result<string, RuleError> => {
    const v = raw[key];
    if (v !== null && typeof v !== "string") {
      return err(new RuleError(`lead.${snake(key)}_invalid`, "Metin olmalı.", { field: key }));
    }
    const s = (v ?? "").trim();
    if (s.length > max) {
      return err(new RuleError(`lead.${snake(key)}_too_long`, `En fazla ${max} karakter.`, { field: key, max }));
    }
    return ok(s);
  };

  if ("courtCount" in raw) {
    const v = raw["courtCount"];
    if (v === null || v === "" || v === undefined) out.courtCount = null;
    else {
      const n = typeof v === "string" ? Number(v.trim()) : v;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > LEAD_FIELD_LIMITS.courtCountMax) {
        return err(
          new RuleError(
            "lead.court_count_invalid",
            `Kort sayısı 0–${LEAD_FIELD_LIMITS.courtCountMax} arası tam sayı olmalı.`,
            {
              value: v,
            },
          ),
        );
      }
      out.courtCount = n;
    }
  }
  if ("courtModel" in raw) {
    const r = text("courtModel", LEAD_FIELD_LIMITS.courtModel);
    if (!r.ok) return r;
    out.courtModel = r.value;
  }
  if ("expectedCloseDate" in raw) {
    const v = raw["expectedCloseDate"];
    if (v === null || v === "" || v === undefined) out.expectedCloseDate = null;
    else if (typeof v !== "string" || !isCalendarDate(v.trim())) {
      return err(
        new RuleError("lead.expected_close_invalid", "Beklenen kapanış YYYY-AA-GG biçiminde bir gün olmalı.", {
          value: v,
        }),
      );
    } else out.expectedCloseDate = v.trim();
  }
  for (const key of ["company", "city", "productInterest"] as const) {
    if (key in raw) {
      const r = text(key, LEAD_FIELD_LIMITS.text);
      if (!r.ok) return r;
      out[key] = r.value;
    }
  }
  if ("notes" in raw) {
    const r = text("notes", LEAD_FIELD_LIMITS.notes);
    if (!r.ok) return r;
    out.notes = r.value;
  }
  if ("organizationId" in raw) {
    const v = raw["organizationId"];
    if (v === null || v === "" || v === undefined) out.organizationId = null;
    else if (typeof v !== "string" || !v.trim() || v.trim().length > 64) {
      return err(new RuleError("lead.organization_invalid", "Kuruluş kimliği geçersiz.", { value: v }));
    } else out.organizationId = v.trim();
  }
  return ok(out);
}

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

/** Aşamaya giriş anı ve son geçerli tutar; her ikisi de geri alınmamış aşama olaylarından. */
export interface StageSummary {
  /** Bulunduğu aşamaya en son girdiği an; olay yoksa oluşturulma anı. */
  stageEnteredAt: Date;
  /** Son geri alınmamış tutar (Teklif ya da Kazanıldı); yoksa null. */
  value: { amount: number; currency: string } | null;
}

export function stageSummary(
  lead: Pick<Lead, "currentStage" | "createdAt">,
  events: readonly StageEvent[],
): StageSummary {
  const live = events.filter((e) => !e.undoneAt).sort((a, b) => a.sequence - b.sequence);
  let stageEnteredAt = lead.createdAt;
  let value: StageSummary["value"] = null;
  for (const e of live) {
    if (e.stageCode === lead.currentStage) stageEnteredAt = e.occurredAt;
    if (e.value) value = e.value;
  }
  return { stageEnteredAt, value };
}

/** Para birimi → EUR çarpanı. Uygulama ayarı; Faz 7'de ekrandan düzenlenir. */
export type EurRates = Readonly<Record<string, number>>;
export const DEFAULT_EUR_RATES: EurRates = { EUR: 1, USD: 0.92, GBP: 1.17, TRY: 0.027 };

/** `EUR_RATES='{"USD":0.9,"TRY":0.025}'` → tablo (EUR her zaman 1). Boş girdi varsayılanı döner. */
export function parseEurRates(raw: string | undefined): Result<EurRates, RuleError> {
  if (!raw || !raw.trim()) return ok(DEFAULT_EUR_RATES);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err(new RuleError("eur_rates.invalid_json", "EUR_RATES geçerli JSON olmalı."));
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return err(new RuleError("eur_rates.invalid_shape", 'EUR_RATES {"USD":0.92,…} biçiminde olmalı.'));
  }
  const out: Record<string, number> = { EUR: 1 };
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const cur = k.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur) || typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      return err(new RuleError("eur_rates.invalid_rate", "Kur pozitif sayı, para birimi üç harf olmalı.", { key: k }));
    }
    out[cur] = cur === "EUR" ? 1 : v;
  }
  return ok(out);
}

/** EUR karşılığı; kuru bilinmeyen para birimi için null (toplama katılmaz, sayılır). */
export function toEur(value: { amount: number; currency: string }, rates: EurRates = DEFAULT_EUR_RATES): number | null {
  const r = rates[value.currency.toUpperCase()];
  return r === undefined ? null : Math.round(value.amount * r * 100) / 100;
}

export interface ColumnStats {
  stage: StageCode;
  count: number;
  /** EUR'a çevrilmiş toplam; kuru bilinmeyenler hariç. */
  totalEur: number;
  /** Kolonda ortalama bekleme günü (aşamaya girişten `now`a), tam sayıya yuvarlı. */
  avgDays: number;
  /** Kuru bilinmediği için toplama katılamayan tutar sayısı. */
  unconverted: number;
}

const DAY_MS = 86_400_000;
export const daysBetween = (from: Date, to: Date): number =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));

/** Kural 4: her aşama için adet, toplam EUR ve ortalama gün; verilen kümeden hesaplanır (filtre uygulanmış pano). */
export function columnStats(
  items: readonly (Pick<Lead, "currentStage"> & StageSummary)[],
  now: Date,
  rates: EurRates = DEFAULT_EUR_RATES,
): ColumnStats[] {
  return STAGE_CODES.map((stage) => {
    const inStage = items.filter((i) => i.currentStage === stage);
    let totalEur = 0;
    let unconverted = 0;
    let days = 0;
    for (const i of inStage) {
      days += daysBetween(i.stageEnteredAt, now);
      if (i.value) {
        const eur = toEur(i.value, rates);
        if (eur === null) unconverted++;
        else totalEur += eur;
      }
    }
    return {
      stage,
      count: inStage.length,
      totalEur: Math.round(totalEur * 100) / 100,
      avgDays: inStage.length ? Math.round(days / inStage.length) : 0,
      unconverted,
    };
  });
}
