import { describe, expect, it } from "vitest";
import { countryName, countryOptions, setCountryLang } from "../src/domain/constants";

describe("countryName", () => {
  it("tablodaki ad önceliklidir", () => {
    expect(countryName("TR")).toBe("Türkiye");
    expect(countryName("GB")).toBe("Birleşik Krallık");
  });
  it("tabloda olmayan ISO kodları da Türkçe adıyla yazılır", () => {
    expect(countryName("OM")).toBe("Umman");
    expect(countryName("NZ")).toBe("Yeni Zelanda");
    expect(countryName("AM")).toBe("Ermenistan");
    expect(countryName("IQ")).toBe("Irak");
    expect(countryName("om")).toBe("Umman");
  });
  it("boş ve tanınmayan değerler", () => {
    expect(countryName("")).toBe("Belirsiz");
    expect(countryName("QQ")).toBe("QQ");
    expect(countryName("Atlantis")).toBe("Atlantis");
  });
});

describe("countryName: arayüz dili", () => {
  it("İngilizcede adlar İngilizce, Türkçede Türkçe", () => {
    expect(countryName("DE", "en")).toBe("Germany");
    expect(countryName("GB", "en")).toBe("United Kingdom");
    expect(countryName("OM", "en")).toBe("Oman");
    expect(countryName("", "en")).toBe("Unknown");
    expect(countryName("DE", "tr")).toBe("Almanya");
  });
  it("seçili dil varsayılan olur; seçim listesi o dilde sıralanır", () => {
    setCountryLang("en");
    expect(countryName("DE")).toBe("Germany");
    const en = countryOptions();
    expect(en.find(([c]) => c === "ES")?.[1]).toBe("Spain");
    expect(en.map(([, n]) => n)).toEqual([...en.map(([, n]) => n)].sort((a, b) => a.localeCompare(b, "en")));
    setCountryLang("tr");
    expect(countryName("DE")).toBe("Almanya");
    expect(countryOptions().find(([c]) => c === "ES")?.[1]).toBe("İspanya");
  });
});

describe("countryOptions: bütün ülkeler", () => {
  it("tabloda olmayan ülkeler de listede ve adlı", () => {
    const opts = countryOptions("tr");
    expect(opts.length).toBeGreaterThanOrEqual(249);
    expect(new Set(opts.map(([c]) => c)).size).toBe(opts.length);
    expect(opts.find(([c]) => c === "OM")?.[1]).toBe("Umman");
    expect(opts.find(([c]) => c === "NZ")?.[1]).toBe("Yeni Zelanda");
    expect(opts.find(([c]) => c === "US")?.[1]).toBe("ABD");
    expect(opts.every(([c, n]) => n && n !== c)).toBe(true);
  });
});
