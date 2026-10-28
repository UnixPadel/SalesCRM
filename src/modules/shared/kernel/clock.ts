/** Zaman tek kaynaktan okunur; testler sahte saatle çalışır (Genel plan, test katmanları). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Sabit ya da elle ilerletilen saat. */
export class FixedClock implements Clock {
  private current: Date;
  constructor(start: Date | string = "2026-01-01T09:00:00.000Z") {
    this.current = new Date(start);
  }
  now(): Date {
    return new Date(this.current);
  }
  set(to: Date | string): void {
    this.current = new Date(to);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
