import { describe, expect, it } from "vitest";
import type { LeadListDto } from "../../modules/sales-pipeline/api/dto";
import { drillDownParams, type ReportFilters } from "../report/drillDown";
import { csvCell, toCsv } from "./csv";
import { COLUMNS, columnById, type Ctx } from "./listColumns";
import {
  activeFilterCount,
  applyFilters,
  clientFilters,
  hasFilterParams,
  searchRows,
  serverParams,
  sortRows,
  valueCounts,
} from "./listFilter";

/** Sentetik liste öğeleri (kişisel veri yok). */
const lead = (i: number, over: Partial<LeadListDto> = {}): LeadListDto =>
  ({
    id: `l${i}`,
    fullName: `Lead ${i}`,
    email: null,
    phoneE164: null,
    company: "",
    country: "TR",
    assignedUserId: "u1",
    currentStage: "NEW",
    source: "import",
    createdAt: `2026-10-${String(10 + i).padStart(2, "0")}T06:00:00.000Z`,
    customerStatus: null,
    products: {
      standard: null,
      panoramic: null,
      fullPanoramic: null,
      roof: { wanted: false, widthM: null, lengthM: null },
    },
    installSite: null,
    installTimeline: null,
    customerProfile: null,
    courtCountBand: null,
    adSurface: null,
    campaign: { campaignName: null },
    extraAnswers: { excel_no: String(i) },
    notes: "",
    warnings: [],
    nextActivity: null,
    proposal: { given: false, at: null, via: null },
    contact: { state: "never", count: 0, firstAt: null, lastAt: null, replied: false, channels: {}, lastOutcome: null },
    ...over,
  }) as unknown as LeadListDto;

const mailed = {
  count: 1,
  firstAt: "2026-10-20T06:00:00Z",
  lastAt: "2026-10-20T06:00:00Z",
  firstReplyAt: null,
  firstReplyEstimated: false,
};
const ROWS: LeadListDto[] = [
  lead(1, {
    contact: {
      state: "contacted",
      count: 1,
      firstAt: mailed.firstAt,
      lastAt: mailed.lastAt,
      replied: false,
      channels: { email: mailed },
    } as never,
  }),
  lead(2, { assignedUserId: null, extraAnswers: { excel_no: "2", excel_owner: "Enes" }, installTimeline: "m0_3" }),
  lead(3, {
    customerStatus: "buyer_ready",
    proposal: { given: true, at: "2026-10-25T06:00:00Z", via: "stage" },
    products: { standard: 2, panoramic: null, fullPanoramic: null, roof: { wanted: true, widthM: 10, lengthM: 20 } },
  }),
  lead(4, {
    contact: { state: "legacy", count: 0, firstAt: null, lastAt: null, replied: false, channels: {} } as never,
    country: "DE",
  }),
];

const ctx: Ctx = {
  t: (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k),
  lang: "tr",
  day: (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(iso)),
  nameOf: (id) => id ?? "pool",
  stageName: (c) => c,
  countryName: (c) => c,
  sourceName: (s) => s,
  now: Date.parse("2026-11-10T09:00:00Z"),
};
const run = (qs: string) => {
  const p = new URLSearchParams(qs);
  return applyFilters(searchRows(ROWS, p.get("q")), clientFilters(p, "u1"), ctx).map((l) => l.id);
};

describe("listFilter", () => {
  it("değer süzgeçleri: mail evet/hayır/eski kayıt, durum none, sorumlu me/pool, ülke", () => {
    expect(run("f_mail=yes")).toEqual(["l1"]);
    expect(run("f_mail=legacy")).toEqual(["l4"]);
    expect(run("f_mail=no")).toEqual(["l2", "l3"]);
    expect(run("f_status=buyer_ready")).toEqual(["l3"]);
    expect(run("f_status=none")).toEqual(["l1", "l2", "l4"]);
    expect(run("owner=pool")).toEqual(["l2"]);
    expect(run("owner=me")).toEqual(["l1", "l3", "l4"]);
    expect(run("country=de")).toEqual(["l4"]);
    expect(run("f_excelOwner=Enes")).toEqual(["l2"]);
    expect(run("f_standard=yes&f_proposal=yes")).toEqual(["l3"]);
  });

  it("metin ve arama: Excel No eşleşir; tarih aralığı İstanbul günüyle uçlar dahil", () => {
    expect(run("q=3")).toEqual(["l3"]);
    expect(run("f_name=lead 2")).toEqual(["l2"]);
    expect(run("f_created=2026-10-12..2026-10-13")).toEqual(["l2", "l3"]);
  });

  it("sayılı değer listesi ve kendi süzgeci hariç sayım", () => {
    const counts = valueCounts(ROWS, columnById.get("mail")!, ctx);
    expect(counts.map((c) => [c.value, c.count])).toEqual([
      ["yes", 1],
      ["no", 2],
      ["legacy", 1],
    ]);
    const filters = clientFilters(new URLSearchParams("f_mail=yes&country=TR"), "u1");
    expect(applyFilters(ROWS, filters, ctx, "mail").map((l) => l.id)).toEqual(["l1", "l2", "l3"]);
  });

  it("kararlı sıralama, URL anahtarları ve süzgeç sayacı", () => {
    expect(sortRows(ROWS, null, ctx).map((l) => l.id)).toEqual(["l4", "l3", "l2", "l1"]);
    expect(sortRows(ROWS, "name", ctx).map((l) => l.id)).toEqual(["l1", "l2", "l3", "l4"]);
    const p = new URLSearchParams("sort=-name&size=200&contact=never&f_mail=no&q=x");
    expect(activeFilterCount(p)).toBe(3);
    expect(hasFilterParams(new URLSearchParams("sort=name"))).toBe(false);
    expect(hasFilterParams(new URLSearchParams("from=report"))).toBe(true);
    expect(serverParams(p).toString()).toBe("contact=never&limit=2000");
    expect(new Set(COLUMNS.map((c) => c.param)).size).toBe(COLUMNS.length);
  });
});

describe("csv", () => {
  it("BOM, ; ayraç, CRLF, kaçış ve formül enjeksiyonu", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+90 532")).toBe("'+90 532");
    expect(csvCell('a;"b"')).toBe('"a;""b"""');
    const text = toCsv(
      ["Ad", "Mail"],
      [
        ["X", "✔"],
        ["Y", "✘"],
      ],
    );
    expect(text.startsWith("﻿Ad;Mail\r\n")).toBe(true);
    expect(text).toContain("X;✔\r\nY;✘\r\n");
  });
});

describe("drillDown", () => {
  const F: ReportFilters = { scope: "excel", source: null, campaign: null, from: null, to: null, owner: null };
  const open = (sel: Parameters<typeof drillDownParams>[1]) => {
    const p = drillDownParams(F, sel, "x");
    // contact=… sunucu süzgecidir; burada liste öğesinin özetiyle aynı tanım uygulanır.
    const contact = p.get("contact");
    const rows = applyFilters(searchRows(ROWS, null), clientFilters(p, "u1"), ctx).filter((l) =>
      !contact ? true : contact === "replied" ? l.contact.replied : l.contact.state === contact,
    );
    return rows.map((l) => l.id);
  };
  it("rapor hücresi → listedeki satır sayısı aynı tanımla", () => {
    expect(open({ metric: "mailSent" })).toEqual(["l1"]);
    expect(open({ metric: "neverReached" })).toEqual(["l2", "l3"]);
    expect(open({ metric: "legacyNoContact" })).toEqual(["l4"]);
    expect(open({ metric: "buyers" })).toEqual(["l3"]);
    expect(open({ owner: null, excelOwner: "Enes" })).toEqual(["l2"]);
    expect(open({ timeline: "m0_3", metric: "neverReached" })).toEqual(["l2"]);
    expect(open({ product: "roof", within: "proposal" })).toEqual(["l3"]);
    expect(drillDownParams(F, {}, "").get("scope")).toBe("excel");
  });
});
