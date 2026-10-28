/**
 * Meta Lead Ads adaptör ayarları. Secret'lar adıyla okunur (ADR-0004); bootstrap `readSecret`'ı geçirir.
 * Graph API sürümü tek yerde: META_GRAPH_API_VERSION.
 */
export interface MetaConfig {
  appSecret: string;
  verifyToken: string;
  systemUserToken: string;
  graphVersion: string;
  /** Yedek senkron için varsayılan form listesi; integration_settings doluysa o kazanır. */
  formIds: string[];
  pageId: string;
}

export const META_SECRET_NAMES = {
  appSecret: "META_APP_SECRET",
  verifyToken: "META_VERIFY_TOKEN",
  systemUserToken: "META_SYSTEM_USER_TOKEN",
} as const;

export function metaConfig(read: (name: string) => string): MetaConfig {
  return {
    appSecret: read(META_SECRET_NAMES.appSecret),
    verifyToken: read(META_SECRET_NAMES.verifyToken),
    systemUserToken: read(META_SECRET_NAMES.systemUserToken),
    graphVersion: read("META_GRAPH_API_VERSION") || "v26.0",
    formIds: read("META_FORM_IDS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    pageId: read("META_PAGE_ID").trim(),
  };
}

export const metaConfigured = (c: MetaConfig): boolean => Boolean(c.appSecret && c.verifyToken);
