import { RuleError, err, ok, type Clock, type IdGenerator, type Logger, type Result } from "../../shared/kernel";
import type { ActionLogRecord, ActionLogWriter, Repositories, UnitOfWork } from "../domain";

/**
 * İşlem günlüğü (2026-11-20; 2026-11-27 bütün işlemler + değiştirilemez): yönetimdeki "Loglar" sekmesi okur.
 *
 *  - Lead işlemleri use-case içinde, işlemle aynı transaction'da yazılır (`record(input, repos)`): kayıt yazılamazsa
 *    işlem de geri alınır. Transaction verilmezse (bellek içi test kurulumu) kayıt sonradan yazılır, hata yalnız loglanır.
 *  - Yönetim paneli, aktarımlar, oturum ve reddedilen istekler HTTP katmanında (src/bootstrap/auditTrail.ts) yazılır.
 *  - Satırlar yalnız eklenir: veritabanı UPDATE / DELETE / TRUNCATE'i reddeder (migration 0027), arayüzde silme yoktur.
 *  - Kişisel veri değerleri (telefon, e-posta, ad) `details`'e yazılmaz; yalnız alan adları ve kişisel olmayan değerler.
 *  - İçe aktarma, taşıma ve reklam akışı (kişi olmayan aktörler) kaydedilmez.
 */
export const ACTION_TYPES = [
  // lead
  "lead.created",
  "lead.assigned",
  "lead.fields_updated",
  "lead.status_changed",
  "stage.changed",
  "stage.undone",
  "contact.logged",
  "contact.undone",
  "contact.deleted",
  "contact.updated",
  "activity.planned",
  "activity.updated",
  "activity.done",
  "activity.reopened",
  "activity.deleted",
  "attachment.added",
  "attachment.deleted",
  "lead.deleted",
  "lead.restored",
  "warning.checked",
  "warning.unchecked",
  // kişi / kuruluş
  "organization.created",
  "organization.updated",
  "organization.archived",
  "organization.unarchived",
  "person.merged",
  // yönetim paneli
  "territory.updated",
  "territory.deleted",
  "territory.applied_to_pool",
  "territory.reassigned",
  "product_catalog.imported",
  "settings.updated",
  "stage_mapping.updated",
  "field_mapping.updated",
  "field_mapping.deleted",
  "fx_rates.updated",
  "fx_rates.refreshed",
  "outbox.requeued",
  "inbox.requeued",
  "provider.outbound_updated",
  "checkpoint.restored",
  // elle başlatılan aktarımlar
  "sheet_sync.run",
  "st_customer_sync.run",
  "mail_stats.run",
  // oturum
  "auth.login",
  "auth.login_failed",
  "auth.logout",
  // eşlemesi olmayan yazma isteği (yeni bir uç eklenip tabloya yazılmadıysa da iz kalsın)
  "request.other",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
export const isActionType = (v: unknown): v is ActionType => (ACTION_TYPES as readonly unknown[]).includes(v);

export const TARGET_TYPES = [
  "lead",
  "organization",
  "person",
  "territory",
  "product_catalog",
  "settings",
  "mapping",
  "fx_rates",
  "queue",
  "checkpoint",
  "sync",
  "session",
  "request",
] as const;
export type TargetType = (typeof TARGET_TYPES)[number];
export const isTargetType = (v: unknown): v is TargetType => (TARGET_TYPES as readonly unknown[]).includes(v);

export const ACTION_RESULTS = ["ok", "denied", "rejected", "error"] as const;
export type ActionResult = (typeof ACTION_RESULTS)[number];
export const isActionResult = (v: unknown): v is ActionResult => (ACTION_RESULTS as readonly unknown[]).includes(v);

/** Kişi olmayan aktörler (Excel / form tablosu aktarımı, eski sistem taşıması). */
const SYSTEM_ACTORS: readonly string[] = ["import", "migration"];
/** Oturumu olmayan istek (başarısız giriş). */
export const ANONYMOUS_ACTOR = "anonymous";

export type ActionLogEntry = Omit<ActionLogRecord<ActionType>, "targetType" | "result"> & {
  targetType: TargetType;
  result: ActionResult;
};

export interface ActionLogFilter {
  actorUserId?: string | undefined;
  actions?: readonly ActionType[] | undefined;
  targetType?: TargetType | undefined;
  /** Tek bir hedef (ör. bir lead'in geçmişi); `targetType` ile birlikte. */
  targetId?: string | undefined;
  /** Hedef adında (lead adı, ülke kodu…) büyük/küçük harf duyarsız arama. */
  search?: string | undefined;
  result?: ActionResult | undefined;
  /** occurred_at alt (dahil) ve üst (hariç) sınırı. */
  from?: Date | undefined;
  to?: Date | undefined;
  /** Anahtar kümesi: bu (occurred_at, id) çiftinden öncekiler. */
  before?: { at: Date; id: string } | undefined;
  limit: number;
}

export interface ActionLogStore extends ActionLogWriter {
  insert(entry: ActionLogEntry): Promise<void>;
  /** En yeni önce: `(occurred_at DESC, id DESC)`. */
  list(filter: ActionLogFilter): Promise<ActionLogEntry[]>;
  /** Günlükte kaydı olan kullanıcı kimlikleri (süzgeç listesi). */
  actors(): Promise<string[]>;
}

export interface RecordActionInput {
  actor: { userId: string } | null | undefined;
  action: ActionType;
  /** Lead işlemi; `fullName` verilmezse lead'den okunur. Hedef de bu lead olur. */
  lead?: { id: string; fullName?: string | undefined } | undefined;
  /** Lead dışı hedef (bölge, ayar, oturum…). */
  target?: { type: TargetType; id?: string | null | undefined; label?: string | undefined } | undefined;
  result?: ActionResult | undefined;
  details?: Record<string, unknown> | undefined;
}

/** Use-case'lerin gördüğü yüz: yalnız kaydetme. `repos` verilirse kayıt o transaction'da yazılır. */
export interface ActionRecorder {
  record(input: RecordActionInput, repos?: Repositories): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ActionLog implements ActionRecorder {
  constructor(
    private readonly deps: {
      store: ActionLogStore;
      uow: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
      logger: Logger;
      /** Kayıt yazıldıktan sonra (HTTP katmanı: bu istek için ayrıca genel kayıt gerekmez). */
      onRecorded?: (() => void) | undefined;
    },
  ) {}

  /**
   * Transaction içinde (`repos.actionLog` varsa) hata yukarı fırlar ve işlem geri alınır. Transaction dışında hata
   * yalnız loglanır: asıl işlem zaten bitmiştir.
   */
  async record(input: RecordActionInput, repos?: Repositories): Promise<void> {
    const userId = input.actor?.userId;
    if (!userId || SYSTEM_ACTORS.includes(userId)) return;
    const writer = repos?.actionLog;
    if (writer && repos) {
      await writer.insert(await this.entry(input, userId, repos));
      this.deps.onRecorded?.();
      return;
    }
    try {
      await this.deps.store.insert(await this.entry(input, userId, undefined));
      this.deps.onRecorded?.();
    } catch (error) {
      this.deps.logger.warn("işlem günlüğü yazılamadı", { action: input.action, error });
    }
  }

  private async entry(
    input: RecordActionInput,
    userId: string,
    repos: Repositories | undefined,
  ): Promise<ActionLogEntry> {
    const { clock, ids, uow } = this.deps;
    const leadId = input.lead && UUID.test(input.lead.id) ? input.lead.id : null;
    let leadName = input.lead?.fullName ?? "";
    if (input.lead && input.lead.fullName === undefined && leadId) {
      const find = async (r: Repositories) => (await r.leads.findById(leadId))?.fullName ?? "";
      leadName = repos ? await find(repos) : await uow.run(find);
    }
    const target = input.lead
      ? { type: "lead" as const, id: input.lead.id, label: leadName }
      : { type: input.target?.type ?? "request", id: input.target?.id ?? null, label: input.target?.label ?? "" };
    return {
      id: ids.next(),
      occurredAt: clock.now(),
      actorUserId: userId,
      action: input.action,
      leadId,
      leadName,
      targetType: target.type,
      targetId: target.id,
      targetLabel: target.label,
      result: input.result ?? "ok",
      details: input.details ?? {},
    };
  }
}

export const LOG_PAGE_DEFAULT = 100;
export const LOG_PAGE_MAX = 500;

export interface ListActionsInput {
  /** Günlüğü görme izni kişi bazındadır (oturum `seesLogs`); rol yetmez. */
  viewer: { seesLogs?: boolean | undefined };
  actorUserId?: string | undefined;
  actions?: readonly ActionType[] | undefined;
  targetType?: TargetType | undefined;
  targetId?: string | undefined;
  search?: string | undefined;
  result?: ActionResult | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  before?: { at: Date; id: string } | undefined;
  limit?: number | undefined;
}

export interface ActionLogPage {
  items: ActionLogEntry[];
  /** Devamı varsa son satırın anahtarı. */
  next: { at: Date; id: string } | null;
  actors: string[];
}

export class ActionLogQueries {
  constructor(private readonly store: ActionLogStore) {}

  async list(input: ListActionsInput): Promise<Result<ActionLogPage, RuleError>> {
    if (input.viewer.seesLogs !== true) {
      return err(new RuleError("logs.forbidden", "İşlem günlüğünü görme yetkiniz yok.", {}));
    }
    const limit = Math.min(Math.max(1, Math.floor(input.limit ?? LOG_PAGE_DEFAULT)), LOG_PAGE_MAX);
    const search = input.search?.trim().slice(0, 100) || undefined;
    const rows = await this.store.list({
      actorUserId: input.actorUserId,
      actions: input.actions,
      targetType: input.targetType,
      targetId: input.targetId,
      search,
      result: input.result,
      from: input.from,
      to: input.to,
      before: input.before,
      limit: limit + 1,
    });
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return ok({
      items,
      next: rows.length > limit && last ? { at: last.occurredAt, id: last.id } : null,
      actors: await this.store.actors(),
    });
  }
}

/** Testler ve bellek içi kurulum. Gerçek tablo gibi yalnız ekler. */
export class InMemoryActionLogStore implements ActionLogStore {
  readonly rows: ActionLogEntry[] = [];
  async insert(entry: ActionLogEntry): Promise<void> {
    this.rows.push({ ...entry });
  }
  async list(f: ActionLogFilter): Promise<ActionLogEntry[]> {
    const key = (e: { occurredAt: Date; id: string }) => `${e.occurredAt.toISOString()}|${e.id}`;
    const before = f.before ? key({ occurredAt: f.before.at, id: f.before.id }) : null;
    const q = f.search?.toLocaleLowerCase("tr");
    return this.rows
      .filter(
        (e) =>
          (!f.actorUserId || e.actorUserId === f.actorUserId) &&
          (!f.actions?.length || f.actions.includes(e.action)) &&
          (!f.targetType || e.targetType === f.targetType) &&
          (!f.targetId || e.targetId === f.targetId) &&
          (!q || e.targetLabel.toLocaleLowerCase("tr").includes(q)) &&
          (!f.result || e.result === f.result) &&
          (!f.from || e.occurredAt >= f.from) &&
          (!f.to || e.occurredAt < f.to) &&
          (before === null || key(e) < before),
      )
      .sort((a, b) => (key(a) < key(b) ? 1 : -1))
      .slice(0, f.limit);
  }
  async actors(): Promise<string[]> {
    return [...new Set(this.rows.map((e) => e.actorUserId))].sort();
  }
}
