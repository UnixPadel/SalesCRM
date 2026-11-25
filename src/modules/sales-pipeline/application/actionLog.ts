import { RuleError, err, ok, type Clock, type IdGenerator, type Logger, type Result } from "../../shared/kernel";
import type { UnitOfWork } from "../domain";

/**
 * İşlem günlüğü (2026-11-20): kullanıcıların lead üzerinde yaptığı işlemler; yönetimdeki "Loglar" sekmesi okur.
 * Kayıt, işlem başarıyla bittikten sonra yazılır ve asıl işlemi hiçbir zaman bozmaz (hata yalnız loglanır).
 * İçe aktarma, taşıma ve reklam akışı (kişi olmayan aktörler) kaydedilmez.
 */
export const ACTION_TYPES = [
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
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
export const isActionType = (v: unknown): v is ActionType => (ACTION_TYPES as readonly unknown[]).includes(v);

/** Kişi olmayan aktörler (Excel / form tablosu aktarımı, eski sistem taşıması). */
const SYSTEM_ACTORS: readonly string[] = ["import", "migration"];

export interface ActionLogEntry {
  id: string;
  occurredAt: Date;
  actorUserId: string;
  action: ActionType;
  /** Lead silindiyse null; ad o andaki haliyle `leadName`'de kalır. */
  leadId: string | null;
  leadName: string;
  details: Record<string, unknown>;
}

export interface ActionLogFilter {
  actorUserId?: string | undefined;
  actions?: readonly ActionType[] | undefined;
  /** occurred_at alt (dahil) ve üst (hariç) sınırı. */
  from?: Date | undefined;
  to?: Date | undefined;
  /** Anahtar kümesi: bu (occurred_at, id) çiftinden öncekiler. */
  before?: { at: Date; id: string } | undefined;
  limit: number;
}

export interface ActionLogStore {
  insert(entry: ActionLogEntry): Promise<void>;
  /** En yeni önce: `(occurred_at DESC, id DESC)`. */
  list(filter: ActionLogFilter): Promise<ActionLogEntry[]>;
  /** Günlükte kaydı olan kullanıcı kimlikleri (süzgeç listesi). */
  actors(): Promise<string[]>;
}

export interface RecordActionInput {
  actor: { userId: string } | null | undefined;
  action: ActionType;
  /** `fullName` verilmezse lead'den okunur. */
  lead: { id: string; fullName?: string | undefined };
  details?: Record<string, unknown> | undefined;
}

/** Use-case'lerin gördüğü yüz: yalnız kaydetme. */
export interface ActionRecorder {
  record(input: RecordActionInput): Promise<void>;
}

export class ActionLog implements ActionRecorder {
  constructor(
    private readonly deps: { store: ActionLogStore; uow: UnitOfWork; clock: Clock; ids: IdGenerator; logger: Logger },
  ) {}

  async record(input: RecordActionInput): Promise<void> {
    const userId = input.actor?.userId;
    if (!userId || SYSTEM_ACTORS.includes(userId)) return;
    const { store, uow, clock, ids, logger } = this.deps;
    try {
      const leadName =
        input.lead.fullName ??
        (await uow.run(async (repos) => (await repos.leads.findById(input.lead.id))?.fullName ?? ""));
      await store.insert({
        id: ids.next(),
        occurredAt: clock.now(),
        actorUserId: userId,
        action: input.action,
        leadId: input.lead.id,
        leadName,
        details: input.details ?? {},
      });
    } catch (error) {
      logger.warn("işlem günlüğü yazılamadı", { action: input.action, leadId: input.lead.id, error });
    }
  }
}

export const LOG_PAGE_DEFAULT = 100;
export const LOG_PAGE_MAX = 500;

export interface ListActionsInput {
  /** Günlüğü görme izni kişi bazındadır (oturum `seesLogs`); rol yetmez. */
  viewer: { seesLogs?: boolean | undefined };
  actorUserId?: string | undefined;
  actions?: readonly ActionType[] | undefined;
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
    const rows = await this.store.list({
      actorUserId: input.actorUserId,
      actions: input.actions,
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

/** Testler ve bellek içi kurulum. */
export class InMemoryActionLogStore implements ActionLogStore {
  readonly rows: ActionLogEntry[] = [];
  async insert(entry: ActionLogEntry): Promise<void> {
    this.rows.push({ ...entry });
  }
  async list(f: ActionLogFilter): Promise<ActionLogEntry[]> {
    const key = (e: { occurredAt: Date; id: string }) => `${e.occurredAt.toISOString()}|${e.id}`;
    const before = f.before ? key({ occurredAt: f.before.at, id: f.before.id }) : null;
    return this.rows
      .filter(
        (e) =>
          (!f.actorUserId || e.actorUserId === f.actorUserId) &&
          (!f.actions?.length || f.actions.includes(e.action)) &&
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
