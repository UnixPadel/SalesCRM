import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Icon, Modal, StatusTag } from "../../components/ui";
import { useLang } from "../../i18n";

/** Yönetim panelinin paylaşılan küçük parçaları: onay penceresi, sağlayıcı adı, gizli anahtar listesi, veri yükleyici. */

export function useProviderName() {
  const { t } = useLang();
  return useCallback(
    (provider: string) => {
      const key = `admin.provider.${provider}`;
      const name = t(key);
      return name === key ? provider : name;
    },
    [t],
  );
}

/** Geri dönüşü zor işlemler için onay; birincil düğme ne olacağını söyler ("Gönderimi durdur", "Kuralı kaldır"). */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("admin.cancel")}
          </Button>
          <Button variant={danger ? "danger" : "pri"} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="adm-confirm">{children}</p>
    </Modal>
  );
}

/** Gizli anahtarlar: yalnız ortam değişkeninin adı ve tanımlı olup olmadığı (değer hiç gelmez). */
export function SecretList({ secrets }: { secrets: readonly { name: string; set: boolean }[] }) {
  const { t } = useLang();
  if (!secrets.length) return <span className="muted">{t("admin.none")}</span>;
  return (
    <ul className="adm-secrets">
      {secrets.map((s) => (
        <li key={s.name}>
          <code>{s.name}</code>
          <StatusTag tone={s.set ? "ok" : "neutral"} icon={s.set ? "check" : "lock"}>
            {t(s.set ? "health.secret.set" : "health.secret.missing")}
          </StatusTag>
        </li>
      ))}
    </ul>
  );
}

/** Bölüm başlığı: başlık + kısa açıklama + sağda eylem. */
export function SectionHead({ title, help, children }: { title: string; help?: string; children?: ReactNode }) {
  return (
    <div className="adm-head">
      <div>
        <h2>{title}</h2>
        {help && <p className="muted">{help}</p>}
      </div>
      {children && <div className="adm-head-end">{children}</div>}
    </div>
  );
}

/** Yükleme hatası satırı: ne olduğu + yeniden dene. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useLang();
  return (
    <div className="adm-error" role="alert">
      <Icon name="warn" size={16} />
      <span>{message}</span>
      <Button size="sm" onClick={onRetry}>
        {t("admin.refresh")}
      </Button>
    </div>
  );
}

/**
 * Veri yükleyici: `load` değişince ve `reload()` çağrılınca yeniden okur; eski yanıt yenisini ezmez. `everyMs`
 * verilirse o aralıkla yeniler (sekme görünürken).
 */
export function useLoad<T>(load: () => Promise<T>, everyMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [at, setAt] = useState<number | null>(null);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current;
    return load()
      .then((d) => {
        if (n !== seq.current) return;
        setData(d);
        setError(null);
        setAt(Date.now());
      })
      .catch((e: unknown) => {
        if (n === seq.current) setError(e);
      });
  }, [load]);
  useEffect(() => {
    void reload();
    if (!everyMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, everyMs);
    return () => clearInterval(id);
  }, [reload, everyMs]);
  return { data, error, at, reload, setData };
}
