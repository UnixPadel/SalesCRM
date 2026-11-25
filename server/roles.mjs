// Oturum rolleri ve rol bazlı izinler (sunucu tarafı; arayüz yalnız gizler, karar burada).
//
//   admin      her şeyi görür ve yapar
//   rep        kendi müşterileri + havuz (satış pipeline'ı kendi kurallarıyla)
//   viewer     görüntüleyici (muhasebe, fabrika, lojistik, gözlemci): her şeyi görür, hiçbir şeyi değiştiremez
//   marketing  pazarlama / ajans (ör. MarcaDM): lead'leri salt okunur görür, Raporlar kapalı, Yönetim salt okunur
//
// Şirket kullanıcı tablosunun YetkiTuru sütunu başka bir programa ait sabit bir MySQL ENUM'udur; yeni değer
// eklenemez. Pazarlama kullanıcısı tabloya "Gozlemci" olarak eklenir ve CRM_MARKETING_USERS listesiyle tanınır
// (virgülle: kullanıcı adı, e-posta ya da KullaniciID; büyük/küçük harf fark etmez). Listedeki kişi tablodaki rolü
// ne olursa olsun pazarlama rolüyle girer: liste yalnız yetki daraltır.

/** @param {Record<string, string | undefined>} env */
export function marketingUsers(env = process.env) {
  return new Set(
    String(env.CRM_MARKETING_USERS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Girişte belirlenen rol. `baseRole` kullanıcı tablosundan (admin | rep | viewer); `ids` girişte bilinen kimlikler.
 * @param {string} baseRole
 * @param {{ id?: unknown; login?: unknown; email?: unknown }} ids
 * @param {Set<string>} marketing
 */
export function sessionRole(baseRole, ids, marketing) {
  const keys = [ids.id, ids.login, ids.email]
    .map((v) =>
      String(v ?? "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
  return keys.some((k) => marketing.has(k)) ? "marketing" : baseRole;
}

/**
 * Reklam kampanyası adlarını (Lead listesi Kampanya sütunu, rapor kampanya süzgeci) görebilenler. Rolden bağımsız,
 * kişi bazında: CRM_CAMPAIGN_VIEWERS (virgülle: kullanıcı adı, e-posta ya da KullaniciID; büyük/küçük harf fark
 * etmez). Değişken hiç tanımlı değilse varsayılan liste geçerlidir (2026-11-20 karar).
 * @param {Record<string, string | undefined>} env
 */
export function campaignViewers(env = process.env) {
  const raw = env.CRM_CAMPAIGN_VIEWERS ?? "admin,eraymarcadm,elshan.rasulov";
  return new Set(
    String(raw)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * @param {{ id?: unknown; login?: unknown; email?: unknown }} ids
 * @param {Set<string>} viewers
 */
export function seesCampaign(ids, viewers) {
  return [ids.id, ids.login, ids.email]
    .map((v) =>
      String(v ?? "")
        .trim()
        .toLowerCase(),
    )
    .some((k) => k && viewers.has(k));
}

/**
 * İşlem günlüğünü (Yönetim > Loglar: hangi satışçı hangi lead'de ne yaptı) görebilenler. Rolden bağımsız, kişi
 * bazında: CRM_LOG_VIEWERS (virgülle: kullanıcı adı, e-posta ya da KullaniciID; büyük/küçük harf fark etmez).
 * Değişken hiç tanımlı değilse varsayılan liste geçerlidir (2026-11-20 karar; Admin hesabı 2026-11-23 eklendi:
 * "admin" hem yerel Admin hesabıyla hem tablodaki admin kullanıcısıyla eşleşir). Eşleşme `seesCampaign` ile aynıdır.
 * @param {Record<string, string | undefined>} env
 */
export function logViewers(env = process.env) {
  const raw = env.CRM_LOG_VIEWERS ?? "admin,elshan.rasulov";
  return new Set(
    String(raw)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Oturumun kampanya adlarını / işlem günlüğünü görüp görmediği (2026-11-25): yönetici rolü her zaman görür; diğer
 * roller yalnız ilgili listedeyse (`campaignViewers` / `logViewers`). Liste yalnız ek kişi tanımlar.
 * @param {string | undefined} role
 * @param {{ id?: unknown; login?: unknown; email?: unknown }} ids
 * @param {Set<string>} viewers
 */
export const sessionSees = (role, ids, viewers) => role === "admin" || seesCampaign(ids, viewers);

/** Hiçbir lead / kişi / aktivite verisini değiştiremeyen roller. */
export const isReadOnlyRole = (role) => role === "viewer" || role === "marketing";
/** Yönetim panelini okuyabilir (GET). */
export const canReadAdmin = (role) => role === "admin" || role === "marketing";
/** Yönetim panelinde değişiklik yapabilir. */
export const canWriteAdmin = (role) => role === "admin";
/** Raporlar sekmesi ve /api/pipeline/reports*. */
export const canSeeReports = (role) => role !== "marketing";
/** Bütün kullanıcı dizini ve form tablosu durumu gibi okuma uçları (yönetici ve salt okunur roller). */
export const canReadDirectory = (role) => role === "admin" || isReadOnlyRole(role);

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** Express ara katmanı: /api/admin. Okuma admin + pazarlama; yazma yalnız admin. */
export function adminAccess(req, res, next) {
  const role = req.session?.role;
  const ok = SAFE.has(req.method) ? canReadAdmin(role) : canWriteAdmin(role);
  if (ok) return next();
  return res
    .status(403)
    .json(
      role === "marketing"
        ? { error: "Yönetim panelini yalnız görüntüleyebilirsiniz.", code: "read_only" }
        : { error: "Yalnız yönetici.", code: "admin_only" },
    );
}

/** Express ara katmanı: /api/pipeline/reports*. */
export function reportsAccess(req, res, next) {
  if (canSeeReports(req.session?.role)) return next();
  return res.status(403).json({ error: "Raporlara erişiminiz yok.", code: "reports_forbidden" });
}
