import { describe, expect, it } from "vitest";
import { applyMappings, resolveMappings, type FieldMapping } from "./mapping";

const row = (platformField: string, target: FieldMapping["target"], formId: string | null = null): FieldMapping => ({
  id: `${formId ?? "*"}:${platformField}`,
  provider: "p",
  formId,
  platformField,
  target,
  isActive: true,
});

describe("resolveMappings", () => {
  it("sağlayıcı varsayılanı + form satırı; form satırı ezer; pasif satır yok sayılır", () => {
    const all = [
      row("full_name", "full_name"),
      row("question_1", "extra"),
      row("question_1", "product_interest", "form-A"),
      { ...row("email", "email"), isActive: false },
    ];
    const generic = resolveMappings(all, null);
    expect(generic.get("question_1")).toBe("extra");
    expect(generic.has("email")).toBe(false);
    const formA = resolveMappings(all, "form-A");
    expect(formA.get("question_1")).toBe("product_interest");
    expect(formA.get("full_name")).toBe("full_name");
    expect(resolveMappings(all, "form-B").get("question_1")).toBe("extra");
  });
});

describe("applyMappings", () => {
  const map = resolveMappings(
    [
      row("full_name", "full_name"),
      row("first_name", "first_name"),
      row("last_name", "last_name"),
      row("email", "email"),
      row("work_email", "email"),
      row("phone_number", "phone"),
      row("country", "country"),
      row("city", "city"),
      row("company_name", "company"),
      row("job_title", "extra"),
      row("note", "notes"),
      row("note2", "notes"),
      row("hidden", "ignore"),
    ],
    null,
  );

  it("alanları hedeflere dağıtır; aynı hedefte ilk dolu değer kazanır; notlar birleşir", () => {
    const out = applyMappings(
      [
        { key: "full_name", value: " Ayşe Demir " },
        { key: "email", value: "" },
        { key: "work_email", value: "ayse@firma.com" },
        { key: "phone_number", value: "+905321234567" },
        { key: "country", value: "TR" },
        { key: "city", value: "İzmir" },
        { key: "company_name", value: "Demir Spor" },
        { key: "job_title", label: "Görev", value: "Müdür" },
        { key: "note", value: "a" },
        { key: "note2", value: "b" },
        { key: "hidden", value: "x" },
      ],
      map,
      "extra",
    );
    expect(out).toMatchObject({
      fullName: "Ayşe Demir",
      email: "ayse@firma.com",
      phone: "+905321234567",
      country: "TR",
      city: "İzmir",
      company: "Demir Spor",
      notes: "a\nb",
      extra: { Görev: "Müdür" },
      unmapped: [],
    });
  });

  it("ad + soyad birleşir; büyük/küçük harf duyarsız", () => {
    const out = applyMappings(
      [
        { key: "FIRST_NAME", value: "Ali" },
        { key: "Last_Name", value: "Can" },
      ],
      map,
      "extra",
    );
    expect(out.fullName).toBe("Ali Can");
  });

  it("eşlenmeyen alan: politika extra → ek yanıt; ignore → atılır; her durumda unmapped listesinde", () => {
    const fields = [
      { key: "custom_q", label: "Kort sayısı?", value: ["2", "3"] },
      { key: "other", value: 42 },
    ];
    const kept = applyMappings(fields, map, "extra");
    expect(kept.unmapped).toEqual(["custom_q", "other"]);
    expect(kept.extra).toEqual({ "Kort sayısı?": ["2", "3"], other: "42" });
    const dropped = applyMappings(fields, map, "ignore");
    expect(dropped.unmapped).toEqual(["custom_q", "other"]);
    expect(dropped.extra).toEqual({});
  });

  it("etiket çakışırsa alan anahtarı kullanılır; null değer boş metin", () => {
    const out = applyMappings(
      [
        { key: "q1", label: "Soru", value: "a" },
        { key: "q2", label: "Soru", value: null },
      ],
      map,
      "extra",
    );
    expect(out.extra).toEqual({ Soru: "a", q2: "" });
  });
});
