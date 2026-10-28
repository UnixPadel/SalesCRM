/**
 * "Nitelikli" ölçütü sabittir: üç sorunun üçü de "evet" (Genel plan). Soru metinleri satış onayına
 * kadar VARSAYILAN (docs/decisions.md 5); kodlar sabit kalır, metin arayüz sözlüğünden gelir.
 */
export const QUALIFICATION_QUESTIONS = ["budget_approved", "site_known", "install_within_12m"] as const;
export type QualificationQuestion = (typeof QUALIFICATION_QUESTIONS)[number];
export type QualificationAnswers = Record<QualificationQuestion, boolean>;

export type QualificationCheck =
  | { status: "qualified" }
  | { status: "incomplete"; missing: QualificationQuestion[] }
  | { status: "not_qualified"; failed: QualificationQuestion[] };

export function checkQualification(answers: Partial<Record<string, boolean>> | null | undefined): QualificationCheck {
  const a = answers ?? {};
  const missing = QUALIFICATION_QUESTIONS.filter((q) => typeof a[q] !== "boolean");
  if (missing.length) return { status: "incomplete", missing };
  const failed = QUALIFICATION_QUESTIONS.filter((q) => a[q] === false);
  return failed.length ? { status: "not_qualified", failed } : { status: "qualified" };
}

/** Yalnız tanımlı soruları, boolean olarak tutar; fazladan alan atılır. */
export function normalizeAnswers(answers: Partial<Record<string, boolean>>): QualificationAnswers {
  return Object.fromEntries(QUALIFICATION_QUESTIONS.map((q) => [q, answers[q] === true])) as QualificationAnswers;
}
