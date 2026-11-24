// sales-pipeline/application: komutlar ve sorgular. Portları kullanır, uygulamaları enjekte alır.
export type { Actor, TeamDirectory, UseCaseDeps } from "./types";
// Faz 7g kod listeleri: diğer modüller (lead-intake) yalnız application'dan içe aktarır (dependency-cruiser).
export {
  COURT_COUNT_BANDS,
  CUSTOMER_PROFILES,
  CUSTOMER_STATUSES,
  INSTALL_SITES,
  INSTALL_TIMELINES,
  bandForCount,
  isCustomerStatus,
  type CourtCountBand,
  type CustomerProfile,
  type CustomerStatus,
  type InstallSite,
  type InstallTimeline,
} from "../domain";
export { CreateLead, REP_CREATABLE_LEAD_FIELDS, type CreateLeadInput, type CreateLeadResult } from "./createLead";
export { ChangeLeadStage, type ChangeLeadStageInput, type ChangeLeadStageResult } from "./changeLeadStage";
export { UndoStageChange, type UndoStageChangeInput, type UndoStageChangeResult } from "./undoStageChange";
export { AssignLead, type AssignLeadInput } from "./assignLead";
export { UpdateLeadFields, type UpdateLeadFieldsInput } from "./updateLeadFields";
export {
  ActivityQueries,
  AddActivity,
  DeleteActivity,
  SetActivityDone,
  type ActivityWithLead,
  type AddActivityInput,
  type DeleteActivityInput,
  type SetActivityDoneInput,
  type TodayList,
  type TodayResult,
} from "./activities";
export {
  CONTACT_FILTERS,
  LeadQueries,
  isContactFilter,
  matchesTracking,
  type Board,
  type BoardInput,
  type ContactFilter,
  type ContactLogRef,
  type LeadFilterInput,
  type TrackingFilter,
  type LeadDetail,
  type LeadListItem,
  type ListLeadsInput,
  type OutboundStageEvent,
} from "./queries";
export { ProductCatalog, type CatalogImportInput } from "./productCatalog";
export { ReportQueries, type ReportInputDto, type TrackingReportInput, type TrackingReportResult } from "./reports";
export {
  ContactQueries,
  localDayStart,
  parseDayRange,
  type HistoryInput,
  type HistoryItem,
  type HistoryPage,
} from "./contactQueries";
export {
  ContactFormQuery,
  LogContact,
  UndoLogContact,
  type ContactForm,
  type ContactFormDefaults,
  type LogContactInput,
  type LogContactResult,
  type UndoLogContactInput,
} from "./contacts";
export { CheckWarning, SetCustomerStatus, type CheckWarningInput, type SetCustomerStatusInput } from "./leadStatus";
export {
  AddAttachment,
  AttachmentQueries,
  DeleteAttachment,
  type AddAttachmentInput,
  type AttachmentContent,
  type DeleteAttachmentInput,
} from "./attachments";
export {
  CreateOrganization,
  PeopleQueries,
  UpdateLeadContact,
  UpdateOrganization,
  type CreateOrganizationInput,
  type OrganizationSummary,
  type PersonSummary,
  type SearchResult,
  type UpdateLeadContactInput,
  type UpdateOrganizationInput,
} from "./organizations";
export { ArchiveOrganization, MergePersons, type MergePersonsResult } from "./peopleAdmin";
export {
  TerritoryAdmin,
  type NonSalesReassignResult,
  type PoolApplyResult,
  type TerritoryOverview,
  type TerritoryRow,
} from "./territories";
export { currentEurRates } from "./types";
export {
  ACTION_TYPES,
  ActionLog,
  ActionLogQueries,
  InMemoryActionLogStore,
  LOG_PAGE_MAX,
  isActionType,
  type ActionLogEntry,
  type ActionLogFilter,
  type ActionLogPage,
  type ActionLogStore,
  type ActionRecorder,
  type ActionType,
  type ListActionsInput,
  type RecordActionInput,
} from "./actionLog";
export { canAct, canSee, loadActionableLead } from "./visibility";
export {
  ADMIN_ONLY,
  REP_EDITABLE_LEAD_FIELDS,
  fieldsForbiddenForRep,
  requireAdmin,
  requireFieldAccess,
} from "./permissions";
export {
  InMemoryNotificationStore,
  LeadNotifier,
  NOTIFICATION_TYPES,
  NotificationDelivery,
  NotificationQueries,
  RecordingEmailSender,
  StaticUserDirectory,
  bodyOf,
  leadLink,
  type DirectoryUser,
  type EmailMessage,
  type EmailSender,
  type LeadNotifierDeps,
  type Notification,
  type NotificationStore,
  type NotificationType,
  type PushSender,
  type UserDirectory,
} from "./notifications";
export {
  InMemorySweepSource,
  NotificationSweeps,
  type DueActivityRow,
  type IdleHotLeadRow,
  type NotificationSweepsDeps,
  type SweepSource,
} from "./notificationSweeps";
export { isPushLang, pushText, type PushLang } from "./notificationText";
export {
  InMemoryPushSubscriptionStore,
  PushNotifier,
  PushSubscriptions,
  RecordingPushTransport,
  isPushEndpoint,
  type PushSubscription,
  type PushSubscriptionStore,
  type PushTransport,
} from "./push";

import { ActivityQueries, AddActivity, DeleteActivity, SetActivityDone } from "./activities";
import { AssignLead } from "./assignLead";
import { AddAttachment, AttachmentQueries, DeleteAttachment } from "./attachments";
import { ChangeLeadStage } from "./changeLeadStage";
import { ContactQueries } from "./contactQueries";
import { ContactFormQuery, LogContact, UndoLogContact } from "./contacts";
import { CheckWarning, SetCustomerStatus } from "./leadStatus";
import { CreateLead } from "./createLead";
import { CreateOrganization, PeopleQueries, UpdateLeadContact, UpdateOrganization } from "./organizations";
import { ArchiveOrganization, MergePersons } from "./peopleAdmin";
import { ProductCatalog } from "./productCatalog";
import { LeadQueries } from "./queries";
import { ReportQueries } from "./reports";
import { TerritoryAdmin } from "./territories";
import type { UseCaseDeps } from "./types";
import { UndoStageChange } from "./undoStageChange";
import { UpdateLeadFields } from "./updateLeadFields";

export interface SalesPipeline {
  createLead: CreateLead;
  changeLeadStage: ChangeLeadStage;
  undoStageChange: UndoStageChange;
  assignLead: AssignLead;
  updateLeadFields: UpdateLeadFields;
  updateLeadContact: UpdateLeadContact;
  createOrganization: CreateOrganization;
  updateOrganization: UpdateOrganization;
  addActivity: AddActivity;
  setActivityDone: SetActivityDone;
  deleteActivity: DeleteActivity;
  queries: LeadQueries;
  activities: ActivityQueries;
  reports: ReportQueries;
  people: PeopleQueries;
  /** Faz 7g: temas kaydı, geri alma, diyalog verisi, müşteri durumu, uyarı kontrolü. */
  logContact: LogContact;
  undoLogContact: UndoLogContact;
  contactForm: ContactFormQuery;
  setCustomerStatus: SetCustomerStatus;
  checkWarning: CheckWarning;
  history: ContactQueries;
  /** Faz 7b/7d: bölge kuralları, kişi birleştirme, kuruluş arşivleme (yalnız yönetici). */
  territories: TerritoryAdmin;
  mergePersons: MergePersons;
  archiveOrganization: ArchiveOrganization;
  /** Ürün listesi: herkes okur, yönetici ürün dosyasından günceller. */
  productCatalog: ProductCatalog;
  /** Lead dosya ekleri: ekleme, nedenli silme, liste ve indirme. */
  addAttachment: AddAttachment;
  deleteAttachment: DeleteAttachment;
  attachments: AttachmentQueries;
}

/** Modülün dışa açık yüzü: api katmanı ve diğer modüller bunu kullanır. */
export function createSalesPipeline(deps: UseCaseDeps): SalesPipeline {
  const changeLeadStage = new ChangeLeadStage(deps);
  const undoStageChange = new UndoStageChange(deps);
  return {
    createLead: new CreateLead(deps),
    changeLeadStage,
    undoStageChange,
    assignLead: new AssignLead(deps),
    updateLeadFields: new UpdateLeadFields(deps),
    updateLeadContact: new UpdateLeadContact(deps),
    createOrganization: new CreateOrganization(deps),
    updateOrganization: new UpdateOrganization(deps),
    addActivity: new AddActivity(deps),
    setActivityDone: new SetActivityDone(deps),
    deleteActivity: new DeleteActivity(deps),
    queries: new LeadQueries(deps),
    activities: new ActivityQueries(deps),
    reports: new ReportQueries(deps),
    people: new PeopleQueries(deps),
    logContact: new LogContact(deps, { change: changeLeadStage, undo: undoStageChange }),
    undoLogContact: new UndoLogContact(deps, undoStageChange),
    contactForm: new ContactFormQuery(deps),
    setCustomerStatus: new SetCustomerStatus(deps),
    checkWarning: new CheckWarning(deps),
    history: new ContactQueries(deps),
    territories: new TerritoryAdmin(deps),
    mergePersons: new MergePersons(deps),
    archiveOrganization: new ArchiveOrganization(deps),
    productCatalog: new ProductCatalog(deps),
    addAttachment: new AddAttachment(deps),
    deleteAttachment: new DeleteAttachment(deps),
    attachments: new AttachmentQueries(deps),
  };
}
