import { RuleError, err, ok, type Result } from "../../shared/kernel";
import type { CourtCountBand, CustomerProfile, CustomerStatus, InstallSite, InstallTimeline } from "./leadProfile";
import { EMPTY_PRODUCTS, type ProductPrefs } from "./products";
import type { StageCode } from "./stage";

export const LEAD_SOURCES = ["meta_form", "google_form", "web_form", "manual", "import"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const isLeadSource = (v: unknown): v is LeadSource =>
  typeof v === "string" && (LEAD_SOURCES as readonly string[]).includes(v);

/** Reklam kaynakları (platform formu ya da site formu); elle açılan ve içe aktarılan lead bunların dışındadır. */
export const AD_SOURCES = ["meta_form", "google_form", "web_form"] as const satisfies readonly LeadSource[];
export type AdSource = (typeof AD_SOURCES)[number];
export const isAdSource = (v: unknown): v is AdSource =>
  typeof v === "string" && (AD_SOURCES as readonly string[]).includes(v);

/**
 * Geri bildirim kimliği: içe aktarılan lead (Excel, form tablosu) sonradan reklam kaydıyla eşleşip benimsendiyse
 * (`extra_answers.platform_source` + `platform_lead_id`) platforma o kaynak ve kimlikle bildirilir. Lead'in kendi
 * `source` alanı `import` kalır (raporlar ve Excel doğrulaması değişmez).
 */
export function feedbackIdentity(lead: {
  source: LeadSource;
  platformLeadId: string | null;
  extraAnswers: Record<string, unknown>;
}): { source: LeadSource; platformLeadId: string | null } {
  const adopted = lead.extraAnswers["platform_source"];
  if (lead.source !== "import" || !isAdSource(adopted)) {
    return { source: lead.source, platformLeadId: lead.platformLeadId };
  }
  const id = lead.extraAnswers["platform_lead_id"];
  return { source: adopted, platformLeadId: typeof id === "string" && id ? id : null };
}

/** Platformun verdiği lead kimliği; metin tutulur (bazı platformlarda 15–17 hane, JS number bozar). */
export class PlatformLeadId {
  private constructor(readonly value: string) {}
  static parse(raw: unknown): Result<PlatformLeadId, RuleError> {
    const v = String(raw ?? "").trim();
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(v)) {
      return err(new RuleError("platform_lead_id.invalid", "Platform lead kimliği geçersiz.", { value: raw }));
    }
    return ok(new PlatformLeadId(v));
  }
  toString(): string {
    return this.value;
  }
}

export interface Person {
  id: string;
  fullName: string;
  emailNormalized: string | null;
  phoneE164: string | null;
  country: string | null;
  company: string;
  /** Kuruluş bağı (Faz 6d); null = bağsız. */
  organizationId: string | null;
  /** Faz 7d: başka bir kişiye birleştirildiyse o kişinin kimliği; listelerde gizlenir, silinmez. */
  mergedIntoId: string | null;
  createdAt: Date;
}

export interface CampaignInfo {
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  adId: string | null;
  adName: string | null;
}

export interface Lead {
  id: string;
  source: LeadSource;
  platformLeadId: string | null;
  formId: string | null;
  personId: string;
  fullName: string;
  email: string | null;
  phoneE164: string | null;
  country: string | null;
  city: string;
  company: string;
  productInterest: string;
  campaign: CampaignInfo;
  /** null = ortak havuz */
  assignedUserId: string | null;
  currentStage: StageCode;
  isTest: boolean;
  notes: string;
  extraAnswers: Record<string, unknown>;
  /** Fırsat alanları (Faz 6b, ADR-0013 madde 5). Tutar aşama olayında. */
  courtCount: number | null;
  courtModel: string;
  /** Takvim günü YYYY-MM-DD; saat yok. */
  expectedCloseDate: string | null;
  /** Kuruluş bağı (Faz 6d); null = bağsız. `company` metni geçiş süresince kalır. */
  organizationId: string | null;
  /** Satış takip alanları (Faz 7g, ADR-0014). Müşteri durumu aşamadan bağımsızdır (D1); null = "Durum girilmedi". */
  customerStatus: CustomerStatus | null;
  /** Ürün tercihleri ve çatı ölçüsü (D4); `court_count` bunlardan yazılmaz. */
  products: ProductPrefs;
  /** Form cevapları (D5): intake doldurur, yönetici düzeltir. */
  installSite: InstallSite | null;
  installTimeline: InstallTimeline | null;
  customerProfile: CustomerProfile | null;
  courtCountBand: CourtCountBand | null;
  /** Reklam yüzeyi, opak kod (`ig`, `fb`, `web`…); etiket yalnız arayüzde. */
  adSurface: string | null;
  /** Yöneticinin "Kontrol edildi" dediği veri uyarısı kodları (D6). */
  checkedWarnings: string[];
  /** Temas geçmişi bilinmeyen eski kayıt (köken olgusu, uyarı değil): "Hiç ulaşılmadı"ya sayılmaz. */
  contactHistoryUnknown: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type LeadTrackingFields = Pick<
  Lead,
  | "customerStatus"
  | "products"
  | "installSite"
  | "installTimeline"
  | "customerProfile"
  | "courtCountBand"
  | "adSurface"
  | "checkedWarnings"
  | "contactHistoryUnknown"
>;

/** Yeni lead'in satış takip alanları: hepsi boş. Her çağrı yeni nesne döner (paylaşılan dizi/nesne yok). */
export const emptyTrackingFields = (): LeadTrackingFields => ({
  customerStatus: null,
  products: { ...EMPTY_PRODUCTS, roof: { ...EMPTY_PRODUCTS.roof } },
  installSite: null,
  installTimeline: null,
  customerProfile: null,
  courtCountBand: null,
  adSurface: null,
  checkedWarnings: [],
  contactHistoryUnknown: false,
});

export type StageEventOrigin = "manual" | "auto_fill" | "system";

export interface StageEvent {
  id: string;
  leadId: string;
  /** Aynı "sonraki aşama" tıkının ürettiği satırları gruplar; geri al bu grubu hedefler. */
  changeId: string;
  stageCode: StageCode;
  occurredAt: Date;
  sequence: number;
  actorUserId: string | null;
  origin: StageEventOrigin;
  value: { amount: number; currency: string } | null;
  lostReasonCode: string | null;
  qualificationAnswers: Record<string, boolean> | null;
  undoneAt: Date | null;
}

/** Tıklama kimlikleri ve UTM (lead_attribution, 1:1). Alan adları sektör standardı parametre adlarıdır. */
export interface LeadAttribution {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  fbclid: string | null;
  fbc: string | null;
  fbp: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  landingUrl: string | null;
  clickAt: Date | null;
}

export const EMPTY_ATTRIBUTION: LeadAttribution = {
  gclid: null,
  gbraid: null,
  wbraid: null,
  fbclid: null,
  fbc: null,
  fbp: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmTerm: null,
  utmContent: null,
  landingUrl: null,
  clickAt: null,
};

export const hasAttribution = (a: Partial<LeadAttribution>): boolean =>
  Object.values(a).some((v) => v !== null && v !== undefined && v !== "");

/**
 * KVKK / iletişim onayı (lead_consents). `type` kısıtlı bir koddur (ör. "kvkk", "marketing");
 * `textVersion` onay anındaki aydınlatma metninin sürümüdür; metnin kendisi saklanmaz.
 */
export interface LeadConsent {
  id: string;
  leadId: string;
  type: string;
  granted: boolean;
  textVersion: string;
  grantedAt: Date;
}

export interface ConsentInput {
  type: string;
  granted: boolean;
  textVersion?: string | null;
  /** Onayın formda verildiği an; yoksa lead'in oluşturulma anı. */
  grantedAt?: Date | null;
}

const CONSENT_TYPE_RE = /^[a-z][a-z0-9_]{0,63}$/;

/** Onay girdilerini doğrular; tipi geçersiz olan ilk kayıt için RuleError döner. */
export function parseConsents(inputs: readonly ConsentInput[]): Result<ConsentInput[], RuleError> {
  const out: ConsentInput[] = [];
  for (const c of inputs) {
    const type = String(c.type ?? "").trim();
    if (!CONSENT_TYPE_RE.test(type)) {
      return err(new RuleError("consent.type_invalid", "Onay türü geçersiz.", { type: c.type }));
    }
    if (typeof c.granted !== "boolean") {
      return err(new RuleError("consent.granted_invalid", "Onay değeri true/false olmalı.", { type }));
    }
    out.push({
      type,
      granted: c.granted,
      textVersion: String(c.textVersion ?? "")
        .trim()
        .slice(0, 64),
      grantedAt: c.grantedAt ?? null,
    });
  }
  return ok(out);
}

export const EMPTY_CAMPAIGN: CampaignInfo = {
  campaignId: null,
  campaignName: null,
  adsetId: null,
  adsetName: null,
  adId: null,
  adName: null,
};
