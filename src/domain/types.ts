// Arayüz kabuğunun tipleri. Satış verisinin tipleri `src/modules/sales-pipeline/api/dto.ts` içindedir (API sözleşmesi);
// eski JSON panonun Organization / Contact / Deal tipleri Faz 6d ile kaldırıldı.

export type Currency = "EUR" | "USD" | "GBP" | "TRY";

/** admin: her şey · rep: kendi müşterileri + havuz · viewer: salt okunur (muhasebe, fabrika, lojistik, gözlemci). */
export type Role = "admin" | "rep" | "viewer";
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
  /** Yerel Admin için false: kendi posta kutusu yok. */
  hasMailbox: boolean;
}
