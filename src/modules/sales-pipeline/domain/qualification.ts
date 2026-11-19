import { Money, RuleError, err, ok, type Result } from "../../shared/kernel";

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

/**
 * Nitelikli ayrıntıları (2026-11-19): her "evet" cevabının arkasındaki bilgi. Bütçe tutarı ve para birimi, proje
 * yeri, kurulum zamanı (kaç ay içinde ya da hangi ay; tam olarak biri).
 */
export interface QualificationDetails {
  budgetAmount: number;
  budgetCurrency: string;
  site: string;
  /** 1–12; ay belliyse null. */
  installMonths: number | null;
  /** "YYYY-MM"; ay sayısı verildiyse null. */
  installMonth: string | null;
}

export const QUALIFICATION_SITE_MAX = 200;
export type QualificationDetailField = "budget" | "site" | "install";

/** Ham girdiyi doğrular; eksik ya da geçersiz alanlar `details.missing` içinde döner. */
export function parseQualificationDetails(raw: unknown): Result<QualificationDetails, RuleError> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const missing: QualificationDetailField[] = [];

  const amount = typeof r["budgetAmount"] === "number" ? r["budgetAmount"] : NaN;
  const money = Money.create(amount, String(r["budgetCurrency"] ?? ""));
  if (!money.ok || money.value.amount <= 0) missing.push("budget");

  const site = typeof r["site"] === "string" ? r["site"].trim() : "";
  if (!site) missing.push("site");

  const months = r["installMonths"];
  const month = typeof r["installMonth"] === "string" ? r["installMonth"].trim() : "";
  const monthsOk = typeof months === "number" && Number.isInteger(months) && months >= 1 && months <= 12;
  const monthOk = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const hasMonths = months !== null && months !== undefined && months !== "";
  // Tam olarak biri: ay sayısı ya da belli ay.
  if (hasMonths ? !monthsOk || month !== "" : !monthOk) missing.push("install");

  if (missing.length || !money.ok) {
    return err(
      new RuleError("stage.qualification_details", "Bütçe, proje yeri ve kurulum zamanı yazılmalı.", { missing }),
    );
  }
  return ok({
    budgetAmount: money.value.amount,
    budgetCurrency: money.value.currency,
    site: site.slice(0, QUALIFICATION_SITE_MAX),
    installMonths: hasMonths ? (months as number) : null,
    installMonth: hasMonths ? null : month,
  });
}
