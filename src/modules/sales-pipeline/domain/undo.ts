import { RuleError, err, ok, type Result } from "../../shared/kernel";
import type { StageEvent } from "./lead";
import type { StageCode } from "./stage";

export interface UndoRequest {
  /** Lead'in tüm aşama olayları (geri alınmışlar dahil), sıra önemsiz. */
  events: readonly StageEvent[];
  now: Date;
  windowMs: number;
  actorUserId: string;
  actorIsAdmin: boolean;
  /** Verilirse yalnız bu değişiklik geri alınır; son değişiklik başkasıysa `undo.stale`. */
  changeId?: string | undefined;
}

export interface UndoPlan {
  changeId: string;
  /** Geri alınacak olay kimlikleri (auto_fill dahil). */
  eventIds: string[];
  revertTo: StageCode;
}

/**
 * 10 dakikalık geri al (Genel plan): yalnız lead'in SON değişikliği, süre içinde, değişikliği yapan
 * kişi ya da admin tarafından. Geri alınan olaylar silinmez, `undone_at` alır; outbox satırları
 * skipped olur ve platforma hiç gitmez.
 */
export function planUndo(req: UndoRequest): Result<UndoPlan, RuleError> {
  const live = req.events.filter((e) => !e.undoneAt).sort((a, b) => b.sequence - a.sequence);
  const last = live[0];
  if (!last || last.origin === "system") {
    return err(new RuleError("undo.nothing", "Geri alınacak aşama değişikliği yok.", {}));
  }
  // Faz 7g [M-I1]: temas kaydının geri alması kendi değişikliğini adıyla ister; sonra başka değişiklik geldiyse dokunmaz.
  if (req.changeId !== undefined && last.changeId !== req.changeId) {
    return err(new RuleError("undo.stale", "Aşama bu kayıttan sonra yeniden değişti; aşama geri alınmadı.", {}));
  }
  const group = live.filter((e) => e.changeId === last.changeId).sort((a, b) => a.sequence - b.sequence);
  const previous = live.find((e) => e.changeId !== last.changeId);
  if (!previous) return err(new RuleError("undo.nothing", "İlk aşama geri alınamaz.", {}));

  const age = req.now.getTime() - last.occurredAt.getTime();
  if (age > req.windowMs) {
    return err(
      new RuleError("undo.expired", "Geri alma süresi doldu.", {
        windowMinutes: Math.round(req.windowMs / 60_000),
        ageMinutes: Math.round(age / 60_000),
      }),
    );
  }
  if (!req.actorIsAdmin && last.actorUserId !== req.actorUserId) {
    return err(new RuleError("undo.not_owner", "Yalnız değişikliği yapan kişi ya da admin geri alabilir.", {}));
  }
  return ok({ changeId: last.changeId, eventIds: group.map((e) => e.id), revertTo: previous.stageCode });
}

export interface RollbackRequest {
  /** Lead'in tüm aşama olayları (geri alınmışlar dahil), sıra önemsiz. */
  events: readonly StageEvent[];
  currentStage: StageCode;
  target: StageCode;
}

export interface RollbackPlan {
  /** Geri alınacak olay kimlikleri (hedef aşamadan sonraki bütün canlı olaylar). */
  eventIds: string[];
  /** O olayları üreten değişiklikler; açık otomatik takipleri de gider. */
  changeIds: string[];
  revertTo: StageCode;
}

/**
 * Yönetici düzeltmesi (2026-11-24): lead daha önce geçtiği bir aşamaya süre sınırı olmadan geri çekilir; kazanılan ya
 * da kaybedilen lead de yeniden açılır. Hedef aşamanın son canlı olayından sonraki olaylar silinmez, `undone_at` alır
 * (10 dakikalık geri al ile aynı iz). Lead'in hiç geçmediği aşamaya geri çekme olmaz: o ileri geçiştir.
 */
export function planRollback(req: RollbackRequest): Result<RollbackPlan, RuleError> {
  const live = req.events.filter((e) => !e.undoneAt).sort((a, b) => a.sequence - b.sequence);
  const anchor = [...live].reverse().find((e) => e.stageCode === req.target);
  if (req.target === req.currentStage || !anchor) {
    return err(
      new RuleError("stage.rollback_unreached", "Lead yalnız daha önce geçtiği bir aşamaya geri çekilir.", {
        from: req.currentStage,
        to: req.target,
      }),
    );
  }
  const later = live.filter((e) => e.sequence > anchor.sequence);
  return ok({
    eventIds: later.map((e) => e.id),
    changeIds: [...new Set(later.map((e) => e.changeId))],
    revertTo: req.target,
  });
}

/** Yöneticinin geri çekebileceği aşamalar: lead'in canlı geçmişindeki önceki aşamalar, akış sırasıyla. */
export function rollbackTargets(events: readonly StageEvent[], currentStage: StageCode): StageCode[] {
  const live = events.filter((e) => !e.undoneAt).sort((a, b) => a.sequence - b.sequence);
  const last = [...live].reverse().find((e) => e.stageCode === currentStage);
  const before = last ? live.filter((e) => e.sequence < last.sequence) : live;
  return [...new Set(before.map((e) => e.stageCode))].filter((s) => s !== currentStage);
}
