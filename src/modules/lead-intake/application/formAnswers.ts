/**
 * Form cevaplarının satış takip kodlarına çevrilmesi (Faz 7g, D5; iş emri §4.7). Saf kod: reklam formu ve Excel
 * aktarımı aynı katlama (`fold`) ve eşanlamlı listelerini kullanır. Eşleşmeyen cevap alanı boş bırakır ve
 * `unmatched`'a yazılır; ham cevap `extraAnswers`'ta kalır (lead yine oluşur).
 */
import {
  bandForCount,
  type CourtCountBand,
  type CustomerProfile,
  type InstallSite,
  type InstallTimeline,
} from "../../sales-pipeline/application";

/** tr-TR küçük harf; ç ğ ı ö ş ü → c g i o s u; harf ve rakam dışı → tek boşluk; kırpılır. */
export function fold(raw: unknown): string {
  return String(raw ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/â/g, "a")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type FormTarget = "install_site" | "install_timeline" | "customer_profile" | "court_count";

/** Soru tespiti: `extra` anahtarı katlanınca bunlardan biriyle başlıyorsa o hedefin cevabıdır. */
const QUESTION_SYNONYMS: Record<FormTarget, string[]> = {
  install_site: [
    "kurulum yeri",
    "where do you plan to install the court",
    "where do you plan to install",
    // Meta form dökümü ("UNIXPADEL Form Kampanyası Verisi", 2026-11).
    "where will the court be installed",
  ],
  install_timeline: [
    "kurulum zamani",
    "what is your estimated project timeline",
    "project timeline",
    "when do you plan to install",
  ],
  customer_profile: ["musteri profili", "customer profile", "which best describes you"],
  court_count: ["kort sayisi", "kac kort", "how many courts do you need", "how many courts"],
};

const INSTALL_SITE_VALUES: Record<string, InstallSite> = {
  "tam kapali catili kort": "covered_court",
  "full cover padel court": "covered_court",
  "site not secured yet": "no_site_yet",
  "coastal windy site": "beach_windy",
  "cati teras": "rooftop",
  "fully covered roofed court": "covered_court",
  "henuz arazi yer yok": "no_site_yet",
  "no site yet": "no_site_yet",
  "kapali salon": "indoor_hall",
  "indoor hall": "indoor_hall",
  "sahil ruzgarli alan": "beach_windy",
  "beach sand": "beach_windy",
  "beach windy area": "beach_windy",
  "cati ustu rooftop": "rooftop",
  rooftop: "rooftop",
  "mevcut zemin asfalt beton": "existing_ground",
  "existing asphalt or concrete": "existing_ground",
  diger: "other",
  other: "other",
};

const INSTALL_TIMELINE_VALUES: Record<string, InstallTimeline> = {
  "3 ay icinde": "m0_3",
  "in 3 6 months": "m3_6",
  "in 6 12 months": "m6_12",
  "simdilik arastiriyorum": "researching",
  asap: "m0_3",
  "within 1 3 months": "m0_3",
  "within 3 months": "m0_3",
  "3 6 ay": "m3_6",
  "within 3 6 months": "m3_6",
  "6 12 ay": "m6_12",
  "within 6 12 months": "m6_12",
  "simdilik arastiriyor": "researching",
  "just researching": "researching",
};

const CUSTOMER_PROFILE_VALUES: Record<string, CustomerProfile> = {
  "yeni tesis acacak yatirimci": "investor",
  "yeni padel tesisi acacak yatirimci": "investor",
  "investor opening a new padel venue": "investor",
  "padel club owner operator": "club_operator",
  "padel kulubu sahibi isletmecisi": "club_operator",
  "private court for my home": "private_home",
  "evim icin ozel kort": "private_home",
  "school municipality sports facility": "public_facility",
  "hotel resort residential developer": "hospitality_residential",
  "otel tatil koyu konut projesi": "hospitality_residential",
  "distributor reseller": "distributor",
  "kulup sahibi isletmeci": "club_operator",
  "ev icin ozel kort": "private_home",
  "okul belediye spor tesisi": "public_facility",
  "otel resort konut projesi": "hospitality_residential",
  "distributor bayi": "distributor",
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  bir: 1,
  iki: 2,
  uc: 3,
  dort: 4,
  bes: 5,
  alti: 6,
  yedi: 7,
  sekiz: 8,
  dokuz: 9,
  on: 10,
};

const BAND_LABELS: Record<string, CourtCountBand> = {
  "1 kort": "1",
  "2 3 kort": "2_3",
  "4 6 kort": "4_6",
  "7 kort": "7_plus",
};

/** Kort cevabı: kesin sayı → sayı + bant; aralık → en büyük sayının bandı; bant etiketi → bant. */
export function parseCourtAnswer(raw: unknown): { courtCount: number | null; band: CourtCountBand | null } | null {
  const text = String(raw ?? "").trim();
  if (/^7\s*\+/.test(text)) return { courtCount: null, band: "7_plus" };
  const f = fold(raw);
  if (!f) return null;
  const label = BAND_LABELS[f];
  if (label) return { courtCount: null, band: label };
  const words = f.split(" ").map((w) => (w in NUMBER_WORDS ? String(NUMBER_WORDS[w]) : w));
  const nums = words.filter((w) => /^\d+$/.test(w)).map(Number);
  const rest = words.filter(
    (w) => !/^\d+$/.test(w) && !["or", "veya", "ya", "da", "kort", "court", "courts", "to"].includes(w),
  );
  if (!nums.length || rest.length) return null;
  if (nums.length === 1) {
    const n = nums[0]!;
    if (n < 1 || n > 999) return null;
    return { courtCount: n, band: bandForCount(n) };
  }
  const max = Math.max(...nums);
  return max >= 1 && max <= 999 ? { courtCount: null, band: bandForCount(max) } : null;
}

export interface NormalizedAnswers {
  installSite: InstallSite | null;
  installTimeline: InstallTimeline | null;
  customerProfile: CustomerProfile | null;
  courtCountBand: CourtCountBand | null;
  courtCount: number | null;
  unmatched: { target: FormTarget; raw: string }[];
}

const lookup = <T>(table: Record<string, T>, raw: unknown): T | null => {
  const f = fold(raw);
  if (!f) return null;
  if (f in table) return table[f]!;
  // API anahtarları (`full_cover_padel_court_`) ve sonda/başta ek metin: ilk tam önek eşleşmesi.
  const hit = Object.keys(table).find((k) => f === k || f.startsWith(`${k} `));
  return hit ? table[hit]! : null;
};

/** `answers`: açık eşlemeden gelen hedef → ham cevap (öncelikli); `extra`: eşlenmemiş form alanları. */
export function normalizeFormAnswers(
  answers: Partial<Record<FormTarget, unknown>>,
  extra: Record<string, unknown> = {},
): NormalizedAnswers {
  const found: Partial<Record<FormTarget, unknown>> = { ...answers };
  for (const [key, value] of Object.entries(extra)) {
    if (value === null || value === undefined || value === "") continue;
    const k = fold(key);
    for (const target of Object.keys(QUESTION_SYNONYMS) as FormTarget[]) {
      if (found[target] !== undefined) continue;
      if (QUESTION_SYNONYMS[target].some((q) => k === q || k.startsWith(q))) found[target] = value;
    }
  }
  const out: NormalizedAnswers = {
    installSite: null,
    installTimeline: null,
    customerProfile: null,
    courtCountBand: null,
    courtCount: null,
    unmatched: [],
  };
  const miss = (target: FormTarget, raw: unknown) => out.unmatched.push({ target, raw: String(raw).slice(0, 200) });
  if (found.install_site !== undefined) {
    out.installSite = lookup(INSTALL_SITE_VALUES, found.install_site);
    if (!out.installSite) miss("install_site", found.install_site);
  }
  if (found.install_timeline !== undefined) {
    out.installTimeline = lookup(INSTALL_TIMELINE_VALUES, found.install_timeline);
    if (!out.installTimeline) miss("install_timeline", found.install_timeline);
  }
  if (found.customer_profile !== undefined) {
    out.customerProfile = lookup(CUSTOMER_PROFILE_VALUES, found.customer_profile);
    if (!out.customerProfile) miss("customer_profile", found.customer_profile);
  }
  if (found.court_count !== undefined) {
    const c = parseCourtAnswer(found.court_count);
    if (c) {
      out.courtCount = c.courtCount;
      out.courtCountBand = c.band;
    } else miss("court_count", found.court_count);
  }
  return out;
}
