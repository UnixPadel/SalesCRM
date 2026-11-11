import { useCallback } from "react";
import { Empty, Skeleton } from "../../components/ui";
import { useLang } from "../../i18n";
import { setHashParams } from "../../router";
import { useCrm } from "../../state/CrmContext";
import { useErrorText } from "../hooks";
import { adminApi } from "./adminApi";
import { LoadError, useLoad } from "./bits";
import { HealthTab } from "./HealthTab";
import { MappingsTab } from "./MappingsTab";
import { SettingsTab } from "./SettingsTab";
import { TerritoriesTab } from "./TerritoriesTab";

/**
 * Yönetim paneli (Faz 7, `#/admin`): Sağlık · Eşlemeler · Ayarlar · Bölgeler. Yalnız `admin` rolü; satışçı ve
 * görüntüleyici bu adresi yazarsa "yetki yok" sayfası görür (sunucu da 403 döner). Sekme URL'de tutulur.
 */
const TABS = ["health", "mappings", "settings", "territories"] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: string | null): v is Tab => (TABS as readonly string[]).includes(v ?? "");

export function AdminPage({ params }: { params: URLSearchParams }) {
  const { t } = useLang();
  const { isAdmin } = useCrm();
  if (!isAdmin) {
    return (
      <section className="pl-page" aria-labelledby="adm-h">
        <h1 id="adm-h" className="pl-title">
          {t("admin.title")}
        </h1>
        <Empty title={t("admin.denied.title")}>{t("admin.denied.body")}</Empty>
      </section>
    );
  }
  return <AdminTabs tab={isTab(params.get("tab")) ? (params.get("tab") as Tab) : "health"} />;
}

function AdminTabs({ tab }: { tab: Tab }) {
  const { t } = useLang();
  const errText = useErrorText();
  // Sağlayıcı listesi (ad, giden akışı var mı) bir kez okunur; Eşlemeler ve Ayarlar sekmeleri bunu kullanır.
  const load = useCallback(() => adminApi.health(), []);
  const { data, error, reload } = useLoad(load);
  const providers = (data?.providers ?? []).map((p) => ({ provider: p.provider, hasOutbound: p.outbound !== null }));
  const needsProviders = tab === "mappings" || tab === "settings";

  return (
    <section className="pl-page adm-page" aria-labelledby="adm-h">
      <div className="adm-top">
        <h1 id="adm-h" className="pl-title">
          {t("admin.title")}
        </h1>
        <div className="tabs" role="tablist" aria-label={t("admin.title")}>
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`adm-tab-${k}`}
              aria-selected={tab === k}
              aria-controls="adm-panel"
              className="tab"
              onClick={() => setHashParams("admin", new URLSearchParams(k === "health" ? "" : `tab=${k}`), true)}
            >
              {t(`admin.tab.${k}`)}
            </button>
          ))}
        </div>
      </div>
      <div id="adm-panel" role="tabpanel" aria-labelledby={`adm-tab-${tab}`}>
        {tab === "health" ? (
          <HealthTab />
        ) : tab === "territories" ? (
          <TerritoriesTab />
        ) : needsProviders && !data ? (
          error ? (
            <LoadError message={errText(error)} onRetry={() => void reload()} />
          ) : (
            <div className="adm-stack" aria-busy="true">
              <Skeleton h={48} />
              <Skeleton h={220} />
            </div>
          )
        ) : tab === "mappings" ? (
          <MappingsTab providers={providers} />
        ) : (
          <SettingsTab providers={providers} generalSecrets={data?.secrets ?? []} />
        )}
      </div>
    </section>
  );
}
