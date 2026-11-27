import { ImapFlow, type FetchMessageObject, type MessageAddressObject } from "imapflow";
import type { SentFolder, SentMessage, SentSource } from "../domain";

/**
 * IMAP Gönderilmiş klasörü (imapflow). Klasör EXAMINE ile salt-okunur açılır; yalnız ENVELOPE ve INTERNALDATE
 * okunur (gövde indirilmez, okundu bayrağı değişmez). Şifre loglanmaz; hata metni sunucu adı içermez.
 */
export interface ImapCredentials {
  user: string;
  pass: string;
}

export interface ImapSentSourceOptions {
  host: string;
  port: number;
  /** Hesap → giriş bilgisi; tanımlı değilse null (hesap atlanır). */
  credentials(mailbox: string): ImapCredentials | null;
}

/** Klasör adı: özel kullanım bayrağı (\Sent), yoksa adı "Sent" / "Gönderilmiş" olan klasör. */
export function pickSentFolder(boxes: readonly { path: string; specialUse?: string | undefined }[]): string | null {
  const flagged = boxes.find((b) => b.specialUse === "\\Sent");
  if (flagged) return flagged.path;
  return boxes.find((b) => /(^|[./])(sent|gönderil)/i.test(b.path))?.path ?? null;
}

const addresses = (list: readonly MessageAddressObject[] | undefined): string[] =>
  (list ?? []).map((a) => a.address ?? "").filter(Boolean);

export function toSentMessage(m: Pick<FetchMessageObject, "uid" | "envelope" | "internalDate">): SentMessage {
  const env = m.envelope;
  const raw = env?.date ?? m.internalDate;
  const at = raw ? new Date(raw) : null;
  return {
    uid: m.uid,
    messageId: env?.messageId ?? null,
    sentAt: at && !Number.isNaN(at.getTime()) ? at : null,
    to: addresses(env?.to),
    cc: addresses(env?.cc),
    bcc: addresses(env?.bcc),
  };
}

/** Okunur hata kodu: arayüz çevirir; bilinmeyen hata kendi metniyle döner. */
export function imapErrorCode(e: unknown): string {
  const x = (e ?? {}) as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string };
  if (x.authenticationFailed) return "auth_failed";
  if (x.code && ["ETIMEOUT", "ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "EHOSTUNREACH"].includes(x.code))
    return "unreachable";
  return x.responseText || x.message || "unknown";
}

const FIELDS = { uid: true, envelope: true, internalDate: true } as const;

export function createImapSentSource(opts: ImapSentSourceOptions): SentSource {
  return {
    configured: (mailbox) => opts.credentials(mailbox) !== null,
    async open(mailbox, fn) {
      const creds = opts.credentials(mailbox);
      if (!creds) throw new Error("no_credentials");
      const client = new ImapFlow({
        host: opts.host,
        port: opts.port,
        secure: true,
        auth: { user: creds.user, pass: creds.pass },
        logger: false,
        emitLogs: false,
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 120_000,
      });
      // Bağlantı kopması 'error' olayıyla da gelir; dinleyici yoksa süreç çöker.
      client.on("error", () => undefined);
      try {
        await client.connect();
      } catch (e) {
        throw new Error(imapErrorCode(e), { cause: e });
      }
      try {
        const path = pickSentFolder(await client.list());
        if (!path) throw new Error("no_sent_folder");
        const lock = await client.getMailboxLock(path, { readOnly: true });
        try {
          const box = client.mailbox;
          const uidValidity = box ? String(box.uidValidity) : "";
          const collect = async (range: string | number[]): Promise<SentMessage[]> => {
            const out: SentMessage[] = [];
            for await (const m of client.fetch(range, FIELDS, { uid: true })) out.push(toSentMessage(m));
            return out;
          };
          const folder: SentFolder = {
            path,
            uidValidity,
            fromUid: (uid) => (box && box.exists ? collect(`${uid}:*`) : Promise.resolve([])),
            async since(at) {
              const uids = await client.search({ since: at }, { uid: true });
              return uids && uids.length ? collect(uids) : [];
            },
          };
          return await fn(folder);
        } finally {
          lock.release();
        }
      } catch (e) {
        if (e instanceof Error && ["no_sent_folder", "auth_failed", "unreachable"].includes(e.message)) throw e;
        throw new Error(imapErrorCode(e), { cause: e });
      } finally {
        await client.logout().catch(() => undefined);
      }
    },
  };
}
