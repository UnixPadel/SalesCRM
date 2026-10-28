import { RuleError } from "./errors";
import { err, ok, type Result } from "./result";

/**
 * Para: tutar ve ISO 4217 kodu birlikte (Genel plan, teknik not 3). Tutar kuruş hassasiyetinde
 * ondalık sayı olarak tutulur; toplama ve kur çevirisi bu nesnenin işi değildir.
 */
export class Money {
  private constructor(
    readonly amount: number,
    readonly currency: string,
  ) {}

  /** `amount` ≥ 0, en fazla 2 ondalık; `currency` üç büyük harf. */
  static create(amount: number, currency: string): Result<Money, RuleError> {
    if (typeof amount !== "number" || !Number.isFinite(amount)) {
      return err(new RuleError("money.amount_invalid", "Tutar sayı olmalı.", { amount }));
    }
    if (amount < 0) return err(new RuleError("money.amount_negative", "Tutar negatif olamaz.", { amount }));
    const rounded = Math.round(amount * 100) / 100;
    const cur = String(currency ?? "")
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) {
      return err(new RuleError("money.currency_invalid", "Para birimi ISO 4217 kodu olmalı (ör. EUR).", { currency }));
    }
    return ok(new Money(rounded, cur));
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }

  toJSON(): { amount: number; currency: string } {
    return { amount: this.amount, currency: this.currency };
  }
}
