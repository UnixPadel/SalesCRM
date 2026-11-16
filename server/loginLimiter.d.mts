// Tip bildirimi: server/loginLimiter.mjs (testler bu bildirimi kullanır).
export interface LoginLimiter {
  /** 0: denenebilir; > 0: kaç saniye sonra yeniden denenebilir. */
  retryAfter(user: string, ip: string): number;
  fail(user: string, ip: string): void;
  succeed(user: string): void;
  sweep(): void;
  size(): number;
}
export function createLoginLimiter(opts?: {
  maxPerUser?: number;
  maxPerIp?: number;
  windowMs?: number;
  now?: () => number;
}): LoginLimiter;
