/**
 * Görünüm para birimi ve kurlar (2026-11-20). Sağ üstteki seçiciyle kişi tutarları hangi para biriminde göreceğini
 * seçer (tarayıcıda saklanır, kişisel kolaylık). Kurlar `/reference.eurRates`ten gelir ("1 birim = X EUR", TCMB'den
 * otomatik güncellenir). Lead'in kendi çalışma para birimi varsa o lead'in tutarları onda gösterilir.
 *
 * Saklanan tutarlar hiç değişmez; çeviri yalnız ekranda, güncel kurla yapılır. Dil seçimi gibi modül düzeyinde
 * durur ki `money()` hook'suz okuyabilsin; değişince `useDisplayCurrency()` kullanan ekranlar yeniden çizilir.
 */
import { useSyncExternalStore } from "react";

const KEY = "unixcrm.v2.displayCurrency";

const read = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

let display = (read() ?? "EUR").toUpperCase();
let rates: Record<string, number> = { EUR: 1, USD: 0.92, GBP: 1.17, TRY: 0.027 };
let version = 0;
const listeners = new Set<() => void>();
const notify = () => {
  version += 1;
  for (const f of listeners) f();
};

export const displayCurrency = (): string => display;

export function setDisplayCurrency(code: string): void {
  const c = code.toUpperCase();
  if (c === display) return;
  display = c;
  try {
    localStorage.setItem(KEY, c);
  } catch {
    /* yalnız kişisel kolaylık */
  }
  notify();
}

/** `/reference` yüklenince çağrılır. */
export function setRates(next: Record<string, number>): void {
  rates = { ...next, EUR: 1 };
  notify();
}

/** `amount` (from) → to; kuru bilinmeyen para biriminde null. */
export function convert(amount: number, from: string, to: string): number | null {
  if (from === to) return amount;
  const a = rates[from];
  const b = rates[to];
  if (!a || !b) return null;
  return (amount * a) / b;
}

/** Ekran, görünüm para birimi ya da kurlar değişince yeniden çizilir; güncel görünüm para birimini döner. */
export function useDisplayCurrency(): string {
  useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => version,
  );
  return display;
}
