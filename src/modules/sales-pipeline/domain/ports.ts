import type { Activity } from "./activity";
import type { TerritoryRule } from "./assignment";
import type { DomainEvent } from "./events";
import type { Lead, LeadAttribution, LeadConsent, Person, StageEvent } from "./lead";
import type { LeadFields } from "./opportunity";
import type { StageCode } from "./stage";

/** Portlar (Genel plan kural 2): uygulamalar infrastructure katmanında, testler sahte uygulamayla. */

export interface LeadListFilter {
  /** Satışçı görünürlüğü: bu kullanıcıya atanmış + havuz; undefined = hepsi (admin). */
  visibleTo?: { userId: string; countries: readonly string[] } | undefined;
  stage?: StageCode | undefined;
  /** Sorumlu: kullanıcı kimliği; null = ortak havuz; undefined = hepsi. */
  owner?: string | null | undefined;
  /** ISO 3166-1 alpha-2. */
  country?: string | undefined;
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
  /** Fırsat ve serbest metin alanları (Faz 6b); yalnız verilen anahtarlar değişir. */
  updateFields(id: string, fields: Partial<LeadFields>, updatedAt: Date): Promise<void>;
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
  /** Birden çok lead'in tüm olayları (pano özeti: aşamaya giriş anı, son tutar); lead ve sıra düzeninde. */
  listByLeads(leadIds: readonly string[]): Promise<StageEvent[]>;
  /** Kimlik listesiyle (giden olay dağıtıcısı için); bulunamayanlar atlanır. */
  findByIds(ids: readonly string[]): Promise<StageEvent[]>;
  /** Geriye doldurma: verilen kaynaklardaki test olmayan lead'lerin, geri alınmamış, `since` sonrası olayları. */
  listSince(since: Date, sources: readonly string[]): Promise<StageEvent[]>;
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

export interface ActivityRepository {
  findById(id: string): Promise<Activity | undefined>;
  listByLead(leadId: string): Promise<Activity[]>;
  /** Verilen lead'lerin açık aktiviteleri, vade sırasıyla (Kanban özeti ve "Bugün" için). */
  listOpenByLeads(leadIds: readonly string[]): Promise<Activity[]>;
  insert(activity: Activity): Promise<void>;
  setDone(id: string, doneAt: Date | null, updatedAt: Date): Promise<void>;
  remove(id: string): Promise<void>;
  /** Geri al: o aşama değişikliğiyle otomatik açılan aktiviteler silinir; silinen sayısı döner. */
  removeAutoCreatedByChange(changeId: string): Promise<number>;
}

export interface Repositories {
  leads: LeadRepository;
  persons: PersonRepository;
  stageEvents: StageEventRepository;
  activities: ActivityRepository;
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
