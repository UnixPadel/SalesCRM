import { describe, expect, it } from "vitest";
import { fold, normalizeFormAnswers, parseCourtAnswer } from "./formAnswers";

/** Faz 7g S5: form cevapları → kodlar (iş emri §4.7). */
describe("fold", () => {
  it("Türkçe harfleri katlar, işaretleri boşluğa çevirir", () => {
    expect(fold("Tam kapalı / çatılı kort")).toBe("tam kapali catili kort");
    expect(fold("  Şimdilik ARAŞTIRIYOR ")).toBe("simdilik arastiriyor");
    expect(fold("within_3-6_months")).toBe("within 3 6 months");
  });
});

describe("normalizeFormAnswers", () => {
  it("Excel etiketleri", () => {
    const r = normalizeFormAnswers({
      install_site: "Çatı üstü (rooftop)",
      install_timeline: "3 ay içinde",
      customer_profile: "Kulüp sahibi / işletmeci",
      court_count: "2-3 kort",
    });
    expect(r).toMatchObject({
      installSite: "rooftop",
      installTimeline: "m0_3",
      customerProfile: "club_operator",
      courtCountBand: "2_3",
      courtCount: null,
      unmatched: [],
    });
  });

  it("API anahtarları ve soru tespiti extra'dan", () => {
    const r = normalizeFormAnswers(
      {},
      {
        "where_do_you_plan_to_install_the_court(s)?": "full_cover_padel_court_",
        what_is_your_estimated_project_timeline: "within_6-12_months",
        how_many_courts_do_you_need: "4",
        city: "İzmir",
      },
    );
    expect(r).toMatchObject({
      installSite: "covered_court",
      installTimeline: "m6_12",
      courtCount: 4,
      courtCountBand: "4_6",
    });
  });

  it("eşleşmeyen cevap boş kalır ve unmatched'a yazılır; açık eşleme önceliklidir", () => {
    const r = normalizeFormAnswers({ install_site: "Ay'da" }, { "kurulum yeri": "Kapalı salon" });
    expect(r.installSite).toBeNull();
    expect(r.unmatched).toEqual([{ target: "install_site", raw: "Ay'da" }]);
  });

  it("web sitesi teklif formu: project_type → müşteri profili, court_count → kort sayısı", () => {
    const cases: [string, string][] = [
      ["Sports club", "club_operator"],
      ["Hotel / resort", "hospitality_residential"],
      ["Municipality / public", "public_facility"],
      ["Private / residential", "private_home"],
      ["Distributor / partner", "distributor"],
    ];
    for (const [label, profile] of cases) {
      const r = normalizeFormAnswers({}, { project_type: label, court_count: "3", product_slug: "panoramic" });
      expect(r).toMatchObject({ customerProfile: profile, courtCount: 3, courtCountBand: "2_3", unmatched: [] });
    }
    // Mimar / danışman bir müşteri profili değildir: alan boş, ham değer unmatched'ta.
    const arch = normalizeFormAnswers({}, { project_type: "Architect / consultant" });
    expect(arch.customerProfile).toBeNull();
    expect(arch.unmatched).toEqual([{ target: "customer_profile", raw: "Architect / consultant" }]);
  });

  it("Meta 'Plate Court - Qualified Lead' 2026 formları: TR ve EN anahtarları, her seçenek eşleşir", () => {
    const tr = (site: string, when: string, who: string, courts: string) => ({
      "kort_nereye_kurulacak?": site,
      "kurulumu_ne_zaman_planlıyorsunuz?": when,
      "sizi_en_iyi_hangisi_tanımlıyor?": who,
      "kaç_kort_planlıyorsunuz?": courts,
    });
    expect(
      normalizeFormAnswers(
        {},
        tr(
          "Mevcut tenis kortu / asfalt / beton zemin",
          "3-6 ay içinde",
          "Yeni padel tesisi açacak yatırımcı",
          "2-3 kort",
        ),
      ),
    ).toMatchObject({
      installSite: "existing_ground",
      installTimeline: "m3_6",
      customerProfile: "investor",
      courtCountBand: "2_3",
      unmatched: [],
    });
    const trOptions = {
      site: [
        "Mevcut tenis kortu / asfalt / beton zemin",
        "Çatı / teras",
        "Kapalı salon",
        "Sahil / rüzgarlı alan",
        "Henüz arazi/yer yok",
      ],
      when: ["3 ay içinde", "3-6 ay içinde", "6-12 ay içinde", "Şimdilik araştırıyorum"],
      who: [
        "Padel kulübü sahibi / işletmecisi",
        "Yeni padel tesisi açacak yatırımcı",
        "Otel / tatil köyü / konut projesi",
        "Okul / belediye / spor tesisi",
        "Distribütör / bayi",
        "Evim için özel kort",
      ],
      courts: ["1 kort", "2-3 kort", "4-6 kort", "7+ kort"],
    };
    for (let i = 0; i < 6; i++) {
      const r = normalizeFormAnswers(
        {},
        tr(trOptions.site[i % 5]!, trOptions.when[i % 4]!, trOptions.who[i]!, trOptions.courts[i % 4]!),
      );
      expect(r.unmatched).toEqual([]);
    }
    const en = normalizeFormAnswers(
      {},
      {
        "where_will_the_court_be_installed?": "Existing tennis court / asphalt / concrete",
        "when_do_you_plan_to_install?": "Just researching for now",
        "which_best_describes_you?": "Private court for my home",
        "how_many_courts_are_you_planning?": "7+ courts",
      },
    );
    expect(en).toMatchObject({
      installSite: "existing_ground",
      installTimeline: "researching",
      customerProfile: "private_home",
      courtCountBand: "7_plus",
      unmatched: [],
    });
  });
});

describe("parseCourtAnswer", () => {
  it.each([
    ["1", { courtCount: 1, band: "1" }],
    ["3", { courtCount: 3, band: "2_3" }],
    ["12", { courtCount: 12, band: "7_plus" }],
    ["2-3", { courtCount: null, band: "2_3" }],
    ["3 or 4", { courtCount: null, band: "4_6" }],
    ["two", { courtCount: 2, band: "2_3" }],
    ["iki", { courtCount: 2, band: "2_3" }],
    ["7+ kort", { courtCount: null, band: "7_plus" }],
  ])("%s", (raw, expected) => {
    expect(parseCourtAnswer(raw)).toEqual(expected);
  });

  it("anlamsız ve sınır dışı değerler null", () => {
    expect(parseCourtAnswer("belki")).toBeNull();
    expect(parseCourtAnswer("0")).toBeNull();
    expect(parseCourtAnswer("")).toBeNull();
  });
});
