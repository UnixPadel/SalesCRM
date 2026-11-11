import { useEffect, useState } from "react";
import { Header } from "./components/Header";
import { Toasts } from "./components/Toasts";
import { Skeleton } from "./components/ui";
import { LoginPage } from "./pages/LoginPage";
import { ActivitiesPage } from "./pipeline/ActivitiesPage";
import { AdminPage } from "./pipeline/admin/AdminPage";
import { LeadListPage } from "./pipeline/list/LeadListPage";
import { KanbanPage } from "./pipeline/KanbanPage";
import { LeadPage } from "./pipeline/LeadPage";
import { NewLeadDialog } from "./pipeline/NewLeadDialog";
import { PeoplePage } from "./pipeline/PeoplePage";
import { ReportsPage } from "./pipeline/ReportsPage";
import { parseHash } from "./router";
import { useCrm } from "./state/CrmContext";

/**
 * Yönlendirme. Bütün sayfalar yeni satış pipeline'ından (Postgres) gelir: Gelen kutusu, lead detayı, Pano,
 * Bugün, Kişiler ve kuruluşlar, Raporlar. Eski JSON panosu ve sayfaları Faz 6d ile kaldırıldı.
 */
export default function App() {
  const { authChecked, user } = useCrm();
  const [{ route, q, id, params }, setLoc] = useState(parseHash);
  const [newLead, setNewLead] = useState(false);

  useEffect(() => {
    const on = () => setLoc(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  if (!authChecked) {
    return (
      <div className="login" aria-busy="true" aria-label="Oturum kontrol ediliyor">
        <div className="login-card">
          <Skeleton h={28} w={180} />
          <Skeleton h={44} />
          <Skeleton h={44} />
        </div>
      </div>
    );
  }
  if (!user) return <LoginPage />;

  return (
    <div className="shell">
      <Header route={route} onNewLead={() => setNewLead(true)} />
      <main className="page" id="main">
        {route === "list" ? (
          <LeadListPage params={params} />
        ) : route === "lead" ? (
          <LeadPage id={id} key={id} />
        ) : route === "pipeline" ? (
          <KanbanPage params={params} />
        ) : route === "activities" ? (
          <ActivitiesPage params={params} />
        ) : route === "reports" ? (
          <ReportsPage params={params} />
        ) : route === "admin" ? (
          <AdminPage params={params} />
        ) : (
          <PeoplePage initialQuery={q} key={q} />
        )}
      </main>

      {newLead && <NewLeadDialog onClose={() => setNewLead(false)} />}

      <Toasts />
    </div>
  );
}
