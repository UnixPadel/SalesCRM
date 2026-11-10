import { describe, expect, it } from "vitest";
import { summarizeContacts, type ContactSummary } from "./contact";
import {
  dataWarnings,
  IMPORT_ISSUE_CODES,
  isWarningCode,
  openWarnings,
  PROVENANCE_KEYS,
  REP_VISIBLE_WARNINGS,
  visibleWarnings,
  WARNING_CODES,
  WARNING_SEVERITY,
  WARNINGS_CLEARED_BY,
  type DataWarning,
  type WarningCode,
} from "./dataQuality";
import { EMPTY_CAMPAIGN, emptyTrackingFields, type Lead } from "./lead";

const TZ = "Europe/Istanbul";

// Sentetik numaralar (kişisel veri yok); TR_INVALID olası uzunlukta ama plana uymuyor.
const TR_MOBILE = "+905320000001";
const GB_MOBILE = "+447400123456";
const CA_NUMBER = "+12045550123";
const TR_INVALID = "+901111111111";

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: "l1",
  source: "manual",
  platformLeadId: null,
  formId: null,
  personId: "p1",
  fullName: "Test Lead",
  email: null,
  phoneE164: TR_MOBILE,
  country: "TR",
  city: "",
  company: "",
  productInterest: "",
  campaign: EMPTY_CAMPAIGN,
  assignedUserId: null,
  currentStage: "NEW",
  isTest: false,
  notes: "",
  extraAnswers: {},
  courtCount: null,
  courtModel: "",
  expectedCloseDate: null,
  organizationId: null,
  ...emptyTrackingFields(),
  createdAt: new Date("2026-11-02T06:00:00Z"),
  updatedAt: new Date("2026-11-02T06:00:00Z"),
  ...over,
});

const NONE: ContactSummary = summarizeContacts([], false);
const contactAt = (iso: string): ContactSummary => ({ ...NONE, state: "contacted", count: 1, firstAt: new Date(iso) });

const codes = (l: Lead, c: ContactSummary = NONE): WarningCode[] => dataWarnings(l, c, TZ).map((w) => w.code);
const only = (l: Lead, code: WarningCode, c: ContactSummary = NONE): DataWarning | undefined =>
  dataWarnings(l, c, TZ).find((w) => w.code === code);

describe("dataWarnings", () => {
  it("temiz lead: uyarı yok", () => {
    expect(dataWarnings(lead(), NONE, TZ)).toEqual([]);
  });

  it("phone_country_mismatch: arama kodu karşılaştırılır, ülke değil [M-M2]", () => {
    expect(only(lead({ phoneE164: GB_MOBILE, country: "TR" }), "phone_country_mismatch")).toEqual({
      code: "phone_country_mismatch",
      severity: "warn",
      checked: false,
      params: { phoneCode: "+44", country: "TR" },
    });
    // Kanada numarası, ülke ABD: ikisi de +1 → uyarı yok (yerel yanlış pozitif).
    expect(codes(lead({ phoneE164: CA_NUMBER, country: "US" }))).toEqual([]);
    // Ülke ya da telefon yoksa, ülke bilinmiyorsa karşılaştırılmaz.
    expect(codes(lead({ phoneE164: GB_MOBILE, country: "FX" }))).not.toContain("phone_country_mismatch");
    expect(codes(lead({ phoneE164: GB_MOBILE, country: null }))).not.toContain("phone_country_mismatch");
  });

  it("phone_invalid: numara var, plana uymuyor", () => {
    expect(codes(lead({ phoneE164: TR_INVALID }))).toEqual(["phone_invalid"]);
    expect(codes(lead({ phoneE164: "+1" }))).toEqual(["phone_invalid"]);
  });

  it("phone_unreadable: telefon yok, ham değer var", () => {
    expect(codes(lead({ phoneE164: null, extraAnswers: { phone_raw: "######" } }))).toEqual(["phone_unreadable"]);
    expect(codes(lead({ phoneE164: null, extraAnswers: { phone_raw: "  " } }))).toEqual([]);
    expect(codes(lead({ phoneE164: null }))).toEqual([]);
    // Telefon varsa ham değer önemsiz.
    expect(codes(lead({ extraAnswers: { phone_raw: "######" } }))).toEqual([]);
  });

  it("country_missing: warn; import kaynağında info [M-M15]", () => {
    expect(only(lead({ country: null }), "country_missing")?.severity).toBe("warn");
    expect(only(lead({ country: null, source: "import" }), "country_missing")?.severity).toBe("info");
  });

  it("contact_before_lead: takvim günü saat dilimine göre", () => {
    const l = lead({ createdAt: new Date("2026-11-02T06:00:00Z") });
    expect(codes(l, contactAt("2026-11-01T20:59:00Z"))).toEqual(["contact_before_lead"]); // İstanbul 1 Kas 23:59
    expect(codes(l, contactAt("2026-11-01T21:00:00Z"))).toEqual([]); // İstanbul 2 Kas 00:00
    expect(codes(l, contactAt("2026-11-05T08:00:00Z"))).toEqual([]);
    expect(codes(l, NONE)).toEqual([]);
  });

  it("roof_size_missing: Kapatma seçili ve ölçülerden biri boş", () => {
    const roof = (widthM: number | null, lengthM: number | null) =>
      lead({ products: { ...emptyTrackingFields().products, roof: { wanted: true, widthM, lengthM } } });
    expect(codes(roof(null, null))).toEqual(["roof_size_missing"]);
    expect(codes(roof(20, null))).toEqual(["roof_size_missing"]);
    expect(codes(roof(20, 10))).toEqual([]);
  });

  it("import_review: import_issues boş değilse, parametre kod listesi", () => {
    expect(only(lead({ extraAnswers: { import_issues: ["excel_warning", "k_without_j"] } }), "import_review")).toEqual({
      code: "import_review",
      severity: "warn",
      checked: false,
      params: { issues: "excel_warning,k_without_j" },
    });
    expect(only(lead({ extraAnswers: { import_issues: "status_unknown" } }), "import_review")?.params).toEqual({
      issues: "status_unknown",
    });
    expect(codes(lead({ extraAnswers: { import_issues: [] } }))).toEqual([]);
    expect(codes(lead({ extraAnswers: { import_issues: ["", 3] } }))).toEqual([]);
  });

  it("country_from_phone ve dial_code_assumed bilgi düzeyinde", () => {
    const w = dataWarnings(lead({ extraAnswers: { country_source: "phone", dial_code_assumed: "+90" } }), NONE, TZ);
    expect(w).toEqual([
      { code: "country_from_phone", severity: "info", checked: false },
      { code: "dial_code_assumed", severity: "info", checked: false, params: { dialCode: "+90" } },
    ]);
    expect(codes(lead({ extraAnswers: { country_source: "form" } }))).toEqual([]);
  });

  it("status_stage_conflict: İlgisiz ∧ açık aşama ya da Alıcı ∧ Kaybedildi", () => {
    expect(
      only(lead({ customerStatus: "not_interested", currentStage: "CONTACTED" }), "status_stage_conflict"),
    ).toEqual({
      code: "status_stage_conflict",
      severity: "info",
      checked: false,
      params: { status: "not_interested", stage: "CONTACTED" },
    });
    expect(codes(lead({ customerStatus: "not_interested", currentStage: "LOST" }))).toEqual([]);
    expect(codes(lead({ customerStatus: "not_interested", currentStage: "WON" }))).toEqual([]);
    expect(codes(lead({ customerStatus: "buyer_ready", currentStage: "LOST" }))).toEqual(["status_stage_conflict"]);
    expect(codes(lead({ customerStatus: "buyer_ready", currentStage: "PROPOSAL" }))).toEqual([]);
    expect(codes(lead({ customerStatus: "interested", currentStage: "LOST" }))).toEqual([]);
  });

  it("birden çok uyarı WARNING_CODES sırasıyla; checked lead.checkedWarnings'ten", () => {
    const l = lead({
      phoneE164: GB_MOBILE,
      country: "TR",
      customerStatus: "not_interested",
      extraAnswers: { import_issues: ["excel_warning"], country_source: "phone" },
      checkedWarnings: ["import_review", "phone_invalid"],
    });
    const w = dataWarnings(l, NONE, TZ);
    expect(w.map((x) => x.code)).toEqual([
      "phone_country_mismatch",
      "import_review",
      "country_from_phone",
      "status_stage_conflict",
    ]);
    expect(w.map((x) => x.checked)).toEqual([false, true, false, false]);
  });
});

describe("visibleWarnings ve openWarnings", () => {
  const all = dataWarnings(
    lead({
      phoneE164: GB_MOBILE,
      country: "TR",
      products: { ...emptyTrackingFields().products, roof: { wanted: true, widthM: null, lengthM: null } },
      extraAnswers: { import_issues: ["excel_warning"], dial_code_assumed: "+44" },
      checkedWarnings: ["roof_size_missing"],
    }),
    NONE,
    TZ,
  );

  it("yönetici hepsini görür", () => {
    expect(visibleWarnings(all, true)).toBe(all);
    expect(all.map((w) => w.code)).toEqual([
      "phone_country_mismatch",
      "roof_size_missing",
      "import_review",
      "dial_code_assumed",
    ]);
  });

  it("satışçı yalnız telefon ve çatı uyarılarını, kontrol edilmemişse görür [U-I18]", () => {
    expect(visibleWarnings(all, false).map((w) => w.code)).toEqual(["phone_country_mismatch"]);
  });

  it("openWarnings: kontrol edilmemiş warn uyarıları (⚠ n ve Uyarılı süzgeci)", () => {
    expect(openWarnings(all).map((w) => w.code)).toEqual(["phone_country_mismatch", "import_review"]);
  });
});

describe("uyarı sabitleri", () => {
  it("kod listesi, önem ve satışçı görünürlüğü tutarlı", () => {
    expect(WARNING_CODES).toHaveLength(10);
    expect(Object.keys(WARNING_SEVERITY).sort()).toEqual([...WARNING_CODES].sort());
    expect(REP_VISIBLE_WARNINGS.every((c) => WARNING_CODES.includes(c))).toBe(true);
    for (const c of WARNING_CODES) expect(isWarningCode(c)).toBe(true);
    expect(isWarningCode("sms")).toBe(false);
    expect(isWarningCode(undefined)).toBe(false);
  });

  it("temizlenen kodlar ve köken anahtarları", () => {
    for (const list of Object.values(WARNINGS_CLEARED_BY)) for (const c of list) expect(isWarningCode(c)).toBe(true);
    expect(PROVENANCE_KEYS.country).toEqual(["country_source", "country_raw"]);
    expect(PROVENANCE_KEYS.phone).toEqual(["phone_raw", "dial_code_assumed"]);
    expect(IMPORT_ISSUE_CODES).toContain("roof_dims_without_tick");
  });
});
