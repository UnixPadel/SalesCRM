import { describe, expect, it } from "vitest";
import { parseCatalogCsv } from "./catalogCsv";

/** Ürün dosyasının biçimi (UrunKategorileri dışa aktarımı); satırlar örnek, kişisel veri yok. */
const FILE = [
  '﻿"KategoriID","KategoriAdi","Stok","Fiyat","CreatedAt","UpdatedAt","CreatedBy","UpdatedBy","Currency","ImageUrl"',
  '21,Standard Padel Court,0,15500.00,"2025-10-14 13:14:08","2025-10-14 13:14:08",,,TRY,',
  '32,Half – Close Canopy,0,0.00,"2025-10-14 13:14:08","2025-10-14 13:14:08",,,TRY,',
  '69,"Roof - Side Retractable, ""XL""",0,59570.00,"2025-10-14 13:14:08","2025-10-14 13:14:08",,,TRY,',
  "",
].join("\r\n");

describe("parseCatalogCsv", () => {
  it("yalnız numara ve ad alınır; tırnaklı alan, virgül ve çift tırnak korunur", () => {
    expect(parseCatalogCsv(FILE)).toEqual({
      ok: true,
      rows: [
        { id: "21", name: "Standard Padel Court" },
        { id: "32", name: "Half – Close Canopy" },
        { id: "69", name: 'Roof - Side Retractable, "XL"' },
      ],
    });
  });

  it("noktalı virgüllü dosya da okunur", () => {
    expect(parseCatalogCsv("KategoriID;KategoriAdi\n27;Padel Court Cover\n")).toEqual({
      ok: true,
      rows: [{ id: "27", name: "Padel Court Cover" }],
    });
  });

  it("sütunlar yoksa ya da dosya boşsa okunmaz", () => {
    expect(parseCatalogCsv("Ad,Fiyat\nX,1\n")).toEqual({ ok: false, reason: "columns" });
    expect(parseCatalogCsv("")).toEqual({ ok: false, reason: "empty" });
    expect(parseCatalogCsv("KategoriID,KategoriAdi\n")).toEqual({ ok: false, reason: "empty" });
  });
});
