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
export { canAct, canSee, loadActionableLead, territoriesOf } from "./visibility";
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
  type UserDirectory,
} from "./notifications";

import { ActivityQueries, AddActivity, DeleteActivity, SetActivityDone } from "./activities";
import { AssignLead } from "./assignLead";
import { ChangeLeadStage } from "./changeLeadStage";
import { ContactQueries } from "./contactQueries";
import { ContactFormQuery, LogContact, UndoLogContact } from "./contacts";
import { CheckWarning, SetCustomerStatus } from "./leadStatus";
import { CreateLead } from "./createLead";
import { CreateOrganization, PeopleQueries, UpdateLeadContact, UpdateOrganization } from "./organizations";
import { LeadQueries } from "./queries";
import { ReportQueries } from "./reports";
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
  };
}
