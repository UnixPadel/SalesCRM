// ad-feedback/builders/meta: Conversions API (CRM olayları) için saf payload builder ve hash normalleştirmesi.
export {
  hashEmailForMeta,
  hashPhoneForMeta,
  normalizeEmailForMeta,
  normalizePhoneForMeta,
  sha256Hex,
} from "./normalize";
export {
  META_EVENT_SOURCE,
  META_LEAD_EVENT_SOURCE,
  buildMetaEvent,
  hasMatchKey,
  isValidMetaLeadId,
  metaEventInputFrom,
  serializeMetaBatch,
  type MetaActionSource,
  type MetaBatchOptions,
  type MetaEvent,
  type MetaEventInput,
  type MetaUserData,
} from "./payload";
