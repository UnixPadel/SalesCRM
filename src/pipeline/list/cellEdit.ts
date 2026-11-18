/**
 * Lead listesinde hücreye tıklayarak düzenleme: hangi hücre, kim için, ne yapar. Kural: hücre ancak tıklama onu
 * değiştirebiliyorsa tıklanır olur. Temastan türeyen sütunlar doğrudan yazılmaz; doğru temas kaydı açılır ve işaret
 * ondan doğar. Yetkiler sunucudakiyle aynıdır (sunucu ayrıca denetler). Saf: React ve DOM yok.
 */
import type {
  ActivityOutcomeDto,
  ActivityTypeDto,
  LeadListDto,
  ReferenceDto,
  StageCodeDto,
} from "../../modules/sales-pipeline/api/dto";
import { otherReply } from "./listColumns";

export type CellForm = "note" | "products" | "contact" | "plan" | "warnings";

/** "İletişim kaydet" penceresinin hücreden gelen ön seçimi. */
export interface LogPreset {
  type?: ActivityTypeDto;
  outcome?: ActivityOutcomeDto;
  activityId?: string;
  pickChannel?: boolean;
}

export type CellAction = { kind: "log"; preset: LogPreset } | { kind: "pick" } | { kind: "form"; form: CellForm };

export interface CellPerms {
  /** Lead üzerinde işlem yapabilir: görüntüleyici değil; yönetici, sorumlu ya da havuz lead'i. */
  canAct: boolean;
  /** Yönetici (görüntüleyici değil). */
  admin: boolean;
  canEditProducts: boolean;
}

export function cellPerms(
  l: Pick<LeadListDto, "assignedUserId">,
  who: { userId: string | null; isAdmin: boolean; isViewer: boolean; repsEditProducts: boolean },
): CellPerms {
  const admin = who.isAdmin && !who.isViewer;
  const own = who.userId !== null && l.assignedUserId === who.userId;
  return {
    canAct: !who.isViewer && (who.isAdmin || !l.assignedUserId || own),
    admin,
    canEditProducts: admin || (!who.isViewer && who.repsEditProducts && own),
  };
}

const log = (preset: LogPreset = {}): CellAction => ({ kind: "log", preset });
const form = (name: CellForm): CellAction => ({ kind: "form", form: name });
const PICK: CellAction = { kind: "pick" };

/** Form cevabı sütunları → lead alanı. */
export const ANSWER_COLUMNS = {
  site: "installSite",
  timeline: "installTimeline",
  profile: "customerProfile",
  band: "courtCountBand",
} as const;

export const isTerminalLead = (l: Pick<LeadListDto, "currentStage">): boolean =>
  l.currentStage === "WON" || l.currentStage === "LOST";

/** Hücrenin tıklama eylemi; null = düz metin. */
export function cellAction(colId: string, l: LeadListDto, p: CellPerms): CellAction | null {
  const act = (a: CellAction | null) => (p.canAct ? a : null);
  const admin = (a: CellAction | null) => (p.admin ? a : null);
  const ch = l.contact.channels;
  const reply = (type: ActivityTypeDto) => log({ type, outcome: "reply_received", pickChannel: true });
  switch (colId) {
    case "mail":
      return act(log({ type: "email", pickChannel: true }));
    case "wa":
      return act(log({ type: "whatsapp", pickChannel: true }));
    case "other":
      return act(log({ type: "call", pickChannel: true }));
    case "mailReply":
      return act(ch.email?.firstReplyAt ? null : reply("email"));
    case "waReply":
      return act(ch.whatsapp?.firstReplyAt ? null : reply("whatsapp"));
    case "otherReply":
      return act(otherReply(l) ? null : reply("call"));
    case "proposal":
      return act(l.proposal.given ? null : log({ outcome: "proposal_sent", pickChannel: true }));
    case "last":
    case "count":
      return act(log());
    case "first":
      return act(l.contact.firstAt ? null : log());
    case "next":
      if (isTerminalLead(l)) return null;
      return act(l.nextActivity ? log({ type: l.nextActivity.type, activityId: l.nextActivity.id }) : form("plan"));
    case "status":
      return act(PICK);
    case "stage":
      return act(isTerminalLead(l) ? null : PICK);
    case "note":
      return act(form("note"));
    case "standard":
    case "panoramic":
    case "fullPanoramic":
    case "roof":
      return p.canEditProducts ? form("products") : null;
    case "owner":
    case "country":
    case "site":
    case "timeline":
    case "profile":
    case "band":
      return admin(PICK);
    case "phoneNo":
      return admin(form("contact"));
    case "phone":
      return admin(l.phoneE164 ? null : form("contact"));
    case "email":
      return admin(l.email ? null : form("contact"));
    case "warn":
      return admin(l.warnings.length ? form("warnings") : null);
    default:
      return null;
  }
}

/** Gidilebilecek aşamalar: yalnız ileri (Kaybedildi dahil); kapanmış aşamadan hiçbiri. Sıra `/reference`'tan gelir. */
export function forwardStages(stages: ReferenceDto["stages"], from: StageCodeDto): StageCodeDto[] {
  const i = stages.findIndex((s) => s.code === from);
  if (i < 0 || stages[i]!.isTerminal) return [];
  return stages.slice(i + 1).map((s) => s.code);
}

/**
 * Düzenleme sonrası satır sırası: görünüm değişene kadar aynı satırlar aynı yerde kalır, süzgece artık uymasalar da
 * (kullanıcı ✔ işaretini görür, alttaki satır imlecin altına kaymaz). Güncel veri `rows`'tan, sunucu süzgecinin
 * dışına düşmüş satır `extra`'dan gelir; ikisinde de olmayan satır düşer.
 */
export function frozenRows(
  ids: readonly string[],
  rows: readonly LeadListDto[],
  extra: ReadonlyMap<string, LeadListDto>,
): LeadListDto[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const row = byId.get(id) ?? extra.get(id);
    return row ? [row] : [];
  });
}
