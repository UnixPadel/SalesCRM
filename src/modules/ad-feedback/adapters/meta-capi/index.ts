// ad-feedback/adapters/meta-capi: Conversions API (CRM olayları) istemcisi ve PlatformSender uygulaması.
export { META_CAPI_SECRET_NAMES, metaCapiConfig, type MetaCapiConfig } from "./config";
export { createCapiClient, type CapiClient, type CapiClientOptions, type FetchLike } from "./client";
export { META_PROVIDER, metaCapiSender, type MetaSenderOptions } from "./sender";
