import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { LangProvider } from "./i18n";
import { CrmProvider } from "./state/CrmContext";
import "./styles.css";
import "./pipeline/pipeline.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LangProvider>
      <CrmProvider>
        <App />
      </CrmProvider>
    </LangProvider>
  </StrictMode>,
);
