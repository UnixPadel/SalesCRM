// lead-intake/application: inbox işleri, CreateLeadFromAd, DTO ve portlar. Adaptörler bu katmana bağlanır.
export * from "./dto";
export * from "./ports";
export { buildInboundLead, type BuildLeadInput } from "./buildLead";
export { countryCodeFrom, resolveCountry } from "./country";
export { CreateLeadFromAd, type CreateLeadFromAdResult } from "./createLeadFromAd";
export {
  AcceptInboundEvent,
  ProcessInbox,
  PurgeInboxPayloads,
  RunBackfill,
  type AcceptInput,
  type ProcessInboxDeps,
  type ProcessInboxStats,
} from "./inboxJobs";

import { HOUR, DAY, type Clock, type IdGenerator, type Logger } from "../../shared/kernel";
import { CreateLeadFromAd } from "./createLeadFromAd";
import { AcceptInboundEvent, ProcessInbox, PurgeInboxPayloads, RunBackfill } from "./inboxJobs";
import type { BackfillSource, InboxRepository, LeadCreator, MappingSource, SourceAdapter } from "./ports";

export interface LeadIntakeDeps {
  inbox: InboxRepository;
  adapters: readonly SourceAdapter[];
  backfillSources: readonly BackfillSource[];
  mappings: MappingSource;
  leads: LeadCreator;
  ids: IdGenerator;
  clock: Clock;
  logger: Logger;
  retryMinutes: readonly number[];
  defaultCountry: string;
  backfillLookbackHours: number;
  retentionDays: number;
}

export interface LeadIntake {
  accept: AcceptInboundEvent;
  process: ProcessInbox;
  backfill: RunBackfill;
  purge: PurgeInboxPayloads;
  createLeadFromAd: CreateLeadFromAd;
}

export function createLeadIntake(deps: LeadIntakeDeps): LeadIntake {
  const createLeadFromAd = new CreateLeadFromAd(deps.leads, deps.logger);
  return {
    accept: new AcceptInboundEvent(deps.inbox, deps.ids, deps.clock, deps.logger),
    process: new ProcessInbox({
      inbox: deps.inbox,
      adapters: deps.adapters,
      mappings: deps.mappings,
      createLead: createLeadFromAd,
      clock: deps.clock,
      logger: deps.logger,
      retryMinutes: deps.retryMinutes,
      defaultCountry: deps.defaultCountry,
    }),
    backfill: new RunBackfill({
      sources: deps.backfillSources,
      inbox: deps.inbox,
      ids: deps.ids,
      clock: deps.clock,
      logger: deps.logger,
      lookbackMs: deps.backfillLookbackHours * HOUR,
    }),
    purge: new PurgeInboxPayloads({
      inbox: deps.inbox,
      clock: deps.clock,
      logger: deps.logger,
      retentionMs: deps.retentionDays * DAY,
    }),
    createLeadFromAd,
  };
}
