/**
 * Excel ÖZET RAPOR = CRM Özet rapor kabulü (Faz 7g, D8; iş emri §6.8). Salt okunur.
 *  1. Formül sağlaması: ÖZET sayıları SATIŞ TAKİP hücrelerinden Excel formülleriyle yeniden hesaplanır
 *     (`excelSummary`) ve dosyadaki önbellek değerleriyle karşılaştırılır (G3 = TODAY hariç). Fark → çıkış 2.
 *  2. Satır olguları: her satırın CRM'deki olguları içe aktarma kurallarının beklenen sonucuyla (`expectedCrmFacts`)
 *     karşılaştırılır; izinli farklar gerekçe koduna bağlanır (A1 gönderim işaretsiz dönüş, A2 adet/tik, A3 havuz,
 *     A4 zenginleştirilen lead, A7 TEMAS satırı, A9 ölçü var Kapatma yok, A10 form tablosu sonrası).
 *     Gerekçesiz fark → çıkış 1.
 *  3. Tablo: Excel | CRM her hücre için yazdırılır. Kişisel veri yok: yalnız Excel No ve sayılar.
 */
import { fold } from "../modules/lead-intake/application";
import type { LeadListItem } from "../modules/sales-pipeline/application";
import { contactsFromRow, productsFromRow, statusFromExcel } from "./importExcel";
import type { ExcelContactRow, ExcelLeadRow, ExcelSnapshot } from "./excelSnapshot";

export const TIMELINE_LABELS: Record<string, string> = {
  "3 ay icinde": "m0_3",
  "3 6 ay": "m3_6",
  "6 12 ay": "m6_12",
  "simdilik arastiriyor": "researching",
};
const COVERED = "tam kapali catili kort";

/** Excel tanımlarıyla satır olguları (ÖZET RAPOR formüllerinin karşılığı). */
export interface RowFacts {
  mail: boolean;
  wa: boolean;
  never: boolean;
  replied: boolean;
  proposal: boolean;
  buyer: boolean;
  standard: { pref: boolean; qty: number };
  panoramic: { pref: boolean; qty: number };
  fullPanoramic: { pref: boolean; qty: number };
  roof: { pref: boolean; area: number };
  timeline: string | null;
  covered: boolean;
}

export function excelFacts(r: ExcelLeadRow): RowFacts {
  const area = (r.roof.widthM ?? 0) * (r.roof.lengthM ?? 0);
  return {
    mail: r.mailSent,
    wa: r.waSent,
    never: !r.mailSent && !r.waSent,
    replied: r.mailReply || r.waReply,
    proposal: r.proposal,
    buyer: fold(r.status) === "alici proje hazir",
    standard: { pref: r.standard.tick, qty: r.standard.qty ?? 0 },
    panoramic: { pref: r.panoramic.tick, qty: r.panoramic.qty ?? 0 },
    fullPanoramic: { pref: r.fullPanoramic.tick, qty: r.fullPanoramic.qty ?? 0 },
    roof: { pref: r.roof.tick, area },
    timeline: TIMELINE_LABELS[fold(r.installTimeline)] ?? null,
    covered: fold(r.installSite) === COVERED,
  };
}

/** İçe aktarma kurallarının sonucu (CRM'de beklenen); `reasons` hangi izinli farkın uygulandığını söyler. */
export function expectedCrmFacts(
  r: ExcelLeadRow,
  temas: readonly ExcelContactRow[],
  tz: string,
): { facts: RowFacts; reasons: string[] } {
  const reasons: string[] = [];
  const base = excelFacts(r);
  const d = contactsFromRow(r, temas, tz);
  const mail = d.contacts.some((c) => c.type === "email");
  const wa = d.contacts.some((c) => c.type === "whatsapp");
  if (mail !== base.mail || wa !== base.wa) reasons.push(temas.length ? "A7" : "A1");
  const anyContact = d.contacts.length > 0;
  const p = productsFromRow(r).products as {
    standard: number | null;
    panoramic: number | null;
    fullPanoramic: number | null;
    roof: { wanted: boolean; widthM: number | null; lengthM: number | null };
  };
  const court = (q: number | null, excel: { pref: boolean; qty: number }) => {
    const out = { pref: q !== null && q > 0, qty: q ?? 0 };
    if (out.pref !== excel.pref || out.qty !== excel.qty) reasons.push("A2");
    return out;
  };
  const roofArea =
    p.roof.widthM !== null && p.roof.lengthM !== null ? Math.round(p.roof.widthM * p.roof.lengthM * 100) / 100 : 0;
  if (p.roof.wanted !== base.roof.pref) reasons.push("A9");
  const facts: RowFacts = {
    mail,
    wa,
    never: !anyContact,
    replied: d.firstReplyAt !== null,
    proposal: d.proposalAt !== null,
    buyer: statusFromExcel(r.status) === "buyer_ready",
    standard: court(p.standard, base.standard),
    panoramic: court(p.panoramic, base.panoramic),
    fullPanoramic: court(p.fullPanoramic, base.fullPanoramic),
    roof: { pref: p.roof.wanted, area: roofArea },
    timeline: base.timeline,
    covered: base.covered,
  };
  if (facts.replied !== base.replied || facts.proposal !== base.proposal) reasons.push("A7");
  return { facts, reasons: [...new Set(reasons)] };
}

/** CRM'deki gerçek olgular (liste öğesinden). */
export function crmFacts(l: LeadListItem): RowFacts {
  return {
    mail: (l.contact.channels.email?.count ?? 0) > 0,
    wa: (l.contact.channels.whatsapp?.count ?? 0) > 0,
    never: l.contact.state === "never",
    replied: l.contact.replied,
    proposal: l.proposal.given,
    buyer: l.customerStatus === "buyer_ready",
    standard: { pref: (l.products.standard ?? 0) > 0, qty: l.products.standard ?? 0 },
    panoramic: { pref: (l.products.panoramic ?? 0) > 0, qty: l.products.panoramic ?? 0 },
    fullPanoramic: { pref: (l.products.fullPanoramic ?? 0) > 0, qty: l.products.fullPanoramic ?? 0 },
    roof: { pref: l.products.roof.wanted, area: l.roofAreaM2 ?? 0 },
    timeline: l.installTimeline,
    covered: l.installSite === "covered_court",
  };
}

/** Form tablosu eşitlemesinin değiştirebildiği olgular (A10). */
const SHEET_FIELDS = new Set(["mail", "never", "timeline", "covered"]);

const flat = (f: RowFacts): Record<string, unknown> => ({
  mail: f.mail,
  wa: f.wa,
  never: f.never,
  replied: f.replied,
  proposal: f.proposal,
  buyer: f.buyer,
  standardPref: f.standard.pref,
  standardQty: f.standard.qty,
  panoramicPref: f.panoramic.pref,
  panoramicQty: f.panoramic.qty,
  fullPref: f.fullPanoramic.pref,
  fullQty: f.fullPanoramic.qty,
  roofPref: f.roof.pref,
  roofArea: Math.round(f.roof.area * 100) / 100,
  timeline: f.timeline,
  covered: f.covered,
});

/** ÖZET RAPOR'un yeniden hesabı: hücre adresi → değer (önbellekle karşılaştırılacak hücreler). */
export function excelSummary(snap: ExcelSnapshot): Record<string, number | string> {
  const rows = snap.rows.filter((r) => r.fullName.trim() !== "");
  const f = rows.map((r) => ({ r, x: excelFacts(r) }));
  const count = (pred: (x: RowFacts, r: ExcelLeadRow) => boolean, list = f) =>
    list.filter((e) => pred(e.x, e.r)).length;
  const out: Record<string, number | string> = {};
  const total = rows.length;
  const basics = [
    total,
    count((x) => x.mail),
    count((x) => x.wa),
    count((x) => x.never),
    count((x) => x.replied),
    count((x) => x.proposal),
    count((x) => x.buyer),
  ];
  ["B", "C", "D", "E", "F", "G", "H"].forEach((c, i) => (out[`${c}7`] = basics[i]!));
  ["C", "D", "E", "F", "G", "H"].forEach((c, i) => (out[`${c}8`] = total === 0 ? 0 : basics[i + 1]! / total));
  const sums = [0, 0, 0, 0, 0, 0, 0];
  snap.ownerLabels.slice(0, 10).forEach((label, i) => {
    const row = 12 + i;
    const mine = f.filter((e) => e.r.owner.trim() === label.trim());
    const vals = [
      mine.length,
      count((x) => x.mail, mine),
      count((x) => x.wa, mine),
      count((x) => x.never, mine),
      count((x) => x.replied, mine),
      count((x) => x.proposal, mine),
      count((x) => x.buyer, mine),
    ];
    ["C", "D", "E", "F", "G", "H", "I"].forEach((c, k) => {
      out[`${c}${row}`] = vals[k]!;
      sums[k]! += vals[k]!;
    });
  });
  ["C", "D", "E", "F", "G", "H", "I"].forEach((c, k) => (out[`${c}22`] = sums[k]!));
  out["J22"] = sums[0] === 0 ? "-" : (sums[0]! - sums[3]!) / sums[0]!;
  out["K22"] = sums[0]! - sums[3]! === 0 ? "-" : sums[4]! / (sums[0]! - sums[3]!);
  out["L22"] = sums[0] === 0 ? "-" : sums[5]! / sums[0]!;
  const prods = [(x: RowFacts) => x.standard, (x: RowFacts) => x.panoramic, (x: RowFacts) => x.fullPanoramic];
  prods.forEach((get, i) => {
    const row = 42 + i;
    out[`C${row}`] = count((x) => get(x).pref);
    out[`D${row}`] = count((x) => get(x).pref && x.proposal);
    out[`F${row}`] = count((x) => get(x).pref && x.buyer);
    out[`G${row}`] = f.reduce((s, e) => s + get(e.x).qty, 0);
  });
  out["C45"] = count((x) => x.roof.pref);
  out["D45"] = count((x) => x.roof.pref && x.proposal);
  out["F45"] = count((x) => x.roof.pref && x.buyer);
  out["G45"] = Math.round(f.reduce((s, e) => s + e.x.roof.area, 0) * 100) / 100;
  out["C46"] = count((x) => x.covered);
  ["m0_3", "m3_6", "m6_12", "researching"].forEach((t, i) => {
    const row = 51 + i;
    const mine = f.filter((e) => e.x.timeline === t);
    out[`C${row}`] = mine.length;
    out[`D${row}`] = count((x) => x.never, mine);
    out[`E${row}`] = count((x) => x.replied, mine);
    out[`F${row}`] = count((x) => x.proposal, mine);
    out[`G${row}`] = mine.length === 0 ? "-" : count((x) => x.never, mine) / mine.length;
  });
  return out;
}

export function formulaCheck(snap: ExcelSnapshot): { cell: string; cached: unknown; computed: unknown }[] {
  const computed = excelSummary(snap);
  const diffs: { cell: string; cached: unknown; computed: unknown }[] = [];
  for (const [cell, v] of Object.entries(computed)) {
    const cached = snap.summary[cell];
    if (cached === undefined) continue;
    const eq =
      typeof v === "number" && typeof cached === "number" ? Math.abs(v - cached) < 1e-9 : String(v) === String(cached);
    if (!eq) diffs.push({ cell, cached, computed: v });
  }
  return diffs;
}

export interface RowDiff {
  no: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface VerifyResult {
  formulaDiffs: { cell: string; cached: unknown; computed: unknown }[];
  rowDiffs: RowDiff[];
  missing: string[];
  enriched: string[];
  /** Uygulanan izinli fark kodu → satır sayısı. */
  reasons: Record<string, number>;
  ownerDiffs: RowDiff[];
}

/** Satır olgularını karşılaştırır. `leads`: CRM'deki Excel kümesi; `ownerOf`: satırın beklenen sahibi (A3). */
export function compareRows(
  snap: ExcelSnapshot,
  leads: readonly LeadListItem[],
  ownerOf: (row: ExcelLeadRow) => string | null,
  tz: string,
): VerifyResult {
  const byNo = new Map(leads.map((l) => [String(l.extraAnswers["excel_no"] ?? ""), l]));
  const temasByNo = new Map<string, ExcelContactRow[]>();
  for (const c of snap.contacts) temasByNo.set(c.no, [...(temasByNo.get(c.no) ?? []), c]);
  const res: VerifyResult = {
    formulaDiffs: formulaCheck(snap),
    rowDiffs: [],
    missing: [],
    enriched: [],
    reasons: {},
    ownerDiffs: [],
  };
  for (const r of snap.rows) {
    const lead = byNo.get(r.no);
    if (!lead) {
      res.missing.push(r.no);
      continue;
    }
    if (lead.platformLeadId !== `excel:satis:${r.no}`) {
      res.enriched.push(r.no);
      res.reasons["A4"] = (res.reasons["A4"] ?? 0) + 1;
      continue;
    }
    const { facts, reasons } = expectedCrmFacts(r, temasByNo.get(r.no) ?? [], tz);
    for (const code of reasons) res.reasons[code] = (res.reasons[code] ?? 0) + 1;
    const want = flat(facts);
    const got = flat(crmFacts(lead));
    // A10: form tablosu (Excel'den yeni) bu lead'e "mail atıldı" teması ya da boş form cevabı eklediyse.
    const sheet = "sheet_key" in lead.extraAnswers;
    let a10 = false;
    for (const k of Object.keys(want)) {
      if (JSON.stringify(want[k]) === JSON.stringify(got[k])) continue;
      if (sheet && SHEET_FIELDS.has(k)) a10 = true;
      else res.rowDiffs.push({ no: r.no, field: k, expected: want[k], actual: got[k] });
    }
    if (a10) res.reasons["A10"] = (res.reasons["A10"] ?? 0) + 1;
    const owner = ownerOf(r);
    if (owner !== lead.assignedUserId)
      res.ownerDiffs.push({ no: r.no, field: "owner", expected: owner, actual: lead.assignedUserId });
    if (owner === null) res.reasons["A3"] = (res.reasons["A3"] ?? 0) + 1;
  }
  return res;
}
