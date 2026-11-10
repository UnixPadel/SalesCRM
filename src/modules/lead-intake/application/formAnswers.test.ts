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
