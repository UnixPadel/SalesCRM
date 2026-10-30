/**
 * Meta Conversions API (CRM olayları) ayarları. Secret'lar adıyla okunur (ADR-0004); bootstrap `readSecret`'ı geçirir.
 * Graph sürümü lead-intake ile aynı değişkenden (tek değer). Token: META_CAPI_TOKEN boşsa sistem kullanıcısı token'ı.
 */
export interface MetaCapiConfig {
  token: string;
  graphVersion: string;
  /** Ortam değişkenindeki veri seti kimliği; integration_settings `meta/dataset_id` doluysa o kazanır. */
  datasetId: string;
  /** Yalnız staging: Events Manager → Test Olayları kodu. Canlıda boş. */
  testEventCode: string;
}

export const META_CAPI_SECRET_NAMES = {
  token: "META_CAPI_TOKEN",
  fallbackToken: "META_SYSTEM_USER_TOKEN",
} as const;

export function metaCapiConfig(read: (name: string) => string): MetaCapiConfig {
  return {
    token: read(META_CAPI_SECRET_NAMES.token) || read(META_CAPI_SECRET_NAMES.fallbackToken),
    graphVersion: read("META_GRAPH_API_VERSION") || "v26.0",
    datasetId: read("META_DATASET_ID").trim(),
    testEventCode: read("META_TEST_EVENT_CODE").trim(),
  };
}
