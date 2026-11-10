import { describe, expect, it } from "vitest";
import {
  courtTotal,
  EMPTY_PRODUCTS,
  hasAnyProduct,
  parseProductPrefs,
  productQty,
  productSummary,
  roofAreaM2,
  type ProductPrefs,
} from "./products";

const prefs = (over: Partial<ProductPrefs> = {}): ProductPrefs => ({
  ...EMPTY_PRODUCTS,
  roof: { ...EMPTY_PRODUCTS.roof },
  ...over,
});

const code = (raw: unknown) => {
  const r = parseProductPrefs(raw);
  return r.ok ? "ok" : r.error.code;
};

describe("parseProductPrefs", () => {
  it("tam girdi", () => {
    const r = parseProductPrefs({
      standard: 1,
      panoramic: 2,
      fullPanoramic: 29,
      roof: { wanted: true, widthM: 20, lengthM: 10 },
    });
    expect(r.ok && r.value).toEqual({
      standard: 1,
      panoramic: 2,
      fullPanoramic: 29,
      roof: { wanted: true, widthM: 20, lengthM: 10 },
    });
  });

  it("değiştirme anlamı: eksik anahtar null/false; null girdi hepsini temizler", () => {
    expect(parseProductPrefs({ panoramic: 2 })).toEqual({
      ok: true,
      value: prefs({ panoramic: 2 }),
    });
    expect(parseProductPrefs({})).toEqual({ ok: true, value: prefs() });
    expect(parseProductPrefs(null)).toEqual({ ok: true, value: prefs() });
    expect(parseProductPrefs({ roof: null })).toEqual({ ok: true, value: prefs() });
    expect(parseProductPrefs({ roof: { wanted: true } })).toEqual({
      ok: true,
      value: prefs({ roof: { wanted: true, widthM: null, lengthM: null } }),
    });
  });

  it("dönen nesne paylaşılmaz (EMPTY_PRODUCTS donmuş kalır)", () => {
    const r = parseProductPrefs(null);
    expect(r.ok && r.value).not.toBe(EMPTY_PRODUCTS);
    expect(r.ok && r.value.roof).not.toBe(EMPTY_PRODUCTS.roof);
    expect(Object.isFrozen(EMPTY_PRODUCTS)).toBe(true);
  });

  it.each([0, 30, -1, 1.5, Number.NaN, "abc", "2.5", true, {}])("adet %j → product.qty_range", (v) => {
    expect(code({ standard: v })).toBe("product.qty_range");
  });

  it("adet: metin rakam kabul, boş metin null", () => {
    expect(parseProductPrefs({ standard: " 3 ", panoramic: "" })).toEqual({ ok: true, value: prefs({ standard: 3 }) });
  });

  it("hata ayrıntısı ürün kodunu taşır", () => {
    const r = parseProductPrefs({ fullPanoramic: 40 });
    expect(!r.ok && r.error.details).toEqual({ product: "full_panoramic", value: 40 });
  });

  it("ölçü: sayı, '10,5' ve '10.5'; 2 ondalığa yuvarlanır", () => {
    const r = parseProductPrefs({ roof: { wanted: true, widthM: "10,5", lengthM: 7.256 } });
    expect(r.ok && r.value.roof).toEqual({ wanted: true, widthM: 10.5, lengthM: 7.26 });
    const s = parseProductPrefs({ roof: { wanted: true, widthM: "10.25", lengthM: " 999,99 " } });
    expect(s.ok && s.value.roof).toEqual({ wanted: true, widthM: 10.25, lengthM: 999.99 });
  });

  it.each([0, -2, 0.004, 1000, 999.996, "abc", "1,000,5", "-3", Number.POSITIVE_INFINITY, true])(
    "ölçü %j → product.roof_size",
    (v) => {
      expect(code({ roof: { wanted: true, widthM: v } })).toBe("product.roof_size");
      expect(code({ roof: { wanted: true, lengthM: v } })).toBe("product.roof_size");
    },
  );

  it("Kapatma işaretsizken ölçü → product.roof_dims_without_roof", () => {
    expect(code({ roof: { wanted: false, widthM: 20 } })).toBe("product.roof_dims_without_roof");
    expect(code({ roof: { lengthM: 10 } })).toBe("product.roof_dims_without_roof");
    expect(code({ roof: { wanted: false, widthM: "", lengthM: null } })).toBe("ok");
  });

  it.each([[[]], ["2 Panoramic"], [5], [{ roof: "evet" }], [{ roof: [] }], [{ roof: { wanted: "true" } }]])(
    "biçimsiz girdi %j → product.invalid",
    (raw) => {
      expect(code(raw)).toBe("product.invalid");
    },
  );
});

describe("türetilen ürün değerleri", () => {
  it("courtTotal, productQty, hasAnyProduct", () => {
    const p = prefs({ standard: 2, fullPanoramic: 1 });
    expect(courtTotal(p)).toBe(3);
    expect(productQty(p, "standard")).toBe(2);
    expect(productQty(p, "panoramic")).toBeNull();
    expect(productQty(p, "full_panoramic")).toBe(1);
    expect(hasAnyProduct(p)).toBe(true);
    expect(hasAnyProduct(prefs())).toBe(false);
    expect(hasAnyProduct(prefs({ roof: { wanted: true, widthM: null, lengthM: null } }))).toBe(true);
    expect(courtTotal(prefs())).toBe(0);
  });

  it("roofAreaM2: iki ölçü de doluysa 2 ondalık; eksikse null", () => {
    expect(roofAreaM2(prefs({ roof: { wanted: true, widthM: 20, lengthM: 10 } }))).toBe(200);
    expect(roofAreaM2(prefs({ roof: { wanted: true, widthM: 10.33, lengthM: 3.33 } }))).toBe(34.4);
    expect(roofAreaM2(prefs({ roof: { wanted: true, widthM: 20, lengthM: null } }))).toBeNull();
  });

  it("productSummary Excel sırasıyla; adetsiz ürün yok; Kapatma ölçüsüz de görünür", () => {
    expect(
      productSummary(prefs({ panoramic: 2, standard: 1, roof: { wanted: true, widthM: 20, lengthM: 10 } })),
    ).toEqual([
      { code: "standard", qty: 1 },
      { code: "panoramic", qty: 2 },
      { code: "roof", widthM: 20, lengthM: 10, areaM2: 200 },
    ]);
    expect(productSummary(prefs({ roof: { wanted: true, widthM: null, lengthM: 8 } }))).toEqual([
      { code: "roof", lengthM: 8, areaM2: null },
    ]);
    expect(productSummary(prefs())).toEqual([]);
  });
});
