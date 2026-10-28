import type { LeadSource } from "./lead";
import type { StageCode } from "./stage";

/** Domain olayları: bildirim ve raporlar bunlara abone olur, aşama motorunu çağırmaz. */
export interface LeadCreated {
  type: "LeadCreated";
  leadId: string;
  personId: string;
  source: LeadSource;
  assignedUserId: string | null;
  /** Elle açan kişi; webhook akışında null. Kendi açtığı lead için satışçıya bildirim gitmez. */
  actorUserId: string | null;
  occurredAt: Date;
}

export interface LeadStageChanged {
  type: "LeadStageChanged";
  leadId: string;
  changeId: string;
  from: StageCode;
  to: StageCode;
  actorUserId: string;
  occurredAt: Date;
}

export interface LeadStageChangeUndone {
  type: "LeadStageChangeUndone";
  leadId: string;
  changeId: string;
  revertedTo: StageCode;
  actorUserId: string;
  occurredAt: Date;
}

export interface LeadAssigned {
  type: "LeadAssigned";
  leadId: string;
  from: string | null;
  to: string | null;
  actorUserId: string | null;
  occurredAt: Date;
}

export type DomainEvent = LeadCreated | LeadStageChanged | LeadStageChangeUndone | LeadAssigned;
