/** Kimlik üretimi tek yerden; testler öngörülebilir kimlik verir. */
export interface IdGenerator {
  next(): string;
}

/** UUID v4; `crypto.randomUUID` Node 19+ ve tarayıcıda global. */
export const uuidGenerator: IdGenerator = { next: () => crypto.randomUUID() };

/** Sıralı, okunur kimlikler: test çıktısı deterministik olur. */
export class SequentialIdGenerator implements IdGenerator {
  private n = 0;
  constructor(private readonly prefix = "id") {}
  next(): string {
    this.n += 1;
    return `${this.prefix}-${String(this.n).padStart(4, "0")}`;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (s: string): boolean => UUID.test(s);
