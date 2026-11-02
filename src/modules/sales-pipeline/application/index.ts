// sales-pipeline/application: komutlar ve sorgular. Portları kullanır, uygulamaları enjekte alır.
export type { Actor, UseCaseDeps } from "./types";
export { CreateLead, type CreateLeadInput, type CreateLeadResult } from "./createLead";
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
} from "./activities";
export {
  LeadQueries,
  type Board,
  type BoardInput,
  type LeadDetail,
  type LeadListItem,
  type ListLeadsInput,
  type OutboundStageEvent,
} from "./queries";
export { ReportQueries, type ReportInputDto } from "./reports";
export { canAct, canSee, loadActionableLead, territoriesOf } from "./visibility";
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
import { CreateLead } from "./createLead";
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
  addActivity: AddActivity;
  setActivityDone: SetActivityDone;
  deleteActivity: DeleteActivity;
  queries: LeadQueries;
  activities: ActivityQueries;
  reports: ReportQueries;
}

/** Modülün dışa açık yüzü: api katmanı ve diğer modüller bunu kullanır. */
export function createSalesPipeline(deps: UseCaseDeps): SalesPipeline {
  return {
    createLead: new CreateLead(deps),
    changeLeadStage: new ChangeLeadStage(deps),
    undoStageChange: new UndoStageChange(deps),
    assignLead: new AssignLead(deps),
    updateLeadFields: new UpdateLeadFields(deps),
    addActivity: new AddActivity(deps),
    setActivityDone: new SetActivityDone(deps),
    deleteActivity: new DeleteActivity(deps),
    queries: new LeadQueries(deps),
    activities: new ActivityQueries(deps),
    reports: new ReportQueries(deps),
  };
}
