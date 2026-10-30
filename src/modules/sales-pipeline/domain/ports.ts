import type { TerritoryRule } from "./assignment";
import type { DomainEvent } from "./events";
import type { Lead, LeadAttribution, LeadConsent, Person, StageEvent } from "./lead";
import type { StageCode } from "./stage";

/** Portlar (Genel plan kural 2): uygulamalar infrastructure katmanında, testler sahte uygulamayla. */

export interface LeadListFilter {
  /** Satışçı görünürlüğü: bu kullanıcıya atanmış + havuz; undefined = hepsi (admin). */
  visibleTo?: { userId: string; countries: readonly string[] } | undefined;
  stage?: StageCode | undefined;
  includeTest?: boolean | undefined;
  search?: string | undefined;
  limit?: number | undefined;
}

export interface LeadRepository {
  findById(id: string): Promise<Lead | undefined>;
  findByPlatformId(source: string, platformLeadId: string): Promise<Lead | undefined>;
  list(filter: LeadListFilter): Promise<Lead[]>;
  insert(lead: Lead): Promise<void>;
  updateStage(id: string, stage: StageCode, updatedAt: Date): Promise<void>;
  updateAssignee(id: string, userId: string | null, updatedAt: Date): Promise<void>;
  /** Tıklama kimlikleri (1:1); lead ile aynı transaction'da yazılır. */
  saveAttribution(leadId: string, attribution: LeadAttribution): Promise<void>;
  findAttribution(leadId: string): Promise<LeadAttribution | undefined>;
  /** Onay kayıtları (1:N, yalnız ekleme); lead ile aynı transaction'da yazılır. */
  saveConsents(consents: readonly LeadConsent[]): Promise<void>;
  findConsents(leadId: string): Promise<LeadConsent[]>;
}

export interface PersonRepository {
  findByEmailOrPhone(emailNormalized: string | null, phoneE164: string | null): Promise<Person | undefined>;
  insert(person: Person): Promise<void>;
}

export interface StageEventRepository {
  listByLead(leadId: string): Promise<StageEvent[]>;
  /** Kimlik listesiyle (giden olay dağıtıcısı için); bulunamayanlar atlanır. */
  findByIds(ids: readonly string[]): Promise<StageEvent[]>;
  nextSequence(leadId: string): Promise<number>;
  insert(event: StageEvent): Promise<void>;
  markUndone(eventIds: readonly string[], undoneAt: Date, byUserId: string): Promise<void>;
}

export interface OutboxWriter {
  /** Aşama olayı + platform başına tek satır; aynı transaction'da çağrılır. */
  enqueue(stageEventId: string, provider: string, notBefore: Date): Promise<void>;
  /** Geri alınan olayların satırları `skipped` olur; dağıtıcı onları hiç göndermez. */
  skipForEvents(stageEventIds: readonly string[], reason: string): Promise<void>;
}

export interface TerritoryRuleSource {
  all(): Promise<TerritoryRule[]>;
}

export interface LostReasonSource {
  activeCodes(): Promise<string[]>;
}

export interface Repositories {
  leads: LeadRepository;
  persons: PersonRepository;
  stageEvents: StageEventRepository;
  outbox: OutboxWriter;
  territories: TerritoryRuleSource;
  lostReasons: LostReasonSource;
}

/** Tek transaction: fn içindeki tüm yazmalar birlikte ya da hiç. */
export interface UnitOfWork {
  run<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
}

/** Hangi platform adaptörlerinin etkin olduğu (config; Faz 1'de boş). */
export interface PlatformRegistry {
  enabledProviders(): readonly string[];
}

export interface DomainEventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}
