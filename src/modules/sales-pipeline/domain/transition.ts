import { Money, RuleError, err, ok, type Result } from "../../shared/kernel";
import type { StageEventOrigin } from "./lead";
import { checkQualification, normalizeAnswers, type QualificationAnswers } from "./qualification";
import { allowedTransitions, isTerminal, skippedStages, type StageCode } from "./stage";

/** Bir aşama değişikliği isteğinin saf değerlendirmesi. Veritabanı yok, saat dışarıdan gelir. */
export interface StageChangeRequest {
  currentStage: StageCode;
  target: StageCode;
  /** WON için zorunlu. */
  value?: { amount: number; currency: string } | null;
  /** LOST için zorunlu; `knownLostReasons` içinde olmalı. */
  lostReasonCode?: string | null;
  /** QUALIFIED için zorunlu; üçü de "evet". */
  qualificationAnswers?: Partial<Record<string, boolean>> | null;
  knownLostReasons: readonly string[];
}

export interface StageEventDraft {
  stageCode: StageCode;
  origin: StageEventOrigin;
  value: { amount: number; currency: string } | null;
  lostReasonCode: string | null;
  qualificationAnswers: QualificationAnswers | null;
}

export interface StageChangePlan {
  from: StageCode;
  to: StageCode;
  /** Sırayla: atlanan aşamalar (auto_fill) sonra hedef (manual). Hepsi aynı zaman damgasını alır. */
  events: StageEventDraft[];
}

export function planStageChange(req: StageChangeRequest): Result<StageChangePlan, RuleError> {
  const { currentStage: from, target: to } = req;

  if (from === to) return err(new RuleError("stage.same", "Lead zaten bu aşamada.", { stage: to }));
  if (isTerminal(from)) {
    return err(
      new RuleError("stage.terminal", "Kazanılan veya kaybedilen lead'in aşaması değişmez; yeni lead açın.", {
        from,
        to,
      }),
    );
  }
  if (!allowedTransitions(from).includes(to)) {
    return err(
      new RuleError("stage.backward", "Aşama geriye alınmaz. Yanlış tık için 10 dakika içinde 'Geri al' kullanın.", {
        from,
        to,
      }),
    );
  }

  const draft = (stageCode: StageCode, origin: StageEventOrigin): StageEventDraft => ({
    stageCode,
    origin,
    value: null,
    lostReasonCode: null,
    qualificationAnswers: null,
  });

  const target = draft(to, "manual");

  if (to === "WON") {
    if (!req.value)
      return err(new RuleError("stage.value_required", "Kazanıldı için tutar ve para birimi zorunlu.", {}));
    const money = Money.create(req.value.amount, req.value.currency);
    if (!money.ok) return money;
    target.value = money.value.toJSON();
  }

  if (to === "LOST") {
    const code = (req.lostReasonCode ?? "").trim();
    if (!code) return err(new RuleError("stage.reason_required", "Kaybedildi için neden zorunlu.", {}));
    if (!req.knownLostReasons.includes(code)) {
      return err(new RuleError("stage.reason_unknown", "Kayıp nedeni listede yok.", { lostReasonCode: code }));
    }
    target.lostReasonCode = code;
  }

  if (to === "QUALIFIED") {
    const check = checkQualification(req.qualificationAnswers);
    if (check.status === "incomplete") {
      return err(
        new RuleError("stage.qualification_incomplete", "Üç soru da yanıtlanmalı.", { missing: check.missing }),
      );
    }
    if (check.status === "not_qualified") {
      return err(
        new RuleError(
          "stage.not_qualified",
          "Üç sorunun üçü de 'evet' olmalı; değilse lead Kaybedildi (niteliksiz) olur.",
          {
            failed: check.failed,
          },
        ),
      );
    }
    target.qualificationAnswers = normalizeAnswers(req.qualificationAnswers ?? {});
  }

  return ok({
    from,
    to,
    events: [...skippedStages(from, to).map((s) => draft(s, "auto_fill")), target],
  });
}
