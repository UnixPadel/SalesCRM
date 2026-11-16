// Giriş deneme sınırı (ADR-0016: sunucu internete açık). Bellekte tutulur; tek instance çalışır.
//  - kullanıcı adı başına: pencere içinde en çok `maxPerUser` başarısız deneme (şifre tahmini)
//  - IP başına: pencere içinde en çok `maxPerIp` başarısız deneme (birçok kullanıcı adını tarama)
// Başarılı giriş o kullanıcı adının sayacını sıfırlar; IP sayacı penceresi dolana kadar kalır.

export function createLoginLimiter({ maxPerUser = 10, maxPerIp = 30, windowMs = 15 * 60_000, now = Date.now } = {}) {
  const users = new Map();
  const ips = new Map();

  const blockedFor = (map, key, max) => {
    if (!key) return 0;
    const e = map.get(key);
    if (!e) return 0;
    const t = now();
    if (e.resetAt <= t) {
      map.delete(key);
      return 0;
    }
    return e.count >= max ? Math.ceil((e.resetAt - t) / 1000) : 0;
  };
  const bump = (map, key) => {
    if (!key) return;
    const t = now();
    const e = map.get(key);
    if (!e || e.resetAt <= t) map.set(key, { count: 1, resetAt: t + windowMs });
    else e.count += 1;
  };

  return {
    /** 0: denenebilir; > 0: kaç saniye sonra yeniden denenebilir. */
    retryAfter(user, ip) {
      return Math.max(blockedFor(users, user, maxPerUser), blockedFor(ips, ip, maxPerIp));
    },
    fail(user, ip) {
      bump(users, user);
      bump(ips, ip);
    },
    succeed(user) {
      if (user) users.delete(user);
    },
    /** Süresi dolmuş kayıtları siler (bellek sınırlı kalsın). */
    sweep() {
      const t = now();
      for (const map of [users, ips]) for (const [k, e] of map) if (e.resetAt <= t) map.delete(k);
    },
    size: () => users.size + ips.size,
  };
}
