import { RuleError, err, ok, type Result } from "../kernel";

/**
 * E-posta değer nesnesi. Normalleştirme: kırp, küçük harf. Bu biçim mükerrer kişi aramasında
 * kullanılır. Platform başına hash normalleştirmesi (Gmail nokta silme vb.) ayrı stratejidedir (Faz 4–5).
 */
export class Email {
  private constructor(readonly value: string) {}

  static normalize(raw: string): string {
    return String(raw ?? "")
      .trim()
      .toLowerCase();
  }

  static parse(raw: string): Result<Email, RuleError> {
    const v = Email.normalize(raw);
    // Pragmatik kural: tek @, boşluk yok, alan adında nokta var. RFC'nin tamamı değil; form girdisi için yeterli.
    if (!v || v.length > 254 || /\s/.test(v) || !/^[^@]+@[^@]+\.[^@]{2,}$/.test(v)) {
      return err(new RuleError("email.invalid", "Geçerli bir e-posta adresi girin.", { email: raw }));
    }
    return ok(new Email(v));
  }

  get domain(): string {
    return this.value.slice(this.value.indexOf("@") + 1);
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
