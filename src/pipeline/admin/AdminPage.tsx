import { useCallback } from "react";
import { Empty, Icon, Skeleton } from "../../components/ui";
import { useLang } from "../../i18n";
import { setHashParams } from "../../router";
import { useCrm } from "../../state/CrmContext";
import { useErrorText } from "../hooks";
import { adminApi } from "./adminApi";
import { AdminWriteCtx, LoadError, useAdminCanWrite, useLoad } from "./bits";
import { HealthTab } from "./HealthTab";
import { LogsTab } from "./LogsTab";
import { MappingsTab } from "./MappingsTab";
import { ProductsTab } from "./ProductsTab";
import { SettingsTab } from "./SettingsTab";
import { TerritoriesTab } from "./TerritoriesTab";

/**
 * Yönetim paneli (Faz 7, `#/admin`). Önde iş sekmeleri: Bölgeler · Ürün listesi; kenarda "Teknik" sekmesi, altında
 * Sağlık · Eşlemeler · Ayarlar (2026-11-20). `admin` rolü görür ve değiştirir; pazarlama rolü salt okunur görür
 * (değişiklik düğmeleri gizli, alanlar kilitli; sunucu da yazmayı 403 ile reddeder) ve Teknik'ten açar. Satışçı ve
 * görüntüleyici bu adresi yazarsa "yetki yok" sayfası görür. Sekme URL'de tutulur (`tab=`).
 *
 * Loglar sekmesi (işlem günlüğü) Ürün listesinin yanındadır ve yalnız oturumu `seesLogs` olan kişiye görünür
 * (server/roles.mjs CRM_LOG_VIEWERS). Bu kişi yönetici değilse panelde yalnız Loglar sekmesini görür.
 */

const MAIN_TABS = ["territories", "products"] as const;
const TECH_TABS = ["health", "mappings", "settings"] as const;
const TABS = [...MAIN_TABS, "logs", ...TECH_TABS] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: string | null): v is Tab => (TABS as readonly string[]).includes(v ?? "");
const isTech = (t: Tab) => (TECH_TABS as readonly string[]).includes(t);

export function AdminPage({ params }: { params: URLSearchParams }) {
  const { t } = useLang();
  const { isAdmin, isMarketing, user } = useCrm();
  const seesLogs = user?.seesLogs === true;
  const panel = isAdmin || isMarketing;
  if (!panel && !seesLogs) {
    return (
      <section className="pl-page" aria-labelledby="adm-h">
        <h1 id="adm-h" className="pl-title">
          {t("admin.title")}
        </h1>
        <Empty title={t("admin.denied.title")}>{t("admin.denied.body")}</Empty>
      </section>
    );
  }
  const asked = params.get("tab");
  const allowed = isTab(asked) && (asked === "logs" ? seesLogs : panel);
  return (
    <AdminWriteCtx.Provider value={isAdmin}>
      <AdminTabs
        tab={allowed ? (asked as Tab) : !panel ? "logs" : isAdmin ? "territories" : "health"}
        panel={panel}
        seesLogs={seesLogs}
      />
    </AdminWriteCtx.Provider>
  );
}

function AdminTabs({ tab, panel, seesLogs }: { tab: Tab; panel: boolean; seesLogs: boolean }) {
  const { t } = useLang();
  const errText = useErrorText();
  // Sağlayıcı listesi (ad, giden akışı var mı) bir kez okunur; Eşlemeler ve Ayarlar sekmeleri bunu kullanır.
  // Yalnız Loglar'ı gören kişi (yönetici ya da pazarlama değil) sağlık ucunu okuyamaz; istek atılmaz.
  const load = useCallback(() => (panel ? adminApi.health() : Promise.resolve(null)), [panel]);
  const { data, error, reload } = useLoad(load);
  const providers = (data?.providers ?? []).map((p) => ({ provider: p.provider, hasOutbound: p.outbound !== null }));
  const needsProviders = tab === "mappings" || tab === "settings";
  const canWrite = useAdminCanWrite();
  const go = (k: Tab) => setHashParams("admin", new URLSearchParams(`tab=${k}`), true);
  const tabButton = (k: Tab, label: string, className = "tab", selected = tab === k) => (
    <button
      key={k}
      type="button"
      role="tab"
      id={`adm-tab-${k}`}
      aria-selected={selected}
      aria-controls="adm-panel"
      className={className}
      onClick={() => go(k)}
    >
      {label}
    </button>
  );

  return (
    <section className="pl-page adm-page" aria-labelledby="adm-h">
      <div className="adm-top">
        <h1 id="adm-h" className="pl-title">
          {t("admin.title")}
        </h1>
        <div className="tabs adm-tabs" role="tablist" aria-label={t("admin.title")}>
          {panel && MAIN_TABS.map((k) => tabButton(k, t(`admin.tab.${k}`)))}
          {seesLogs && tabButton("logs", t("admin.tab.logs"))}
          {panel && (
            <button
              type="button"
              role="tab"
              id="adm-tab-tech"
              aria-selected={isTech(tab)}
              aria-controls="adm-panel"
              className="tab adm-tab-tech"
              onClick={() => !isTech(tab) && go("health")}
            >
              <Icon name="settings" size={15} /> {t("admin.tab.technical")}
            </button>
          )}
        </div>
      </div>
      {isTech(tab) && (
        <div className="tabs adm-subtabs" role="tablist" aria-label={t("admin.tab.technical")}>
          {TECH_TABS.map((k) => tabButton(k, t(`admin.tab.${k}`)))}
        </div>
      )}
      {!canWrite && tab !== "logs" && (
        <p className="adm-ro" role="note">
          {t("admin.readOnly")}
        </p>
      )}
      <div id="adm-panel" role="tabpanel" aria-labelledby={`adm-tab-${tab}`}>
        {tab === "health" ? (
          <HealthTab />
        ) : tab === "territories" ? (
          <TerritoriesTab />
        ) : tab === "products" ? (
          <ProductsTab />
        ) : tab === "logs" ? (
          <LogsTab />
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
