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
});
