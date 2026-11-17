import { describe, expect, it } from "vitest";
import { extraAnswerRows } from "./extraAnswersView";

describe("extraAnswerRows", () => {
  it("nesneyi bir düzey açar, köken anahtarlarını gizler, bilinenleri etiketler", () => {
    const rows = extraAnswerRows({
      excel_no: "12",
      mysql: { musteri: 5, kaynak: "eski" },
      country_source: "phone",
      import_issues: ["excel_warning"],
      liste: ["a", "b"],
    });
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["extra.excel_no", "12"],
      ["mysql · musteri", "5"],
      ["mysql · kaynak", "eski"],
      ["liste", "a, b"],
    ]);
    expect(rows.some((r) => r.value.includes("[object Object]"))).toBe(false);
  });

  it("ham form anahtarlarını ve seçenek kodlarını okunur yazar; platform ve evet/hayır çevrilir", () => {
    const rows = extraAnswerRows({
      platform: "fb",
      is_organic: false,
      "kort_nereye_kurulacak?": "full_cover_padel_court_",
      "sizi_en_iyi_hangisi_tanımlıyor?": "padel_kulübü_sahibi_/_işletmecisi",
      "kurulumu_ne_zaman_planlıyorsunuz?": "şimdilik_araştırıyorum",
      excel_owner: "Ad_Soyad",
      not: "kendi yazdığı cevap",
    });
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["extra.platform", "Facebook"],
      ["extra.is_organic", "common.no"],
      ["Kort nereye kurulacak?", "Full cover padel court"],
      ["Sizi en iyi hangisi tanımlıyor?", "Padel kulübü sahibi / işletmecisi"],
      ["Kurulumu ne zaman planlıyorsunuz?", "Şimdilik araştırıyorum"],
      ["extra.excel_owner", "Ad_Soyad"],
      ["not", "kendi yazdığı cevap"],
    ]);
    expect(rows[1]!.valueKey).toBe(true);
  });
});
