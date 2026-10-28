// sales-pipeline/application: komutlar ve sorgular. Portları kullanır, uygulamaları enjekte alır.
export type { Actor, UseCaseDeps } from "./types";
export { CreateLead, type CreateLeadInput, type CreateLeadResult } from "./createLead";
export { ChangeLeadStage, type ChangeLeadStageInput, type ChangeLeadStageResult } from "./changeLeadStage";
export { UndoStageChange, type UndoStageChangeInput, type UndoStageChangeResult } from "./undoStageChange";
export { AssignLead, type AssignLeadInput } from "./assignLead";
export { LeadQueries, type LeadDetail, type ListLeadsInput } from "./queries";
export { canAct, canSee, territoriesOf } from "./visibility";
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

import { AssignLead } from "./assignLead";
import { ChangeLeadStage } from "./changeLeadStage";
import { CreateLead } from "./createLead";
import { LeadQueries } from "./queries";
import type { UseCaseDeps } from "./types";
import { UndoStageChange } from "./undoStageChange";

export interface SalesPipeline {
  createLead: CreateLead;
  changeLeadStage: ChangeLeadStage;
  undoStageChange: UndoStageChange;
  assignLead: AssignLead;
  queries: LeadQueries;
}

/** Modülün dışa açık yüzü: api katmanı ve diğer modüller bunu kullanır. */
export function createSalesPipeline(deps: UseCaseDeps): SalesPipeline {
  return {
    createLead: new CreateLead(deps),
    changeLeadStage: new ChangeLeadStage(deps),
    undoStageChange: new UndoStageChange(deps),
    assignLead: new AssignLead(deps),
    queries: new LeadQueries(deps),
  };
}
