import { RuleError, err, ok, type Result } from "../../shared/kernel";

/**
 * Aşama kodları sabittir (Genel plan, Aşama motoru). Görünen adlar `stage_definitions` tablosunda;
 * kod burada, sıra ve kurallar koddadır çünkü geçiş matrisi testlidir ve tablodan değişmemelidir.
 */
export const STAGE_CODES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"] as const;
export type StageCode = (typeof STAGE_CODES)[number];

export const TERMINAL_STAGES: readonly StageCode[] = ["WON", "LOST"];

export const isStageCode = (v: unknown): v is StageCode =>
  typeof v === "string" && (STAGE_CODES as readonly string[]).includes(v);

export function parseStageCode(v: unknown): Result<StageCode, RuleError> {
  return isStageCode(v) ? ok(v) : err(new RuleError("stage.unknown", "Bilinmeyen aşama kodu.", { stage: v }));
}

export const stageIndex = (code: StageCode): number => STAGE_CODES.indexOf(code);
export const isTerminal = (code: StageCode): boolean => TERMINAL_STAGES.includes(code);

/**
 * İzinli sonraki aşamalar: yalnız ileri. Terminal aşamadan çıkış yok. LOST her açık aşamadan gidilir.
 * Arayüz bu listeyi API'den okur; kuralı kendi içinde tekrar yazmaz (Genel plan, arayüz kuralları).
 */
export function allowedTransitions(from: StageCode): readonly StageCode[] {
  if (isTerminal(from)) return [];
  const i = stageIndex(from);
  return STAGE_CODES.filter((_, j) => j > i);
}

export const canTransition = (from: StageCode, to: StageCode): boolean => allowedTransitions(from).includes(to);

/**
 * Atlanan ara aşamalar (hedef hariç, mevcut hariç). LOST'a geçişte ara aşama yazılmaz: kaybedilen
 * lead "nitelikli" ya da "teklif" aşamasından geçmiş sayılmaz.
 */
export function skippedStages(from: StageCode, to: StageCode): readonly StageCode[] {
  if (to === "LOST" || !canTransition(from, to)) return [];
  return STAGE_CODES.slice(stageIndex(from) + 1, stageIndex(to));
}
