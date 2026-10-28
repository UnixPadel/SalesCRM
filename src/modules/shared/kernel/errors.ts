/**
 * Hata türleri (Genel plan kural 8): üç tür ayrı tiptir ve farklı ele alınır.
 *  - RuleError      iş kuralı ihlali → kullanıcıya gösterilir, yeniden denenmez
 *  - TransientError geçici (ağ, 429, 5xx, zaman aşımı) → yeniden denenir
 *  - PermanentError kalıcı (400, doğrulama, eşleme yok) → dead letter / admin
 */
export type ErrorKind = "rule" | "transient" | "permanent";

export abstract class AppError extends Error {
  abstract readonly kind: ErrorKind;
  /** Makine tarafından okunur kod; arayüz çevirisi ve log filtresi bu koda bakar. */
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  protected constructor(code: string, message: string, details: Record<string, unknown> = {}, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class RuleError extends AppError {
  readonly kind = "rule" as const;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(code, message, details);
  }
}

export class TransientError extends AppError {
  readonly kind = "transient" as const;
  constructor(code: string, message: string, details: Record<string, unknown> = {}, cause?: unknown) {
    super(code, message, details, cause);
  }
}

export class PermanentError extends AppError {
  readonly kind = "permanent" as const;
  constructor(code: string, message: string, details: Record<string, unknown> = {}, cause?: unknown) {
    super(code, message, details, cause);
  }
}

/** Bulunamayan kayıt: iş kuralı hatasının özel hali, API'de 404 olur. */
export class NotFoundError extends RuleError {
  constructor(entity: string, id: string) {
    super("not_found", `${entity} bulunamadı: ${id}`, { entity, id });
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
