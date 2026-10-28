import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { RuleError, err, ok, type Result } from "../kernel";

/**
 * Telefon değer nesnesi: tek biçim E.164 (Genel plan, teknik not 2). Ülke kodu olmayan girdi,
 * verilen varsayılan ülkeye göre çözülür (lead'in ülkesi). Platforma özel biçim (Meta: yalnız
 * rakam) gönderim anında üretilir; burada tutulmaz.
 */
export class PhoneNumber {
  private constructor(
    /** "+905321234567" */
    readonly e164: string,
    /** ISO-3166 alpha-2, bilinmiyorsa "" */
    readonly country: string,
  ) {}

  static parse(raw: string, defaultCountry?: string): Result<PhoneNumber, RuleError> {
    const text = String(raw ?? "").trim();
    if (!text) return err(new RuleError("phone.empty", "Telefon numarası girin.", {}));
    const dc =
      defaultCountry && /^[A-Za-z]{2}$/.test(defaultCountry)
        ? (defaultCountry.toUpperCase() as CountryCode)
        : undefined;
    let parsed;
    try {
      parsed = parsePhoneNumberFromString(text, dc);
    } catch {
      parsed = undefined;
    }
    if (!parsed || !parsed.isPossible()) {
      return err(
        new RuleError("phone.invalid", "Telefon numarası uluslararası biçimde olmalı (ör. +90 532 123 45 67).", {
          phone: raw,
          defaultCountry: dc ?? null,
        }),
      );
    }
    return ok(new PhoneNumber(parsed.number, parsed.country ?? ""));
  }

  /** Meta CAPI biçimi: ülke kodu dahil yalnız rakam. */
  get digits(): string {
    return this.e164.replace(/\D/g, "");
  }

  equals(other: PhoneNumber): boolean {
    return this.e164 === other.e164;
  }

  toString(): string {
    return this.e164;
  }
}
