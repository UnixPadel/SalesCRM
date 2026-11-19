import { describe, expect, it } from "vitest";
import type { LeadListDto } from "../../modules/sales-pipeline/api/dto";
import { buildWorkbook, readWorkbook } from "./excelFile";
import {
  EXCEL_COLUMNS,
  excelHeader,
  excelRow,
  excelTexts,
  isEditable,
  layoutMismatch,
  planImport,
  type ParseCtx,
} from "./excelSync";
import type { Ctx } from "./listColumns";

/** Sentetik liste öğeleri (kişisel veri yok). */
const lead = (i: number, over: Partial<LeadListDto> = {}): LeadListDto =>
  ({
    id: `l${i}`,
    fullName: `Lead ${i}`,
    email: `lead${i}@example.com`,
    phoneE164: "+905321234567",
    company: "",
    country: "TR",
    assignedUserId: "u1",
    currentStage: "NEW",
    source: "import",
    createdAt: `2026-10-${String(10 + i).padStart(2, "0")}T06:00:00.000Z`,
    updatedAt: "2026-10-20T06:00:00.000Z",
    customerStatus: null,
    products: [],
    installSite: null,
    installTimeline: null,
    customerProfile: null,
    courtCountBand: null,
    adSurface: null,
    campaign: { campaignName: null },
    extraAnswers: {},
    notes: "",
    warnings: [],
    nextActivity: null,
    proposal: { given: false, at: null, via: null },
    contact: { state: "never", count: 0, firstAt: null, lastAt: null, replied: false, channels: {}, lastOutcome: null },
    ...over,
  }) as unknown as LeadListDto;

const NAMES: Record<string, string> = { u1: "Ayşe Yılmaz", u2: "Enes Kaya" };
const CATALOG = [
  { id: 21, name: "Standard Padel Court", active: true },
  { id: 22, name: "Panoramic Padel Court", active: true },
  { id: 27, name: "Padel Court Cover", active: true },
  { id: 41, name: "Roof Cover", active: false },
];
const COUNTRIES: Record<string, string> = { TR: "Türkiye", DE: "Almanya" };
const ctx: Ctx = {
  t: (k) => k,
  lang: "tr",
  day: (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(iso)),
  nameOf: (id) => (id ? (NAMES[id] ?? id) : "common.pool"),
  stageName: (c) => c,
  countryName: (c) => COUNTRIES[c] ?? c,
  sourceName: (s) => s,
  productName: (id) => CATALOG.find((x) => x.id === id)?.name ?? `#${id}`,
  now: Date.parse("2026-11-10T09:00:00Z"),
};
const p: ParseCtx = {
  ctx,
  owners: [
    { id: "u1", name: "Ayşe Yılmaz" },
    { id: "u2", name: "Enes Kaya" },
  ],
  ref: {
    customerStatuses: ["interested", "not_interested", "buyer_ready"],
    installSites: ["rooftop", "indoor_hall"],
    installTimelines: ["m0_3", "m3_6"],
    customerProfiles: ["investor"],
    courtCountBands: ["1", "2_3"],
    productQtyMax: 29,
    products: CATALOG,
  },
  baseline: null,
  exportedAt: Date.parse("2026-11-01T09:00:00Z"),
};

const header = excelHeader(ctx.t);
const at = (colId: string) => EXCEL_COLUMNS.findIndex((c) => c.id === colId);
/** Dışa aktarılan satırın okunmuş hali; `edits` hücreleri kullanıcının Excel'de yazdıklarıdır. */
const row = (l: LeadListDto, edits: Record<string, string> = {}, n = 2) => {
  const cells = [...EXCEL_COLUMNS.map((c) => c.csv(l, ctx)), l.id];
  for (const [colId, text] of Object.entries(edits)) cells[at(colId)] = text;
  return { n, cells };
};
const leadsOf = (...ls: LeadListDto[]) => new Map(ls.map((l) => [l.id, l]));

describe("Excel düzeni", () => {
  it("liste sütunları sırayla, sonda CRM kimliği; telefon tek sütun, ürünler tek sütun", () => {
    expect(header).toHaveLength(EXCEL_COLUMNS.length + 1);
    expect(header[header.length - 1]).toBe("xl.col.id");
    expect(EXCEL_COLUMNS.map((c) => c.id).slice(0, 5)).toEqual(["createdAt", "name", "phone", "excelNo", "country"]);
    expect(EXCEL_COLUMNS.filter((c) => c.group === "products").map((c) => c.id)).toEqual(["products"]);
    expect(EXCEL_COLUMNS.filter((c) => isEditable(c.id)).map((c) => c.id)).toEqual([
      "name",
      "phone",
      "country",
      "owner",
      "email",
      "status",
      "products",
      "note",
      "site",
      "timeline",
      "profile",
      "band",
    ]);
  });

  it("başlıklar kelimesi kelimesine, aynı sırada ve aynı sayıda olmalı", () => {
    expect(layoutMismatch(header, header)).toBeNull();
    // Görünmeyen farklar (baştaki/sondaki boşluk, bölünemez boşluk) fark sayılmaz.
    expect(
      layoutMismatch(
        header,
        header.map((h) => ` ${h}\u00a0`),
      ),
    ).toBeNull();

    const renamed = header.map((h, i) => (i === 1 ? "Müşteri" : h));
    expect(layoutMismatch(header, renamed)).toEqual({
      expected: header.length,
      actual: header.length,
      at: { n: 2, expected: header[1], actual: "Müşteri" },
    });
    const swapped = [header[1]!, header[0]!, ...header.slice(2)];
    expect(layoutMismatch(header, swapped)?.at?.n).toBe(1);
    expect(
      layoutMismatch(
        header,
        header.map((h) => h.toUpperCase()),
      )?.at?.n,
    ).toBe(1);

    const missing = layoutMismatch(header, header.slice(0, -1));
    expect(missing).toEqual({ expected: header.length, actual: header.length - 1, at: null });
    const extra = layoutMismatch(header, [...header, "Yorum"]);
    expect(extra).toEqual({ expected: header.length, actual: header.length + 1, at: null });
    expect(layoutMismatch(header, [])?.actual).toBe(0);
  });
});

describe("Excel içe aktarım planı", () => {
  it("değişmeyen dosyadan değişiklik çıkmaz", () => {
    const a = lead(1, {
      customerStatus: "interested",
      notes: "Fiyat bekliyor\r\nSalı aranacak",
      products: [
        { productId: 21, qty: 2 },
        { productId: 27, qty: 1 },
      ],
    });
    expect(row(a).cells[at("products")]).toBe("2 Standard Padel Court; 1 Padel Court Cover");
    const plan = planImport([row(a), row(lead(2), {}, 3)], leadsOf(a, lead(2)), p);
    expect(plan).toMatchObject({ leads: [], changeCount: 0, invalid: [], noId: 0, unknown: 0, duplicate: 0 });
  });

  it("değişen hücreler uç noktalarına göre ayrılır; eski ve yeni değer önizlemeye gider", () => {
    const a = lead(1);
    const plan = planImport(
      [
        row(a, {
          name: "Lead Bir",
          country: "Almanya",
          owner: "enes kaya",
          status: "customerStatus.buyer_ready",
          products: "3 panoramic padel court;padel court cover",
          note: "Teklif istedi",
          timeline: "answer.timeline.m3_6",
        }),
      ],
      leadsOf(a),
      p,
    );
    expect(plan.invalid).toEqual([]);
    expect(plan.changeCount).toBe(7);
    expect(plan.leads[0]!.patch).toEqual({
      contact: { fullName: "Lead Bir" },
      fields: {
        country: "DE",
        notes: "Teklif istedi",
        installTimeline: "m3_6",
        products: [
          { productId: 22, qty: 3 },
          { productId: 27, qty: 1 },
        ],
      },
      status: "buyer_ready",
      owner: "u2",
    });
    const change = (colId: string) => plan.leads[0]!.changes.find((c) => c.colId === colId)!;
    expect(change("country")).toMatchObject({ part: "fields", from: "Türkiye (TR)", to: "Almanya (DE)" });
    expect(change("owner")).toMatchObject({ part: "owner", from: "Ayşe Yılmaz", to: "Enes Kaya" });
    expect(change("status")).toMatchObject({ part: "status", from: "" });
  });

  it("boşaltılan hücre alanı temizler; sorumlu havuza döner", () => {
    const a = lead(1, { customerStatus: "interested", notes: "eski not", installSite: "rooftop" });
    const plan = planImport(
      [row(a, { status: "", note: "", site: "", owner: "common.pool", email: "" })],
      leadsOf(a),
      p,
    );
    expect(plan.leads[0]!.patch).toEqual({
      contact: { email: null },
      fields: { notes: "", installSite: null },
      status: null,
      owner: null,
    });
  });

  it("biçim farkı değişiklik sayılmaz: + işareti düşmüş telefon, büyük harfli e-posta, yalnız ülke kodu", () => {
    const a = lead(1);
    const plan = planImport(
      [row(a, { phone: "905321234567", email: "LEAD1@example.com", country: "tr" })],
      leadsOf(a),
      p,
    );
    expect(plan.changeCount).toBe(0);
    expect(planImport([row(a, { phone: "+90 532 000 00 00" })], leadsOf(a), p).leads[0]!.patch.contact).toEqual({
      phone: "+90 532 000 00 00",
    });
  });

  it("programın hesapladığı sütunlardaki değişiklik alınmaz", () => {
    const a = lead(1);
    const plan = planImport([row(a, { stage: "WON", mail: "✔", count: "9", createdAt: "01.01.2020" })], leadsOf(a), p);
    expect(plan.changeCount).toBe(0);
    expect(plan.invalid).toEqual([]);
  });

  it("okunamayan hücre atlanır ve bildirilir; satırın geri kalanı alınır", () => {
    const a = lead(1);
    const plan = planImport(
      [
        row(
          a,
          {
            name: "",
            owner: "Bilinmeyen Kişi",
            status: "Sıcak",
            products: "40 Standard Padel Court",
            country: "Atlantis",
            note: "ok",
          },
          7,
        ),
      ],
      leadsOf(a),
      p,
    );
    expect(plan.invalid.map((x) => [x.row, x.label, x.reason])).toEqual([
      [7, "list.col.name", "xl.bad.required"],
      [7, "list.col.country", "xl.bad.country"],
      [7, "list.col.owner", "xl.bad.owner"],
      [7, "list.col.status", "xl.bad.option"],
      [7, "list.col.products", "xl.bad.qty"],
    ]);
    expect(plan.invalid.find((x) => x.reason === "xl.bad.qty")!.vars).toEqual({ max: 29 });
    expect(plan.leads[0]!.patch).toEqual({ contact: {}, fields: { notes: "ok" } });
  });

  it("kimliksiz, karşılıksız ve yinelenen satırlar atlanır; boş satır sayılmaz", () => {
    const a = lead(1);
    const noId = row(a, { note: "x" }, 3);
    noId.cells[EXCEL_COLUMNS.length] = "";
    const unknown = row(lead(9), { note: "x" }, 4);
    const again = row(a, { note: "ikinci" }, 5);
    const blank = { n: 6, cells: header.map(() => "") };
    const plan = planImport([row(a, { note: "ilk" }), noId, unknown, again, blank], leadsOf(a), p);
    expect(plan).toMatchObject({ noId: 1, unknown: 1, duplicate: 1, changeCount: 1 });
    expect(plan.leads[0]!.patch.fields).toEqual({ notes: "ilk" });
  });

  it("Excel'de dokunulmayan hücre, o arada programda değişmiş olsa bile geri alınmaz", () => {
    // Dışa aktarım anı: not "eski", durum boş. Sonra programda not ve durum değişti; Excel'de yalnız ülke değişti.
    const before = lead(1, { notes: "eski" });
    const now = lead(1, { notes: "programda yeni", customerStatus: "interested", updatedAt: "2026-11-05T09:00:00Z" });
    const baseline = new Map([[before.id, excelTexts(before, ctx)]]);
    const plan = planImport([row(before, { country: "DE" })], leadsOf(now), { ...p, baseline });
    expect(plan.leads[0]!.patch).toEqual({ contact: {}, fields: { country: "DE" } });
    expect(plan.leads[0]!.changes.map((c) => [c.colId, c.conflict])).toEqual([["country", false]]);
    expect(plan.staleCount).toBe(0);

    // Aynı bilgi iki yerde de değiştiyse Excel'deki değer önerilir ve çakışma olarak işaretlenir.
    const both = planImport([row(before, { note: "Excel'de yeni" })], leadsOf(now), { ...p, baseline });
    expect(both.leads[0]!.changes).toMatchObject([
      { colId: "note", from: "programda yeni", to: "Excel'de yeni", conflict: true },
    ]);
    expect(both.staleCount).toBe(1);
    // Gizli sayfa yoksa aynı dosya programdaki değişiklikleri geri alacak biçimde okunur; hepsi işaretlenir.
    const blind = planImport([row(before, { country: "DE" })], leadsOf(now), p);
    expect(blind.leads[0]!.changes.map((c) => [c.colId, c.conflict])).toEqual([
      ["country", true],
      ["status", true],
      ["note", true],
    ]);
  });

  it("gizli sayfa yokken dışa aktarımdan sonra programda güncellenen lead işaretlenir", () => {
    const fresh = lead(1, { updatedAt: "2026-11-05T09:00:00.000Z" });
    const old = lead(2);
    const plan = planImport([row(fresh, { note: "a" }), row(old, { note: "b" }, 3)], leadsOf(fresh, old), p);
    expect(plan.leads.map((l) => l.stale)).toEqual([true, false]);
    expect(plan.staleCount).toBe(1);
    expect(planImport([row(fresh, { note: "a" })], leadsOf(fresh), { ...p, exportedAt: null }).staleCount).toBe(0);
  });
});

describe("Excel dosyası gidiş-dönüşü", () => {
  const a = lead(1, {
    notes: "=1+1 formül değil, nottur",
    products: [{ productId: 21, qty: 2 }],
    contact: {
      state: "contacted",
      count: 3,
      firstAt: "2026-10-20T06:00:00Z",
      lastAt: "2026-10-22T06:00:00Z",
      replied: false,
      channels: {},
      lastOutcome: null,
    } as never,
  });
  const b = lead(2, { assignedUserId: null, phoneE164: null });
  const build = (rows: LeadListDto[], head = header) =>
    buildWorkbook({
      sheetName: "Lead listesi",
      header: head,
      editable: [...EXCEL_COLUMNS.map((c) => isEditable(c.id)), false],
      rows: rows.map((l) => excelRow(l, ctx)),
      rtl: false,
      info: { sheetName: "Açıklama", lines: ["Bilgi"] },
      snapshot: rows.map((l) => excelTexts(l, ctx)),
    });

  it("yazılan dosya aynı başlık ve aynı hücre metinleriyle okunur; hiçbir değişiklik çıkmaz", async () => {
    const sheet = await readWorkbook(await build([a, b]));
    expect(layoutMismatch(header, sheet.header)).toBeNull();
    expect(sheet.rows.map((r) => r.n)).toEqual([2, 3]);
    // Tarih ve sayı hücreleri Excel'de gerçek tarih/sayıdır; okurken dışa aktarımdaki metne döner.
    expect(sheet.rows[0]!.cells[at("createdAt")]).toBe("11.10.2026");
    expect(sheet.rows[0]!.cells[at("products")]).toBe("2 Standard Padel Court");
    expect(sheet.rows[0]!.cells[at("count")]).toBe("3");
    expect(sheet.rows[0]!.cells[at("note")]).toBe("=1+1 formül değil, nottur");
    expect(sheet.rows[0]!.cells[at("phone")]).toBe("+905321234567");
    expect(sheet.createdAt).not.toBeNull();
    // Dışa aktarım anındaki metinler gizli sayfada, okunan hücrelerle birebir aynı.
    expect(sheet.snapshot).toEqual(sheet.rows.map((r) => r.cells));
    expect(sheet.snapshot![0]).toEqual(excelTexts(a, ctx));
    const plan = planImport(sheet.rows, leadsOf(a, b), { ...p, exportedAt: sheet.createdAt });
    expect(plan).toMatchObject({ changeCount: 0, invalid: [], noId: 0, unknown: 0 });
  });

  it("başlığı değiştirilmiş dosya düzen denetiminden geçmez", async () => {
    const sheet = await readWorkbook(await build([a], [...header.slice(0, -1), "Kimlik"]));
    expect(layoutMismatch(header, sheet.header)?.at).toEqual({
      n: header.length,
      expected: "xl.col.id",
      actual: "Kimlik",
    });
  });

  it(".xlsx olmayan içerik okunamaz", async () => {
    await expect(readWorkbook(new TextEncoder().encode("Ad;Mail\r\nX;Y").buffer as ArrayBuffer)).rejects.toThrow();
  });
});
