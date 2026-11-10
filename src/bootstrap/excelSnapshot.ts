/**
 * Excel satış takip dosyasının düz anlık görüntüsü (Faz 7g, iş emri §6.1). Sütunlar 2. satırdaki **başlık metniyle**
 * bulunur (yer değişse de çalışır); 36 başlıktan biri eksikse okuma durur. Kütüphaneden bağımsızdır: CLI (`exceljs`)
 * ve testler (sentetik sayfa) aynı `SheetLike` arayüzünü verir. Kişisel veri burada yalnız taşınır, yazdırılmaz.
 */
import { fold } from "../modules/lead-intake/application";

/** Hücre: ham değer (formülde önbellek sonucu) ve görünen metin. */
export interface CellLike {
  value: unknown;
  text: string;
}

export interface SheetLike {
  rowCount: number;
  columnCount: number;
  cell(row: number, col: number): CellLike;
}

export interface WorkbookLike {
  sheet(name: string): SheetLike | undefined;
}

export interface ProductCell {
  tick: boolean;
  qty: number | null;
}

/** SATIŞ TAKİP'in bir satırı (A–AJ); türetilen Y, Z, AA, AB okunmaz. Tarihler YYYY-MM-DD (takvim günü). */
export interface ExcelLeadRow {
  rowNo: number;
  no: string;
  leadDate: string | null;
  fullName: string;
  country: string;
  owner: string;
  phone: string;
  email: string;
  mailSent: boolean;
  waSent: boolean;
  mailReply: boolean;
  mailReplyAt: string | null;
  /** K hücresinde tarih dışı ya da 2024 öncesi değer vardı. */
  mailReplyRaw: boolean;
  waReply: boolean;
  waReplyAt: string | null;
  waReplyRaw: boolean;
  status: string;
  proposal: boolean;
  standard: ProductCell;
  panoramic: ProductCell;
  fullPanoramic: ProductCell;
  roof: { tick: boolean; widthM: number | null; lengthM: number | null };
  notes: string;
  installSite: string;
  installTimeline: string;
  profile: string;
  courtCount: string;
  platform: string;
  campaign: string;
  warning: string;
}

/** TEMAS GEÇMİŞİ satırı (A, C–F, H; B ve G formüldür). */
export interface ExcelContactRow {
  rowNo: number;
  no: string;
  at: string | null;
  channel: string;
  outcome: string;
  note: string;
  nextAt: string | null;
}

/** LİSTELER H/I: ülke → sorumlu etiketi. */
export interface ExcelTerritoryRow {
  country: string;
  owner: string;
}

export interface ExcelSnapshot {
  rows: ExcelLeadRow[];
  contacts: ExcelContactRow[];
  territories: ExcelTerritoryRow[];
  /** LİSTELER D4:D13 (ÖZET RAPOR §2 satır sırası). */
  ownerLabels: string[];
  /** ÖZET RAPOR hücrelerinin önbellek değerleri ("B7" → 160); doğrulama (`--verify`) karşılaştırır. */
  summary: Record<string, unknown>;
}

export const SHEETS = {
  tracking: "SATIŞ TAKİP",
  summary: "ÖZET RAPOR",
  lists: "LİSTELER",
  contacts: "TEMAS GEÇMİŞİ",
} as const;

/** Başlık (katlanmış) → alan. Sıra Excel'deki A–AJ sırasıdır. */
export const TRACKING_HEADERS = {
  no: "no",
  leadDate: "lead tarihi",
  fullName: "ad soyad",
  country: "ulke",
  owner: "sorumlu kisi",
  phone: "telefon whatsapp",
  email: "e posta",
  mailSent: "mail atildi mi",
  waSent: "whatsapp tan arandi mi",
  mailReply: "mail donusu alindi mi",
  mailReplyAt: "mail donus tarihi",
  waReply: "whatsapp donusu alindi mi",
  waReplyAt: "whatsapp donus tarihi",
  status: "musteri durumu",
  proposal: "teklif verildi mi",
  standardTick: "standard padel court",
  standardQty: "standard adet",
  panoramicTick: "panoramic padel court",
  panoramicQty: "panoramic adet",
  fullTick: "full panoramic padel court",
  fullQty: "full panoramic adet",
  roofTick: "kapatma cati",
  roofWidth: "cati genisligi m",
  roofLength: "cati uzunlugu m",
  roofArea: "cati alani m2",
  lastContact: "son temas tarihi otomatik",
  firstContact: "ilk temas tarihi otomatik",
  contactCount: "temas sayisi",
  notes: "notlar sonraki adim",
  installSite: "kurulum yeri",
  installTimeline: "kurulum zamani",
  profile: "musteri profili",
  courtCount: "kort sayisi",
  platform: "platform",
  campaign: "kampanya",
  warning: "veri uyarisi",
} as const;
type TrackingKey = keyof typeof TRACKING_HEADERS;

/** "m²" katlanınca "m2" olur; tire ve satır sonu boşluktur. */
const header = (v: string) => fold(v.replace(/²/g, "2"));

/** Hücre değeri: formülde önbellek sonucu, zengin metinde düz metin, bağlantıda metin. */
export function plain(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return plain(o["result"]);
    if (Array.isArray(o["richText"])) return (o["richText"] as { text: string }[]).map((t) => t.text).join("");
    if ("text" in o) return plain(o["text"]);
    if ("error" in o) return null;
  }
  return v;
}

const str = (v: unknown): string => {
  const p = plain(v);
  if (p === null) return "";
  if (p instanceof Date) return p.toISOString().slice(0, 10);
  return String(p).trim();
};

/** Excel tarih hücresi → YYYY-MM-DD. Excel saat dilimsizdir; kütüphane günü UTC gece yarısı olarak verir. */
export function ymd(v: unknown): string | null {
  const p = plain(v);
  if (p instanceof Date && !Number.isNaN(p.getTime())) return p.toISOString().slice(0, 10);
  if (typeof p === "number" && p > 30000 && p < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(p) * 86_400_000).toISOString().slice(0, 10);
  }
  if (typeof p === "string") {
    const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(p.trim());
    if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(p.trim())) return p.trim().slice(0, 10);
  }
  return null;
}

const tick = (v: unknown) => str(v) === "✔";
const yes = (v: unknown) => fold(str(v)) === "evet";
const num = (v: unknown): number | null => {
  const p = plain(v);
  const n = typeof p === "number" ? p : Number(String(p ?? "").replace(",", "."));
  return p === null || p === "" || !Number.isFinite(n) ? null : n;
};

/** "Türkiye (TR)" → "TR"; parantezli kod yoksa null. */
export function parseExcelCountry(raw: string): string | null {
  const m = /\(([A-Za-z]{2})\)\s*$/.exec(raw.trim());
  return m ? m[1]!.toUpperCase() : null;
}

export class SnapshotError extends Error {}

function columnsOf(sheet: SheetLike, headerRow: number): Map<string, number> {
  const out = new Map<string, number>();
  for (let c = 1; c <= sheet.columnCount; c++) {
    const h = header(str(sheet.cell(headerRow, c).value));
    if (h && !out.has(h)) out.set(h, c);
  }
  return out;
}

/** Çalışma kitabı → anlık görüntü. Eksik sayfa ya da başlıkta `SnapshotError`. */
export function readSnapshot(wb: WorkbookLike): ExcelSnapshot {
  const tracking = wb.sheet(SHEETS.tracking);
  if (!tracking) throw new SnapshotError(`"${SHEETS.tracking}" sayfası yok.`);
  const cols = columnsOf(tracking, 2);
  const at = {} as Record<TrackingKey, number>;
  const missing: string[] = [];
  for (const [key, h] of Object.entries(TRACKING_HEADERS) as [TrackingKey, string][]) {
    const c = cols.get(h);
    if (c === undefined) missing.push(h);
    else at[key] = c;
  }
  if (missing.length) throw new SnapshotError(`SATIŞ TAKİP başlıkları eksik: ${missing.join(", ")}`);

  const rows: ExcelLeadRow[] = [];
  for (let r = 3; r <= tracking.rowCount; r++) {
    const get = (k: TrackingKey) => tracking.cell(r, at[k]);
    const no = str(get("no").value);
    if (!no) continue;
    const kRaw = str(get("mailReplyAt").value);
    const mRaw = str(get("waReplyAt").value);
    const k = ymd(get("mailReplyAt").value);
    const m = ymd(get("waReplyAt").value);
    rows.push({
      rowNo: r,
      no,
      leadDate: ymd(get("leadDate").value),
      fullName: str(get("fullName").value),
      country: str(get("country").value),
      owner: str(get("owner").value),
      phone: get("phone").text.trim() || str(get("phone").value),
      email: get("email").text.trim() || str(get("email").value),
      mailSent: tick(get("mailSent").value),
      waSent: tick(get("waSent").value),
      mailReply: yes(get("mailReply").value),
      mailReplyAt: k,
      mailReplyRaw: !!kRaw && !k,
      waReply: yes(get("waReply").value),
      waReplyAt: m,
      waReplyRaw: !!mRaw && !m,
      status: str(get("status").value),
      proposal: yes(get("proposal").value),
      standard: { tick: tick(get("standardTick").value), qty: num(get("standardQty").value) },
      panoramic: { tick: tick(get("panoramicTick").value), qty: num(get("panoramicQty").value) },
      fullPanoramic: { tick: tick(get("fullTick").value), qty: num(get("fullQty").value) },
      roof: {
        tick: tick(get("roofTick").value),
        widthM: num(get("roofWidth").value),
        lengthM: num(get("roofLength").value),
      },
      notes: str(get("notes").value),
      installSite: str(get("installSite").value),
      installTimeline: str(get("installTimeline").value),
      profile: str(get("profile").value),
      courtCount: str(get("courtCount").value),
      platform: str(get("platform").value),
      campaign: str(get("campaign").value),
      warning: str(get("warning").value),
    });
  }

  const contacts: ExcelContactRow[] = [];
  const cs = wb.sheet(SHEETS.contacts);
  if (cs) {
    const c = columnsOf(cs, 1);
    const col = (h: string) => c.get(h);
    const noC = col("musteri no");
    const atC = col("temas tarihi");
    const chC = col("iletisim kanali");
    const ouC = col("gorusme sonucu");
    const ntC = col("gorusme notlari");
    const nxC = col("sonraki takip tarihi");
    if (noC && atC && chC && ouC) {
      for (let r = 2; r <= cs.rowCount; r++) {
        const no = str(cs.cell(r, noC).value);
        if (!no) continue;
        contacts.push({
          rowNo: r,
          no,
          at: ymd(cs.cell(r, atC).value),
          channel: str(cs.cell(r, chC).value),
          outcome: str(cs.cell(r, ouC).value),
          note: ntC ? str(cs.cell(r, ntC).value) : "",
          nextAt: nxC ? ymd(cs.cell(r, nxC).value) : null,
        });
      }
    }
  }

  const territories: ExcelTerritoryRow[] = [];
  const ownerLabels: string[] = [];
  const ls = wb.sheet(SHEETS.lists);
  if (ls) {
    const c = columnsOf(ls, 3);
    const countryC = [...c.entries()].find(([h]) => h.startsWith("ulke"))?.[1];
    const ownerC = [...c.entries()].find(([h]) => h.startsWith("sorumlu bolge"))?.[1];
    const listC = c.get("sorumlu kisi");
    for (let r = 4; r <= ls.rowCount; r++) {
      if (countryC && ownerC) {
        const country = str(ls.cell(r, countryC).value);
        const owner = str(ls.cell(r, ownerC).value);
        if (country && owner) territories.push({ country, owner });
      }
      if (listC) {
        const label = str(ls.cell(r, listC).value);
        if (label) ownerLabels.push(label);
      }
    }
  }

  const summary: Record<string, unknown> = {};
  const ss = wb.sheet(SHEETS.summary);
  if (ss) {
    for (let r = 1; r <= ss.rowCount; r++) {
      for (let c = 1; c <= ss.columnCount; c++) {
        const raw = ss.cell(r, c).value;
        // exceljs, önbellek değeri 0 olan formülde `result` alanını hiç yazmaz; ÖZET RAPOR'da bu 0 demektir.
        const zeroFormula =
          raw !== null && typeof raw === "object" && ("formula" in raw || "sharedFormula" in raw) && !("result" in raw);
        const v = zeroFormula ? 0 : plain(raw);
        if (v !== null && v !== "") summary[`${columnName(c)}${r}`] = v;
      }
    }
  }
  return { rows, contacts, territories, ownerLabels, summary };
}

export function columnName(c: number): string {
  let s = "";
  for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
