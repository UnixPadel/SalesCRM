import type { Activity, ActivityOutcome, ActivityType, ContactLog } from "./activity";
import type { ContactAggregateRow } from "./contact";
import type { CustomerStatus, InstallTimeline } from "./leadProfile";
import type { TerritoryRule } from "./assignment";
import type { DomainEvent } from "./events";
import type { Lead, LeadAttribution, LeadConsent, LeadSource, Person, StageEvent } from "./lead";
import type { LeadFields } from "./opportunity";
import type { Organization, OrganizationFields, OrganizationType } from "./organization";
import type { StageCode } from "./stage";

/** Portlar (Genel plan kural 2): uygulamalar infrastructure katmanında, testler sahte uygulamayla. */

/**
 * Lead listesi süzgeci. Faz 7g: aşama, sorumlu, ülke ve kaynak tek değer ya da değer listesi alır (Lead listesi
 * başlık menüleri); liste "bunlardan biri" demektir, boş liste süzgeç yok demektir (`filterValues`, filter.ts).
 */
export interface LeadListFilter {
  /** Satışçı görünürlüğü: bu kullanıcıya atanmış + havuz; undefined = hepsi (admin). */
  visibleTo?: { userId: string; countries: readonly string[] } | undefined;
  stage?: StageCode | readonly StageCode[] | undefined;
  /** Sorumlu: kullanıcı kimliği; null = ortak havuz; listede null havuzu kapsar; undefined = hepsi. */
  owner?: string | null | readonly (string | null)[] | undefined;
  /** ISO 3166-1 alpha-2 (büyük/küçük harf duyarsız). */
  country?: string | readonly string[] | undefined;
  organizationId?: string | undefined;
  personId?: string | undefined;
  /** Lead kaynağı (Faz 7: pano filtresi). */
  source?: LeadSource | readonly LeadSource[] | undefined;
  includeTest?: boolean | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  /** Faz 7g: "excel" = Excel satış takip listesinden gelenler (`extra_answers ? 'excel_no'`). */
  scope?: "excel" | undefined;
  /** Kampanya adı, tam eşleşme. */
  campaign?: string | undefined;
  /** Kurulum zamanı (Sıcak lead ön süzgeci). */
  installTimeline?: InstallTimeline | readonly InstallTimeline[] | undefined;
  /** Lead oluşturulma anı: alt (dahil) ve üst (hariç) sınır. */
  createdFrom?: Date | undefined;
  createdTo?: Date | undefined;
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
  /** Kimlik alanları (Faz 6d): ad, normalize e-posta, E.164 telefon; kişi kaydı uygulama katmanında ayrıca güncellenir. */
  updateIdentity(
    id: string,
    identity: { fullName: string; email: string | null; phoneE164: string | null },
    updatedAt: Date,
  ): Promise<void>;
  /** Tıklama kimlikleri (1:1); lead ile aynı transaction'da yazılır. */
  saveAttribution(leadId: string, attribution: LeadAttribution): Promise<void>;
  findAttribution(leadId: string): Promise<LeadAttribution | undefined>;
  /** Onay kayıtları (1:N, yalnız ekleme); lead ile aynı transaction'da yazılır. */
  saveConsents(consents: readonly LeadConsent[]): Promise<void>;
  findConsents(leadId: string): Promise<LeadConsent[]>;
  /** Müşteri durumu (Faz 7g, D1): aşamadan bağımsız; null = "Durum girilmedi". */
  setCustomerStatus(id: string, status: CustomerStatus | null, updatedAt: Date): Promise<void>;
  /** Yöneticinin "Kontrol edildi" dediği uyarı kodları; liste olduğu gibi yazılır. */
  setCheckedWarnings(id: string, codes: readonly string[], updatedAt: Date): Promise<void>;
  /** `extra_answers` içinden anahtar siler (ülke/telefon düzeltilince köken bilgisi). */
  removeExtraAnswerKeys(id: string, keys: readonly string[], updatedAt: Date): Promise<void>;
  /** `extra_answers`'a anahtar ekler ya da günceller (içe aktarma, Excel lead'inin benimsenmesi). */
  mergeExtraAnswers(id: string, patch: Record<string, unknown>, updatedAt: Date): Promise<void>;
}

export interface PersonListFilter {
  search?: string | undefined;
  organizationId?: string | undefined;
  limit?: number | undefined;
}

export interface PersonRepository {
  findById(id: string): Promise<Person | undefined>;
  findByEmailOrPhone(emailNormalized: string | null, phoneE164: string | null): Promise<Person | undefined>;
  /** Ad, e-posta, telefon, firma araması; ada göre sıralı. */
  list(filter: PersonListFilter): Promise<Person[]>;
  insert(person: Person): Promise<void>;
  /** Yalnız verilen alanlar değişir (kimlik düzenleme, kuruluş bağı, taşıma). */
  update(
    id: string,
    patch: Partial<
      Pick<Person, "fullName" | "emailNormalized" | "phoneE164" | "country" | "company" | "organizationId">
    >,
  ): Promise<void>;
}

export interface OrganizationListFilter {
  search?: string | undefined;
  country?: string | undefined;
  type?: OrganizationType | undefined;
  limit?: number | undefined;
}

export interface OrganizationRepository {
  findById(id: string): Promise<Organization | undefined>;
  findByIds(ids: readonly string[]): Promise<Organization[]>;
  findByLegacyId(legacyId: string): Promise<Organization | undefined>;
  /** Aynı ad + ülke tek kayıttır (büyük/küçük harf duyarsız). */
  findByName(name: string, country: string | null): Promise<Organization | undefined>;
  list(filter: OrganizationListFilter): Promise<Organization[]>;
  insert(organization: Organization): Promise<void>;
  update(id: string, fields: Partial<OrganizationFields>, updatedAt: Date): Promise<void>;
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
  /**
   * Lead'in verilen nedenle atlanmış satırlarını yeniden sıraya alır (deneme sayısı sıfırlanır). İçe aktarılan lead
   * reklam kaydıyla benimsendiğinde eski aşama olayları da platforma gidebilsin diye.
   */
  reviveSkipped(leadId: string, reason: string, notBefore: Date): Promise<void>;
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
  /** Taşıma: eski kimlikle daha önce açılmış mı. */
  findByLegacyId(legacyId: string): Promise<Activity | undefined>;
  /** Planı temasla tamamlar (Faz 7g): tür, sonuç, not ve kayıt bağı aynı satıra yazılır. */
  complete(id: string, patch: ActivityCompletion, updatedAt: Date): Promise<void>;
  /** Tamamlanmışı yeniden açar: temas alanları temizlenir, tür ve konu verilen değere döner. */
  reopen(id: string, back: { type: ActivityType; subject: string }, updatedAt: Date): Promise<void>;
  /** Temas kaydının eklediği satırlar (`log_id = logId`), `exceptId` hariç; silinen sayısı. */
  removeCreatedByLog(logId: string, exceptId: string | null): Promise<number>;
  /** Temas kaydının açık "sonraki takip"i (`next_of_log_id = logId AND done_at IS NULL`); silinen sayısı. */
  removeOpenNextOfLog(logId: string): Promise<number>;
  /** Lead başına temas toplamı; SQL `GROUP BY` ile `aggregateContacts` aynı anahtarı kullanır. */
  contactAggregatesByLeads(leadIds: readonly string[]): Promise<ContactAggregateRow[]>;
  /** Temas geçmişi: tamamlanmış satırlar `(done_at DESC, id DESC)` anahtar kümesiyle. */
  listDone(filter: DoneActivityFilter): Promise<Activity[]>;
}

export interface ActivityCompletion {
  doneAt: Date;
  type: ActivityType;
  outcome: ActivityOutcome;
  customerReplied: boolean;
  resultNote: string;
  doneByUserId: string;
  logId: string;
  dateEstimated: boolean;
}

export interface DoneActivityFilter {
  leadIds: readonly string[];
  /** done_at alt (dahil) ve üst (hariç) sınırı. */
  from?: Date | undefined;
  to?: Date | undefined;
  type?: ActivityType | undefined;
  outcome?: ActivityOutcome | undefined;
  doneBy?: string | undefined;
  /** Görüşme notunda arama (küçük harf duyarsız). */
  note?: string | undefined;
  /** Anahtar kümesi: bu (done_at, id) çiftinden sonrakiler. */
  before?: { at: Date; id: string } | undefined;
  limit: number;
}

/** Temas kayıtları (Faz 7g, `contact_logs`): tek "Temas kaydet" işleminin geri alma bilgisi. */
export interface ContactLogRepository {
  insert(log: ContactLog): Promise<void>;
  findById(id: string): Promise<ContactLog | undefined>;
  /** Lead'in kayıtları, en yeni önce (lead detayındaki "Geri al" bağları). */
  listByLead(leadId: string): Promise<ContactLog[]>;
  /** Geri almada silinir; bağlı aktivitelerin `log_id` / `next_of_log_id` alanı DB'de NULL olur. */
  remove(id: string): Promise<void>;
}

export interface Repositories {
  leads: LeadRepository;
  persons: PersonRepository;
  organizations: OrganizationRepository;
  stageEvents: StageEventRepository;
  activities: ActivityRepository;
  contactLogs: ContactLogRepository;
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
