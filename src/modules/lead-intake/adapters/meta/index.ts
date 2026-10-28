// lead-intake/adapters/meta: Meta Lead Ads — webhook doğrulama, Graph API istemcisi, kaynak adaptörü, yedek senkron.
export { META_SECRET_NAMES, metaConfig, metaConfigured, type MetaConfig } from "./config";
export {
  extractLeadgenChanges,
  verifyChallenge,
  verifySignature,
  type LeadgenChange,
  type VerifyQuery,
} from "./webhook";
export {
  LEAD_FIELDS,
  createGraphClient,
  type FetchLike,
  type GraphClient,
  type GraphClientOptions,
  type GraphFieldData,
  type GraphLead,
} from "./graphClient";
export {
  META_PROVIDER,
  changePayload,
  graphLeadToDto,
  isMetaTestLead,
  leadPayload,
  metaBackfillSource,
  metaSourceAdapter,
  type MetaInboxPayload,
} from "./adapter";
