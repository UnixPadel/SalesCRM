import { Email } from "../../shared/normalization";
import type { RecipientKind, SentMessage, StoredMessage, StoredRecipient } from "./ports";

/** Tekilleştirme anahtarı: Message-ID; yoksa klasör sürümü + UID (aynı klasörde tekil). */
export function messageKey(m: Pick<SentMessage, "uid" | "messageId">, uidValidity: string): string {
  const id = (m.messageId ?? "").trim();
  return id || `uid:${uidValidity}:${m.uid}`;
}

/** Alıcılar normalleştirilir; aynı adres birden çok alanda geçerse ilk alan (to > cc > bcc) sayılır. */
export function recipientsOf(m: Pick<SentMessage, "to" | "cc" | "bcc">): StoredRecipient[] {
  const seen = new Map<string, RecipientKind>();
  const add = (list: readonly string[], kind: RecipientKind) => {
    for (const raw of list) {
      const address = Email.normalize(raw);
      if (address.includes("@") && !seen.has(address)) seen.set(address, kind);
    }
  };
  add(m.to, "to");
  add(m.cc, "cc");
  add(m.bcc, "bcc");
  return [...seen].map(([address, kind]) => ({ address, kind }));
}

export function toStoredMessage(m: SentMessage, uidValidity: string, fallbackDate: Date): StoredMessage {
  return {
    key: messageKey(m, uidValidity),
    sentAt: m.sentAt && !Number.isNaN(m.sentAt.getTime()) ? m.sentAt : fallbackDate,
    uid: m.uid,
    recipients: recipientsOf(m),
  };
}

/** Şirket içi adres (iç yazışma; raporda ayrı etiketlenir). */
export const isInternalAddress = (address: string, domain: string): boolean =>
  Email.normalize(address).endsWith("@" + domain.toLowerCase());
