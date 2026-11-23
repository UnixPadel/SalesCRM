/**
 * Web Push (2026-11-23): program kapalıyken de tarayıcıya / telefona düşen bildirim. Zil (uygulama içi bildirim)
 * asıl kayıttır; push onun anlık kopyasıdır ve kaybolabilir (tarayıcı kapalı, izin geri alınmış). Her bildirim
 * satırı yazıldığında kişinin abone tarayıcılarına bir kez gönderilir, yeniden denenmez.
 *
 * Anahtarlar (VAPID) ortamdan gelir; yoksa push kapalıdır ve arayüz düğmeyi göstermez.
 */
import { RuleError, err, ok, type Clock, type IdGenerator, type Logger, type Result } from "../../shared/kernel";
import { isPushLang, pushText, type PushLang } from "./notificationText";
import type { Notification, PushSender } from "./notifications";

export interface PushSubscription {
  id: string;
  userId: string;
  /** Tarayıcının push servisindeki adresi. Gizlidir: bilen kişi o tarayıcıya ileti yollayabilir; loglanmaz. */
  endpoint: string;
  p256dh: string;
  auth: string;
  lang: PushLang;
  createdAt: Date;
  updatedAt: Date;
}

export interface PushSubscriptionStore {
  /** Aynı endpoint varsa sahibi, anahtarları ve dili güncellenir (aynı tarayıcıda başka kişi oturum açtı). */
  upsert(s: PushSubscription): Promise<void>;
  listForUser(userId: string): Promise<PushSubscription[]>;
  /** `userId` verilirse yalnız o kişinin satırı silinir. */
  removeByEndpoint(endpoint: string, userId?: string): Promise<void>;
}

/** Push servisine tek gönderim. "gone": abonelik artık geçersiz (404 / 410), satır silinir. Diğer hata fırlar. */
export interface PushTransport {
  send(sub: Pick<PushSubscription, "endpoint" | "p256dh" | "auth">, payload: string): Promise<"ok" | "gone">;
}

/**
 * Sunucu bu adrese istek atar; adresi kullanıcı verir. Yalnız bilinen tarayıcı push servislerine izin verilir ki
 * abonelik ucu iç ağdaki bir adrese istek attırmak için kullanılamasın.
 */
const PUSH_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  ".push.services.mozilla.com",
  ".notify.windows.com",
  ".push.apple.com",
];

export function isPushEndpoint(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((h) => (h.startsWith(".") ? host.endsWith(h) : host === h));
}

const isKey = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{8,200}=*$/.test(v);

export interface SubscribeInput {
  actor: { userId: string };
  endpoint: unknown;
  p256dh: unknown;
  auth: unknown;
  lang: unknown;
}

/** Abonelik uçlarının iş kuralı: doğrula, yaz, sil. */
export class PushSubscriptions {
  constructor(
    private readonly deps: {
      store: PushSubscriptionStore;
      clock: Clock;
      ids: IdGenerator;
      /** Boşsa push kapalı. */
      publicKey: string;
    },
  ) {}

  config(): { enabled: boolean; publicKey: string } {
    return { enabled: Boolean(this.deps.publicKey), publicKey: this.deps.publicKey };
  }

  async subscribe(input: SubscribeInput): Promise<Result<{ ok: true }, RuleError>> {
    if (!this.deps.publicKey) return err(new RuleError("push.disabled", "Anlık bildirimler bu sunucuda kapalı.", {}));
    if (!isPushEndpoint(input.endpoint) || !isKey(input.p256dh) || !isKey(input.auth)) {
      return err(new RuleError("push.invalid_subscription", "Bildirim aboneliği geçersiz.", {}));
    }
    const now = this.deps.clock.now();
    await this.deps.store.upsert({
      id: this.deps.ids.next(),
      userId: input.actor.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      lang: isPushLang(input.lang) ? input.lang : "tr",
      createdAt: now,
      updatedAt: now,
    });
    return ok({ ok: true });
  }

  async unsubscribe(actor: { userId: string }, endpoint: unknown): Promise<void> {
    if (typeof endpoint === "string" && endpoint) await this.deps.store.removeByEndpoint(endpoint, actor.userId);
  }
}

/** Bildirimi kişinin bütün abone tarayıcılarına yollar; geçersiz abonelikleri temizler. */
export class PushNotifier implements PushSender {
  constructor(private readonly deps: { store: PushSubscriptionStore; transport: PushTransport; logger: Logger }) {}

  async send(n: Notification): Promise<void> {
    const { store, transport, logger } = this.deps;
    const subs = await store.listForUser(n.userId);
    await Promise.all(
      subs.map(async (sub) => {
        const { title, body } = pushText(n, sub.lang);
        const payload = JSON.stringify({
          id: n.id,
          title,
          body,
          lang: sub.lang,
          // Göreli adres: service worker kendi kökenine göre açar.
          url: n.leadId ? `/#/lead/${n.leadId}` : "/",
        });
        try {
          if ((await transport.send(sub, payload)) === "gone") await store.removeByEndpoint(sub.endpoint);
        } catch (error) {
          logger.warn("push servisi hata verdi", { userId: n.userId, type: n.type, error });
        }
      }),
    );
  }
}

/** Testler ve bellek içi kurulum. */
export class InMemoryPushSubscriptionStore implements PushSubscriptionStore {
  rows: PushSubscription[] = [];
  async upsert(s: PushSubscription) {
    const i = this.rows.findIndex((r) => r.endpoint === s.endpoint);
    if (i >= 0) this.rows[i] = { ...s, id: this.rows[i]!.id, createdAt: this.rows[i]!.createdAt };
    else this.rows.push({ ...s });
  }
  async listForUser(userId: string) {
    return this.rows.filter((r) => r.userId === userId).map((r) => ({ ...r }));
  }
  async removeByEndpoint(endpoint: string, userId?: string) {
    this.rows = this.rows.filter((r) => !(r.endpoint === endpoint && (!userId || r.userId === userId)));
  }
}

export class RecordingPushTransport implements PushTransport {
  sent: { endpoint: string; payload: Record<string, unknown> }[] = [];
  /** Bu adresler "gone" döner. */
  gone = new Set<string>();
  async send(sub: { endpoint: string }, payload: string) {
    if (this.gone.has(sub.endpoint)) return "gone" as const;
    this.sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) as Record<string, unknown> });
    return "ok" as const;
  }
}
