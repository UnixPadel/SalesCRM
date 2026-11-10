import { RuleError, err, ok, type Result } from "../../shared/kernel";
import {
  ACTIVITY_TYPES,
  atLocalHour,
  calendarDay,
  CONTACT_CHANNELS,
  FOLLOW_UP_SUBJECTS,
  isActivityOutcome,
  isActivityType,
  isOpenActivity,
  isReply,
  type Activity,
  type ActivityOutcome,
  type ActivityType,
} from "./activity";
import type { CustomerStatus } from "./leadProfile";
import { isTerminal, stageIndex, type StageCode } from "./stage";

/**
 * Temas özeti ve temas kuralları (Faz 7g, ADR-0014, iş emri §3.3.2). Temas = tamamlanmış aktivite; kanal = tür.
 * Excel'in H–M, Z, AA, AB sütunları ve "Hiç ulaşılmadı" buradan türetilir; saklanmaz. Liste, pano, Bugün ve rapor
 * aynı toplamı kullanır: SQL `GROUP BY` (`contactAggregatesByLeads`) ve bellek içi `aggregateContacts` aynı satırları
 * üretir, kural (dönüş, sıralama) yalnız `summarizeContacts`'tadır.
 */

/** Bir lead'in tamamlanmış aktivitelerinin (tür, sonuç, cevap işareti, tahmini) grubuna göre toplamı. */
export interface ContactAggregateRow {
  leadId: string;
  type: ActivityType;
  outcome: ActivityOutcome | null;
  customerReplied: boolean;
  estimated: boolean;
  n: number;
  firstAt: Date;
  lastAt: Date;
}

export interface ChannelFacts {
  count: number;
  firstAt: Date;
  lastAt: Date;
  /** Bu kanaldaki ilk dönüş temasının zamanı (Excel K / M). */
  firstReplyAt: Date | null;
  firstReplyEstimated: boolean;
}

/** `legacy` = temas geçmişi bilinmeyen eski kayıt ("Kayıt yok (eski)"); "Hiç ulaşılmadı"ya sayılmaz [K-B1]. */
export type ContactState = "contacted" | "legacy" | "never";
export const CONTACT_STATES: readonly ContactState[] = ["contacted", "legacy", "never"];

export interface ContactSummary {
  state: ContactState;
  /** Tamamlanmış aktivite sayısı (Excel AB). */
  count: number;
  /** İlk temas (Excel AA). */
  firstAt: Date | null;
  firstAtEstimated: boolean;
  /** Son temas (Excel Z). */
  lastAt: Date | null;
  lastAtEstimated: boolean;
  lastOutcome: ActivityOutcome | null;
  lastType: ActivityType | null;
  /** Herhangi bir kanaldan dönüş alındı (yapışkan: sonraki "Dönüş bekleniyor" silmez). */
  replied: boolean;
  firstReplyAt: Date | null;
  channels: Partial<Record<ActivityType, ChannelFacts>>;
  /** Sonucu ya da türü "Teklif gönderildi" olan ilk temas (D3). */
  proposalContactAt: Date | null;
}

/** Yerelden bağımsız metin sırası (kodlar ASCII). */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const rowKey = (leadId: string, type: string, outcome: string | null, replied: boolean, estimated: boolean) =>
  `${leadId}|${type}|${outcome ?? ""}|${replied ? 1 : 0}|${estimated ? 1 : 0}`;

/**
 * SQL `GROUP BY lead_id, type, outcome, customer_replied, date_estimated` ile aynı toplam (sahte depo ve
 * `get` sorgusu bunu kullanır). Yalnız `doneAt` dolu satırlar; çıktı anahtara göre sıralı (kararlı).
 */
export function aggregateContacts(acts: readonly Activity[]): ContactAggregateRow[] {
  const by = new Map<string, ContactAggregateRow>();
  for (const a of acts) {
    if (a.doneAt === null) continue;
    const key = rowKey(a.leadId, a.type, a.outcome, a.customerReplied, a.dateEstimated);
    const row = by.get(key);
    if (!row) {
      by.set(key, {
        leadId: a.leadId,
        type: a.type,
        outcome: a.outcome,
        customerReplied: a.customerReplied,
        estimated: a.dateEstimated,
        n: 1,
        firstAt: a.doneAt,
        lastAt: a.doneAt,
      });
      continue;
    }
    row.n++;
    if (a.doneAt.getTime() < row.firstAt.getTime()) row.firstAt = a.doneAt;
    if (a.doneAt.getTime() > row.lastAt.getTime()) row.lastAt = a.doneAt;
  }
  return [...by.entries()].sort(([a], [b]) => cmp(a, b)).map(([, row]) => row);
}

const rowIsReply = (r: ContactAggregateRow): boolean => isReply(r.outcome, r.customerReplied);
const rowIsProposal = (r: ContactAggregateRow): boolean => r.outcome === "proposal_sent" || r.type === "proposal_sent";

/**
 * Eşit zamanlı satırların sırası [K-I7]: önce dönüş, sonra teklif, sonra diğerleri; sonra tahmini olmayan;
 * sonra tür ve sonuç alfabetik. Excel aktarımındaki gönderim (09:00) ve dönüş (09:01) aynı dakikaya düşse de
 * son temas sonucu "Dönüş alındı" olur.
 */
function tieRank(a: ContactAggregateRow, b: ContactAggregateRow): number {
  const kind = (r: ContactAggregateRow) => (rowIsReply(r) ? 0 : rowIsProposal(r) ? 1 : 2);
  return (
    kind(a) - kind(b) ||
    Number(a.estimated) - Number(b.estimated) ||
    cmp(a.type, b.type) ||
    cmp(a.outcome ?? "", b.outcome ?? "")
  );
}

/** `at` en küçük (ya da `latest` ise en büyük) satır; eşitlikte `tieRank`. */
function pick(
  rows: readonly ContactAggregateRow[],
  at: (r: ContactAggregateRow) => Date,
  latest: boolean,
): ContactAggregateRow | null {
  let best: ContactAggregateRow | null = null;
  for (const r of rows) {
    if (!best) {
      best = r;
      continue;
    }
    const d = at(r).getTime() - at(best).getTime();
    if ((latest ? d > 0 : d < 0) || (d === 0 && tieRank(r, best) < 0)) best = r;
  }
  return best;
}

const firstOf = (rows: readonly ContactAggregateRow[]) => pick(rows, (r) => r.firstAt, false);
const lastOf = (rows: readonly ContactAggregateRow[]) => pick(rows, (r) => r.lastAt, true);

/**
 * Lead'in temas özeti. Durum yalnız temas kayıtlarına ve köken işaretine bakar, **aşamaya bakmaz** [K-B1]:
 * temas varsa `contacted`; yoksa eski kayıtsa `legacy`; değilse `never`.
 */
export function summarizeContacts(rows: readonly ContactAggregateRow[], historyUnknown: boolean): ContactSummary {
  const count = rows.reduce((s, r) => s + r.n, 0);
  const first = firstOf(rows);
  const last = lastOf(rows);
  const replies = rows.filter(rowIsReply);
  const firstReply = firstOf(replies);
  const firstProposal = firstOf(rows.filter(rowIsProposal));

  const channels: Partial<Record<ActivityType, ChannelFacts>> = {};
  for (const type of ACTIVITY_TYPES) {
    const own = rows.filter((r) => r.type === type);
    const cFirst = firstOf(own);
    const cLast = lastOf(own);
    if (!cFirst || !cLast) continue;
    const cReply = firstOf(own.filter(rowIsReply));
    channels[type] = {
      count: own.reduce((s, r) => s + r.n, 0),
      firstAt: cFirst.firstAt,
      lastAt: cLast.lastAt,
      firstReplyAt: cReply?.firstAt ?? null,
      firstReplyEstimated: cReply?.estimated ?? false,
    };
  }

  return {
    state: count > 0 ? "contacted" : historyUnknown ? "legacy" : "never",
    count,
    firstAt: first?.firstAt ?? null,
    firstAtEstimated: first?.estimated ?? false,
    lastAt: last?.lastAt ?? null,
    lastAtEstimated: last?.estimated ?? false,
    lastOutcome: last?.outcome ?? null,
    lastType: last?.type ?? null,
    replied: replies.length > 0,
    firstReplyAt: firstReply?.firstAt ?? null,
    channels,
    proposalContactAt: firstProposal?.firstAt ?? null,
  };
}

/**
 * Temas kuralları (domain verisi) [M-B1]: sunucu varsayılanları bundan hesaplar, `/reference` arayüze gönderir;
 * arayüz kural yazmaz. Değişiklik tek sabittir (iş emri §8 soru 4 ve 5).
 */
export const CONTACT_RULES = {
  defaultOutcome: {
    call: "awaiting_reply",
    email: "awaiting_reply",
    whatsapp: "awaiting_reply",
    other: "awaiting_reply",
    meeting: "reply_received",
    site_visit: "reply_received",
    proposal_sent: "proposal_sent",
  },
  /** "Müşteri cevap verdi" işaretinin göründüğü sonuçlar. */
  repliedFlagOutcomes: ["follow_up", "proposal_sent"],
  /** İşaretin varsayılan olarak işaretli geldiği kanallar. */
  repliedDefaultTypes: ["call", "meeting", "site_visit"],
  /** Müşteri durumu alanının göründüğü sonuçlar (+ "Müşteri cevap verdi" işaretliyse). */
  statusOutcomes: ["reply_received", "negative", "agreed", "proposal_sent"],
  /** Seçilince "Aşamayı 'Kaybedildi' yap" satırını öneren durumlar. */
  statusSuggestsLost: ["not_interested"],
  /** §8 soru 5: cevapsız gönderimde "İletişim kuruldu" önseçilsin mi. */
  contactedOnOutbound: false,
  /** Sonuca göre sonraki takip kaç gün sonra; null = takip önerilmez. */
  nextAfterDays: { awaiting_reply: 2, reply_received: 3, follow_up: 3, proposal_sent: 3, negative: null, agreed: null },
  nextHour: 9,
  futureToleranceMinutes: 5,
  /** Excel veri doğrulamasının alt sınırı [K-M5]; İstanbul takvim günü. */
  minContactDate: "2024-01-01",
  noteMax: 4000,
} as const satisfies {
  defaultOutcome: Record<ActivityType, ActivityOutcome>;
  repliedFlagOutcomes: readonly ActivityOutcome[];
  repliedDefaultTypes: readonly ActivityType[];
  statusOutcomes: readonly ActivityOutcome[];
  statusSuggestsLost: readonly CustomerStatus[];
  contactedOnOutbound: boolean;
  nextAfterDays: Record<ActivityOutcome, number | null>;
  nextHour: number;
  futureToleranceMinutes: number;
  minContactDate: string;
  noteMax: number;
};

/** "Müşteri cevap verdi" işareti bu sonuçta anlamlı mı. */
export const repliedFlagApplies = (o: ActivityOutcome): boolean =>
  (CONTACT_RULES.repliedFlagOutcomes as readonly ActivityOutcome[]).includes(o);

/**
 * Diyalogdaki aşama satırının modu: `fixed` = onay kutusu yok, kaydedince geçer; `checked`/`unchecked` = onay kutusu
 * işaretli/işaretsiz gelir; `checked_if_replied` = "Müşteri cevap verdi" ile birlikte işaretlenir.
 */
export type StageLineMode = "fixed" | "checked" | "unchecked" | "checked_if_replied";
export const STAGE_LINE_MODES: readonly StageLineMode[] = ["fixed", "checked", "unchecked", "checked_if_replied"];

/**
 * Sonuç ve mevcut aşamaya göre önerilen aşama satırı (iş emri §3.3.2). QUALIFIED hiç önerilmez (3 soru diyalogu
 * gerekir). `rules` yalnız §8 soru 5 anahtarını test etmek için verilir.
 */
export function stageLine(
  i: { outcome: ActivityOutcome; current: StageCode },
  rules: { contactedOnOutbound: boolean } = CONTACT_RULES,
): { target: StageCode; mode: StageLineMode } | null {
  if (isTerminal(i.current)) return null;
  if (i.outcome === "proposal_sent" && stageIndex(i.current) < stageIndex("PROPOSAL")) {
    return { target: "PROPOSAL", mode: "fixed" };
  }
  if (i.outcome === "agreed") return { target: "WON", mode: "unchecked" };
  if (i.outcome === "negative") return { target: "LOST", mode: "unchecked" };
  if (i.current === "NEW") {
    if (i.outcome === "reply_received") return { target: "CONTACTED", mode: "checked" };
    if (i.outcome === "follow_up") return { target: "CONTACTED", mode: "checked_if_replied" };
    if (i.outcome === "awaiting_reply") {
      return { target: "CONTACTED", mode: rules.contactedOnOutbound ? "checked" : "unchecked" };
    }
  }
  return null;
}

/** Bu hedeflerde sonraki takip önerilmez: PROPOSAL'da `ChangeLeadStage` "Teklif takibi"ni açar (çift arama olmaz). */
export const NO_NEXT_TARGETS: readonly StageCode[] = ["PROPOSAL", "WON", "LOST"];
/** Takip aynı kanaldan yapılır; diğer kanallarda (toplantı, saha, diğer, teklif) arama. */
const SAME_CHANNEL_NEXT: readonly ActivityType[] = ["call", "email", "whatsapp"];

/** Kaydedilen temastan sonra önerilen takip; terminal aşamada, kapanış/teklif hedefinde ve Olumsuz/Anlaşma'da null. */
export function suggestNext(i: {
  outcome: ActivityOutcome;
  type: ActivityType;
  now: Date;
  current: StageCode;
  stageTarget: StageCode | null;
  timeZone: string;
}): { type: ActivityType; dueAt: Date; subject: string } | null {
  if (isTerminal(i.current)) return null;
  if (i.stageTarget !== null && NO_NEXT_TARGETS.includes(i.stageTarget)) return null;
  const days = CONTACT_RULES.nextAfterDays[i.outcome];
  if (days === null) return null;
  const type: ActivityType = SAME_CHANNEL_NEXT.includes(i.type) ? i.type : "call";
  return {
    type,
    dueAt: atLocalHour(i.now, days, CONTACT_RULES.nextHour, i.timeZone),
    subject: FOLLOW_UP_SUBJECTS[type],
  };
}

/**
 * Temasın varsayılan olarak tamamlayacağı plan: vadesi bugünün sonuna (saat dilimi) kadar gelmiş açık işler;
 * önce aynı tür, sonra en erken vade. Gelecekteki planlar varsayılan olmaz [M-I8][U-I5].
 */
export function pickCompletable(
  open: readonly Activity[],
  type: ActivityType,
  now: Date,
  timeZone: string,
): Activity | null {
  const today = calendarDay(now, timeZone);
  const due = open.filter((a) => isOpenActivity(a) && calendarDay(a.dueAt, timeZone) <= today);
  due.sort(
    (a, b) =>
      Number(b.type === type) - Number(a.type === type) || a.dueAt.getTime() - b.dueAt.getTime() || cmp(a.id, b.id),
  );
  return due[0] ?? null;
}

export interface ContactInput {
  type: unknown;
  outcome: unknown;
  customerReplied: boolean;
  occurredAt: Date;
  now: Date;
  note: string;
  /** Tamamlanan planın türü; `proposal_sent`/`site_visit` yalnız o türde plan tamamlanırken kanal olur [M-M5]. */
  completingType: ActivityType | null;
  timeZone: string;
}

export interface ValidContact {
  type: ActivityType;
  outcome: ActivityOutcome;
  customerReplied: boolean;
  occurredAt: Date;
  note: string;
}

/** Temas girdisinin doğrulaması; hiçbir şey yazılmadan önce çalışır. Not kırpılır. */
export function validateContact(i: ContactInput): Result<ValidContact, RuleError> {
  const channel = (CONTACT_CHANNELS as readonly unknown[]).includes(i.type);
  if (!isActivityType(i.type) || (!channel && i.completingType !== i.type)) {
    return err(new RuleError("contact.type", "Bu tür temas kanalı olarak seçilemez.", { type: i.type }));
  }
  if (!isActivityOutcome(i.outcome)) {
    return err(new RuleError("contact.outcome", "Temas sonucunu seçin.", { outcome: i.outcome }));
  }
  if (i.customerReplied && !repliedFlagApplies(i.outcome)) {
    return err(
      new RuleError("contact.replied_flag", "'Müşteri cevap verdi' yalnız Takip edilecek ve Teklif gönderildi'de.", {
        outcome: i.outcome,
      }),
    );
  }
  const at = i.occurredAt;
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    return err(new RuleError("contact.occurred_invalid", "Temas zamanı geçersiz.", {}));
  }
  if (at.getTime() > i.now.getTime() + CONTACT_RULES.futureToleranceMinutes * 60_000) {
    return err(new RuleError("contact.future", "İleri bir saat seçilemez.", { occurredAt: at.toISOString() }));
  }
  if (calendarDay(at, i.timeZone) < CONTACT_RULES.minContactDate) {
    return err(
      new RuleError("contact.too_old", "Temas tarihi 01.01.2024'ten önce olamaz.", { occurredAt: at.toISOString() }),
    );
  }
  const note = String(i.note ?? "").trim();
  if (note.length > CONTACT_RULES.noteMax) {
    return err(
      new RuleError("contact.note_too_long", "Görüşme notu en fazla 4000 karakter.", {
        max: CONTACT_RULES.noteMax,
        length: note.length,
      }),
    );
  }
  return ok({ type: i.type, outcome: i.outcome, customerReplied: i.customerReplied, occurredAt: at, note });
}
