// ad-feedback/builders/google: Data Manager API events:ingest için saf payload builder, hash normalleştirmesi, pencere kontrolü.
export {
  hashEmailForGoogle,
  hashPhoneForGoogle,
  normalizeEmailForGoogle,
  normalizePhoneForGoogle,
  sha256HexGoogle,
} from "./normalize";
export { checkUploadWindow, type WindowInput, type WindowResult } from "./window";
export {
  GOOGLE_ACCOUNT_TYPE,
  buildGoogleEvent,
  buildGoogleRequest,
  formatRfc3339,
  googleEventInputFrom,
  hasClickId,
  hasGoogleMatchKey,
  timeZoneOffsetMinutes,
  type GoogleConsentStatus,
  type GoogleDestination,
  type GoogleEvent,
  type GoogleEventInput,
  type GoogleEventSource,
  type GoogleIngestRequest,
  type GoogleRequestOptions,
  type GoogleUserIdentifier,
} from "./payload";
