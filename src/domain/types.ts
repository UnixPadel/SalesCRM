// Arayüz kabuğunun tipleri. Satış verisinin tipleri `src/modules/sales-pipeline/api/dto.ts` içindedir (API sözleşmesi);
// eski JSON panonun Organization / Contact / Deal tipleri Faz 6d ile kaldırıldı.

/** ISO 4217 kodu (EUR, USD, TRY, AED…); liste `/reference.currencies`ten gelir. */
export type Currency = string;

/**
 * admin: her şey · rep: kendi müşterileri + havuz · viewer: salt okunur (muhasebe, fabrika, lojistik, gözlemci) ·
 * marketing: pazarlama / ajans, salt okunur, Raporlar kapalı, Yönetim salt okunur (server/roles.mjs).
 */
export type Role = "admin" | "rep" | "viewer" | "marketing";
/** Şirket kullanıcı tablosundaki kişi (ya da yerel Admin). */
export interface TeamMember {
  /** Kalıcı kimlik (kullanıcı tablosundaki KullaniciID); pipeline ataması bu değerle tutulur. */
  id: string;
  name: string;
  email: string;
  role: Role;
}
/** Oturumdaki kişi (şirket kullanıcı tablosu ya da yerel Admin hesabı). */
export interface User {
  /** Kalıcı kimlik: KullaniciID, yerel Admin için "admin". */
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Reklam kampanyası adlarını görebilir (sunucu CRM_CAMPAIGN_VIEWERS listesi; 2026-11-20). */
  seesCampaign?: boolean;
  /** İşlem günlüğünü (Yönetim > Loglar) görebilir (sunucu CRM_LOG_VIEWERS listesi; 2026-11-20). */
  seesLogs?: boolean;
  /** Mail gönderim raporunu (Yönetim > Mail Gönderimleri) görebilir (sunucu CRM_MAIL_STATS_VIEWERS; 2026-11-27). */
  seesMailStats?: boolean;
  /** Yerel Admin için false: kendi posta kutusu yok. */
  hasMailbox: boolean;
}
