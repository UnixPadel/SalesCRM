import { useEffect, useState } from "react";
import { DealPanel } from "./components/DealPanel";
import { Header } from "./components/Header";
import { NewDealDialog } from "./components/NewDealDialog";
import { Toasts } from "./components/Toasts";
import { Skeleton } from "./components/ui";
import { ActivitiesPage } from "./pages/ActivitiesPage";
import { ContactsPage } from "./pages/ContactsPage";
import { LeadsPage } from "./pages/LeadsPage";
import { LoginPage } from "./pages/LoginPage";
import { PipelinePage } from "./pages/PipelinePage";
import { ReportsPage } from "./pages/ReportsPage";
import { parseHash } from "./router";
import { useCrm } from "./state/CrmContext";

export default function App() {
  const { ready, authChecked, user, openDealId } = useCrm();
  const [{ route, q }, setLoc] = useState(parseHash);
  const [newDeal, setNewDeal] = useState(false);

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
      <Header route={route} onNewDeal={() => setNewDeal(true)} />
      <main className="page" id="main">
        {!ready ? (
          <BoardSkeleton />
        ) : route === "pipeline" ? (
          <PipelinePage />
        ) : route === "leads" ? (
          <LeadsPage initialQuery={q} key={q} />
        ) : route === "activities" ? (
          <ActivitiesPage />
        ) : route === "reports" ? (
          <ReportsPage />
        ) : (
          <ContactsPage initialQuery={q} key={q} />
        )}
      </main>

      {openDealId && <DealPanel dealId={openDealId} key={openDealId} />}
      {newDeal && <NewDealDialog onClose={() => setNewDeal(false)} />}

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
