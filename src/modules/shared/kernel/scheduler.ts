/**
 * Kütüphanesiz zamanlayıcı (ADR-0003'ün ikinci seçeneği): aynı süreçte, aralıklı işler.
 * Bir iş bitmeden yeniden başlamaz; hata loglanır, zamanlayıcıyı durdurmaz. Birden fazla instance
 * varsa çift işlemeyi iş kendisi engeller (inbox satırları `FOR UPDATE SKIP LOCKED` ile alınır).
 */
import type { Logger } from "./logger";

export interface ScheduledJob {
  name: string;
  everyMs: number;
  /** true: start() çağrılır çağrılmaz bir kez koşar (ilk aralığı beklemez). */
  runAtStart?: boolean;
  run(): Promise<void>;
}

export interface Scheduler {
  start(): void;
  stop(): void;
  /** Bir işi elle tetikler (testler, CLI). Çalışıyorsa bitmesini bekler ve yeniden koşmaz. */
  runNow(name: string): Promise<void>;
  running(): boolean;
}

export function createScheduler(jobs: readonly ScheduledJob[], logger: Logger): Scheduler {
  const timers = new Map<string, NodeJS.Timeout>();
  const inFlight = new Map<string, Promise<void>>();

  const tick = (job: ScheduledJob): Promise<void> => {
    const current = inFlight.get(job.name);
    if (current) return current;
    const p = job
      .run()
      .catch((e: unknown) => logger.error("zamanlanmış iş hata verdi", { job: job.name, error: e }))
      .finally(() => inFlight.delete(job.name));
    inFlight.set(job.name, p);
    return p;
  };

  return {
    start() {
      for (const job of jobs) {
        if (timers.has(job.name)) continue;
        const t = setInterval(() => void tick(job), job.everyMs);
        t.unref?.();
        timers.set(job.name, t);
        if (job.runAtStart) void tick(job);
      }
      logger.info("zamanlayıcı başladı", { jobs: jobs.map((j) => `${j.name}@${j.everyMs}ms`) });
    },
    stop() {
      for (const t of timers.values()) clearInterval(t);
      timers.clear();
    },
    runNow(name) {
      const job = jobs.find((j) => j.name === name);
      if (!job) return Promise.reject(new Error(`iş yok: ${name}`));
      return tick(job);
    },
    running: () => timers.size > 0,
  };
}
