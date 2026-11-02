import { useEffect, useState } from "react";
import { DealPanel } from "./components/DealPanel";
import { Header } from "./components/Header";
import { Toasts } from "./components/Toasts";
import { Skeleton } from "./components/ui";
import { ContactsPage } from "./pages/ContactsPage";
import { LeadsPage } from "./pages/LeadsPage";
import { LoginPage } from "./pages/LoginPage";
import { ActivitiesPage } from "./pipeline/ActivitiesPage";
import { InboxPage } from "./pipeline/InboxPage";
import { KanbanPage } from "./pipeline/KanbanPage";
import { LeadPage } from "./pipeline/LeadPage";
import { NewLeadDialog } from "./pipeline/NewLeadDialog";
import { ReportsPage } from "./pipeline/ReportsPage";
import { parseHash } from "./router";
import { useCrm } from "./state/CrmContext";

/**
 * Yönlendirme. Gelen kutusu, lead detayı, pano ve "Bugün" (Faz 6a) yeni satış pipeline'ından (Postgres) gelir;
 * "Raporlar", "Kişiler" ve eski form listesi geçiş süresince (Faz 6c–6d) eski JSON verisiyle çalışır.
 */
export default function App() {
  const { ready, authChecked, user, openDealId } = useCrm();
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

  const legacy = route === "contacts" || route === "leads";

  return (
    <div className="shell">
      <Header route={route} onNewLead={() => setNewLead(true)} />
      <main className="page" id="main">
        {route === "inbox" ? (
          <InboxPage initialQuery={q} key={q} />
        ) : route === "lead" ? (
          <LeadPage id={id} key={id} />
        ) : route === "pipeline" ? (
          <KanbanPage params={params} />
        ) : route === "activities" ? (
          <ActivitiesPage />
        ) : route === "reports" ? (
          <ReportsPage />
        ) : legacy && !ready ? (
          <BoardSkeleton />
        ) : route === "leads" ? (
          <LeadsPage initialQuery={q} key={q} />
        ) : (
          <ContactsPage initialQuery={q} key={q} />
        )}
      </main>

      {openDealId && <DealPanel dealId={openDealId} key={openDealId} />}
      {newLead && <NewLeadDialog onClose={() => setNewLead(false)} />}

      <Toasts />
    </div>
  );
}

/** Fixed-size placeholders so the board does not jump when data arrives (no CLS). */
function BoardSkeleton() {
  return (
    <div className="board-skel" aria-busy="true" aria-label="Yükleniyor">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i}>
          <Skeleton h={64} />
          {Array.from({ length: 3 - (i % 2) }, (_, j) => (
            <Skeleton key={j} h={112} />
          ))}
        </div>
      ))}
    </div>
  );
}
