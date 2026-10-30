/**
 * Google Data Manager API ayarları (ADR-0012). Secret'lar adıyla okunur (ADR-0004); bootstrap `readSecret`'ı geçirir.
 * Müşteri kimliği ve yönetici hesabı integration_settings'te (google/customer_id, google/login_customer_id);
 * ortam değişkeni yedektir.
 */
import type { GoogleEventSource } from "../../builders/google";

export interface GoogleDataManagerConfig {
  /** Servis hesabı anahtarı: JSON metni ya da base64 JSON. Boşsa gönderici kurulmaz. */
  serviceAccountKey: string;
  customerId: string;
  loginCustomerId: string;
  /** Staging: validateOnly=true; canlıda boş. */
  validateOnly: boolean;
  clickWindowDays: number;
  userDataWindowDays: number;
  eventSource: GoogleEventSource;
  timeZone: string;
  /** Google'a gidecek lead kaynakları; Meta formu lead'i varsayılanda yok (ADR-0012 karar 3). */
  sendSources: string[];
}

export const GOOGLE_DM_SECRET_NAMES = { serviceAccountKey: "GOOGLE_DM_SERVICE_ACCOUNT_KEY" } as const;

const EVENT_SOURCES = new Set<GoogleEventSource>(["WEB", "APP", "IN_STORE", "PHONE", "MESSAGE", "OTHER"]);

const num = (v: string, fallback: number): number => {
  const n = Number(v);
  return v !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
};

export function googleDataManagerConfig(read: (name: string) => string): GoogleDataManagerConfig {
  const source = read("GOOGLE_EVENT_SOURCE").trim().toUpperCase() as GoogleEventSource;
  const sources = read("GOOGLE_SEND_SOURCES")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    serviceAccountKey: read(GOOGLE_DM_SECRET_NAMES.serviceAccountKey).trim(),
    customerId: read("GOOGLE_ADS_CUSTOMER_ID").replace(/-/g, "").trim(),
    loginCustomerId: read("GOOGLE_ADS_LOGIN_CUSTOMER_ID").replace(/-/g, "").trim(),
    validateOnly: ["1", "true"].includes(read("GOOGLE_DM_VALIDATE_ONLY").trim().toLowerCase()),
    clickWindowDays: num(read("GOOGLE_CLICK_WINDOW_DAYS"), 90),
    userDataWindowDays: num(read("GOOGLE_USER_DATA_WINDOW_DAYS"), 63),
    eventSource: EVENT_SOURCES.has(source) ? source : "WEB",
    timeZone: read("GOOGLE_EVENT_TIMEZONE").trim() || "Europe/Istanbul",
    sendSources: sources.length ? sources : ["google_form", "web_form"],
  };
}
