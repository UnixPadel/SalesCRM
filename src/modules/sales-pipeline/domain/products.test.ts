import { describe, expect, it } from "vitest";
import {
  checkCatalogRefs,
  emptyProducts,
  hasAnyProduct,
  parseCatalogRows,
  parseProductPrefs,
  planCatalogImport,
  productNameKey,
  productQty,
  type CatalogProduct,
} from "./products";

const code = (raw: unknown) => {
  const r = parseProductPrefs(raw);
  return r.ok ? "ok" : r.error.code;
};

const catalog: CatalogProduct[] = [
  { id: 21, name: "Standard Padel Court", active: true, sortOrder: 1 },
  { id: 22, name: "Panoramic Padel Court", active: true, sortOrder: 2 },
  { id: 27, name: "Padel Court Cover", active: true, sortOrder: 7 },
  { id: 41, name: "Roof Cover", active: false, sortOrder: 21 },
];

describe("parseProductPrefs", () => {
  it("ürün numarası + adet; numaraya göre sıralı döner", () => {
    const r = parseProductPrefs([
      { productId: 27, qty: 1 },
      { productId: 21, qty: 2 },
    ]);
    expect(r.ok && r.value).toEqual([
      { productId: 21, qty: 2 },
      { productId: 27, qty: 1 },
    ]);
  });

  it("null ve boş dizi hepsini temizler", () => {
    expect(parseProductPrefs(null)).toEqual({ ok: true, value: [] });
    expect(parseProductPrefs([])).toEqual({ ok: true, value: [] });
  });

  it("metin sayılar kabul edilir", () => {
    const r = parseProductPrefs([{ productId: "22", qty: "3" }]);
    expect(r.ok && r.value).toEqual([{ productId: 22, qty: 3 }]);
  });

  it("adet 1–29 tam sayı", () => {
    expect(code([{ productId: 21, qty: 0 }])).toBe("product.qty_range");
    expect(code([{ productId: 21, qty: 30 }])).toBe("product.qty_range");
    expect(code([{ productId: 21, qty: 1.5 }])).toBe("product.qty_range");
    expect(code([{ productId: 21, qty: 29 }])).toBe("ok");
  });

  it("geçersiz biçim, numara ve tekrar reddedilir", () => {
    expect(code({ standard: 1 })).toBe("product.invalid");
    expect(code([{ productId: 0, qty: 1 }])).toBe("product.invalid");
    expect(code([1])).toBe("product.invalid");
    expect(
      code([
        { productId: 21, qty: 1 },
        { productId: 21, qty: 2 },
      ]),
    ).toBe("product.duplicate");
  });
});

describe("yardımcılar", () => {
  it("hasAnyProduct / productQty", () => {
    expect(hasAnyProduct(emptyProducts())).toBe(false);
    const p = [{ productId: 22, qty: 4 }];
    expect(hasAnyProduct(p)).toBe(true);
    expect(productQty(p, 22)).toBe(4);
    expect(productQty(p, 21)).toBeNull();
  });

  it("productNameKey: büyük/küçük harf ve fazla boşluk yok sayılır", () => {
    expect(productNameKey("  Padel   Court COVER ")).toBe(productNameKey("padel court cover"));
  });
});

describe("checkCatalogRefs", () => {
  it("listede olmayan ürün reddedilir", () => {
    const r = checkCatalogRefs([{ productId: 99, qty: 1 }], [], catalog);
    expect(!r.ok && r.error.code).toBe("product.unknown");
  });

  it("kullanımdan kalkan ürün yeni eklenemez, lead'de zaten varsa kalır", () => {
    const next = [{ productId: 41, qty: 2 }];
    const r = checkCatalogRefs(next, [], catalog);
    expect(!r.ok && r.error.code).toBe("product.inactive");
    expect(checkCatalogRefs(next, [{ productId: 41, qty: 1 }], catalog).ok).toBe(true);
  });
});

describe("ürün dosyası", () => {
  it("parseCatalogRows: numara ve ad doğrulanır, adlar temizlenir", () => {
    const r = parseCatalogRows([
      { id: "21", name: " Standard  Padel Court " },
      { id: 22, name: "Panoramic Padel Court" },
    ]);
    expect(r.ok && r.value).toEqual([
      { id: 21, name: "Standard Padel Court" },
      { id: 22, name: "Panoramic Padel Court" },
    ]);
    const bad = (rows: { id: unknown; name: unknown }[]) => {
      const x = parseCatalogRows(rows);
      return x.ok ? "ok" : x.error.code;
    };
    expect(bad([])).toBe("catalog.empty");
    expect(bad([{ id: "x", name: "A" }])).toBe("catalog.bad_id");
    expect(bad([{ id: 1, name: " " }])).toBe("catalog.bad_name");
    expect(
      bad([
        { id: 1, name: "A" },
        { id: 1, name: "B" },
      ]),
    ).toBe("catalog.duplicate_id");
    expect(
      bad([
        { id: 1, name: "A" },
        { id: 2, name: "a" },
      ]),
    ).toBe("catalog.duplicate_name");
  });

  it("planCatalogImport: eklenen, adı değişen, kalkan, geri gelen; atlanan yeni ürün eklenmez", () => {
    const plan = planCatalogImport(
      catalog,
      [
        { id: 21, name: "Standard Padel Court" },
        { id: 22, name: "Panoramic Court" },
        { id: 41, name: "Roof Cover" },
        { id: 79, name: "de" },
        { id: 90, name: "Yeni Ürün" },
      ],
      [79],
    );
    expect(plan.added).toEqual([{ id: 90, name: "Yeni Ürün" }]);
    expect(plan.renamed).toEqual([{ id: 22, from: "Panoramic Padel Court", to: "Panoramic Court" }]);
    expect(plan.deactivated).toEqual([{ id: 27, name: "Padel Court Cover" }]);
    expect(plan.reactivated).toEqual([{ id: 41, name: "Roof Cover" }]);
    expect(plan.unchanged).toBe(1);
  });
});
