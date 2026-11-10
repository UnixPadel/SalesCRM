import type { Activity } from "../domain";
import type { ActivityDto } from "./dto";

/** Aktivite → DTO (tarihler ISO). Rotalar arasında ortak. */
export function activityDto(a: Activity): ActivityDto {
  return {
    id: a.id,
    leadId: a.leadId,
    type: a.type,
    subject: a.subject,
    dueAt: a.dueAt.toISOString(),
    doneAt: a.doneAt === null ? null : a.doneAt.toISOString(),
    notes: a.notes,
    autoCreated: a.autoCreated,
    createdByUserId: a.createdByUserId,
    createdAt: a.createdAt.toISOString(),
    outcome: a.outcome,
    customerReplied: a.customerReplied,
    resultNote: a.resultNote,
    doneByUserId: a.doneByUserId,
    dateEstimated: a.dateEstimated,
    logId: a.logId,
    nextOfLogId: a.nextOfLogId,
  };
}
