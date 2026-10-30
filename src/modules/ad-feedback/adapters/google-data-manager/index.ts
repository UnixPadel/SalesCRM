// ad-feedback/adapters/google-data-manager: Data Manager API (events:ingest) istemcisi, servis hesabı token'ı, PlatformSender.
export { GOOGLE_DM_SECRET_NAMES, googleDataManagerConfig, type GoogleDataManagerConfig } from "./config";
export {
  GOOGLE_DM_SCOPE,
  createServiceAccountTokenProvider,
  parseServiceAccountKey,
  signServiceAccountJwt,
  type FetchLike,
  type ServiceAccountKey,
  type ServiceAccountTokenOptions,
  type TokenProvider,
} from "./auth";
export {
  GOOGLE_DM_INGEST_URL,
  createDataManagerClient,
  type DataManagerClient,
  type DataManagerClientOptions,
} from "./client";
export { GOOGLE_PROVIDER, googleDataManagerSender, type GoogleSenderOptions } from "./sender";
