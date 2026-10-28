/**
 * Logger (Genel plan kural 9): loglarda lead kimliği ve korelasyon kimliği olur; e-posta ve
 * telefon maskelenir. Maskeleme burada, tek yerde yapılır; çağıran taraf düşünmek zorunda kalmaz.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Her satıra eklenecek sabit alanlarla (ör. correlationId) yeni logger. */
  child(fields: LogFields): Logger;
}

const SENSITIVE_KEY = /(email|e_mail|eposta|phone|telefon|tel|password|sifre|secret|token|authorization|cookie)/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `${phone.startsWith("+") ? "+" : ""}***${digits.slice(-2)}`;
}

/** Metin içindeki e-posta ve telefon kalıplarını maskeler. */
export function maskText(text: string): string {
  return text.replace(EMAIL, (m) => maskEmail(m)).replace(PHONE, (m) => maskPhone(m));
}

/** Alan adına göre tam maskeleme, değere göre kalıp maskeleme; iç içe nesnelerde özyinelemeli. */
export function maskFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = typeof v === "string" ? (v.includes("@") ? maskEmail(v) : maskPhone(v)) : v === undefined ? v : "***";
    } else if (typeof v === "string") {
      out[k] = maskText(v);
    } else if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Error)) {
      out[k] = maskFields(v as LogFields);
    } else if (v instanceof Error) {
      out[k] = { name: v.name, message: maskText(v.message), code: (v as { code?: string }).code };
    } else {
      out[k] = v;
    }
  }
  return out;
}

export type LogSink = (line: { level: LogLevel; msg: string; time: string } & LogFields) => void;

const consoleSink: LogSink = (line) => {
  const text = JSON.stringify(line);
  if (line.level === "error") console.error(text);
  else if (line.level === "warn") console.warn(text);
  else console.log(text);
};

export function createLogger(
  base: LogFields = {},
  sink: LogSink = consoleSink,
  now: () => Date = () => new Date(),
): Logger {
  const emit = (level: LogLevel, msg: string, fields: LogFields = {}) =>
    sink({ level, msg: maskText(msg), time: now().toISOString(), ...maskFields({ ...base, ...fields }) });
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (fields) => createLogger({ ...base, ...fields }, sink, now),
  };
}

export const silentLogger: Logger = createLogger({}, () => {});
