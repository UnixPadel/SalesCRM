import { useState } from "react";
import { localeOf, useLang } from "../i18n";
import { LATEST_WHATS_NEW, WHATS_NEW } from "../whatsNew";
import { Button, Modal } from "./ui";

/** Bu tarayıcıda en son görülen notun kimliği. */
const SEEN_KEY = "unixcrm.whatsNewSeen";

const readSeen = (): string | null => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
};
const markSeen = () => {
  try {
    if (LATEST_WHATS_NEW) localStorage.setItem(SEEN_KEY, LATEST_WHATS_NEW);
  } catch {
    /* yalnız kolaylık: tarayıcı saklamıyorsa pencere bir sonraki açılışta yine çıkar */
  }
};

/** Program açılışta: görülmemiş yeni not varsa pencere bir kez açılır. Menüden her zaman açılabilir. */
export function useWhatsNew() {
  const [open, setOpen] = useState(() => LATEST_WHATS_NEW !== null && readSeen() !== LATEST_WHATS_NEW);
  return {
    open,
    show: () => setOpen(true),
    close: () => {
      markSeen();
      setOpen(false);
    },
  };
}

/** "Neler yeni" penceresi: en yeni güncelleme açık, öncekiler altta katlı. */
export function WhatsNewDialog({ onClose }: { onClose: () => void }) {
  const { t, lang } = useLang();
  const day = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString(localeOf(lang), { day: "numeric", month: "long", year: "numeric" });
  const [latest, ...older] = WHATS_NEW;
  if (!latest) return null;
  return (
    <Modal
      title={t("whatsNew.title")}
      onClose={onClose}
      width={600}
      footer={
        <Button variant="pri" onClick={onClose}>
          {t("whatsNew.ok")}
        </Button>
      }
    >
      <div className="wn">
        <p className="wn-date">{day(latest.date)}</p>
        <ul className="wn-list">
          {latest.items[lang].map((x) => (
            <li key={x.title}>
              <b>{x.title}</b>
              <span>{x.text}</span>
            </li>
          ))}
        </ul>
        {older.length > 0 && (
          <details className="wn-older">
            <summary>{t("whatsNew.older")}</summary>
            {older.map((r) => (
              <section key={r.id}>
                <p className="wn-date">{day(r.date)}</p>
                <ul className="wn-list">
                  {r.items[lang].map((x) => (
                    <li key={x.title}>
                      <b>{x.title}</b>
                      <span>{x.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </details>
        )}
      </div>
    </Modal>
  );
}
