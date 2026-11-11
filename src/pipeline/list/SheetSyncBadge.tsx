/**
 * Form tablosu göstergesi (yönetici, Lead listesi; 2026-11-11): son eşitleme zamanı, hata ve "Şimdi eşitle".
 * Durum dakikada bir okunur; zamanlanmış koşu yeni kayıt getirdiyse liste kendiliğinden yenilenir. Eşitleme
 * kapalıysa (sunucuda `SHEET_SYNC_CSV_URL` yok) hiçbir şey çizilmez. Tablo adresi istemciye hiç gelmez.
 */
import { useEffect, useRef, useState } from "react";
import { Icon, IconButton, StatusTag } from "../../components/ui";
import { api } from "../../data/api";
import { useLang } from "../../i18n";
import { useCrm } from "../../state/CrmContext";
import { useSince } from "../hooks";

/** `GET /api/sheet-sync` yanıtı (sunucu: `SheetSyncStatus`). */
interface SheetSyncStatusDto {
  enabled: boolean;
  running?: boolean;
  lastOkAt?: string | null;
  lastError?: string | null;
  lastReport?: { created: number; changes: number } | null;
}

export function SheetSyncBadge({ now, onSynced }: { now: number; onSynced: () => void }) {
  const { t } = useLang();
  const { toast } = useCrm();
  const since = useSince();
  const [st, setSt] = useState<SheetSyncStatusDto | null>(null);
  const [busy, setBusy] = useState(false);
  const lastOk = useRef<string | null | undefined>(undefined);
  const synced = useRef(onSynced);
  useEffect(() => {
    synced.current = onSynced;
  }, [onSynced]);

  useEffect(() => {
    let alive = true;
    const read = () =>
      api<SheetSyncStatusDto>("GET", "/api/sheet-sync")
        .then((s) => {
          if (!alive) return;
          const prev = lastOk.current;
          lastOk.current = s.lastOkAt ?? null;
          setSt(s);
          if (prev !== undefined && s.lastOkAt && s.lastOkAt !== prev && (s.lastReport?.changes ?? 0) > 0)
            synced.current();
        })
        .catch(() => {});
    void read();
    const id = setInterval(read, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!st?.enabled) return null;

  const run = async () => {
    setBusy(true);
    try {
      const s = await api<SheetSyncStatusDto>("POST", "/api/sheet-sync/run");
      lastOk.current = s.lastOkAt ?? null;
      setSt(s);
      if (s.lastError) toast(t("sheet.failed"), { bad: true });
      else {
        const n = s.lastReport?.created ?? 0;
        toast(n ? t("sheet.doneNew", { n }) : t("sheet.doneNone"));
        if (s.lastReport?.changes) onSynced();
      }
    } catch {
      toast(t("sheet.failed"), { bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ll-sync">
      {st.lastError ? (
        <StatusTag tone="warn" icon="warn" title={st.lastError}>
          {t("sheet.error")}
        </StatusTag>
      ) : (
        <span className="ll-sync-text">
          <Icon name="file" size={16} />
          {t("sheet.label")} ·{" "}
          {st.lastOkAt ? t("sheet.syncedAgo", { ago: since(st.lastOkAt, now) }) : t("sheet.pending")}
        </span>
      )}
      <IconButton
        icon="refresh"
        label={t("sheet.runNow")}
        onClick={() => void run()}
        disabled={busy || st.running === true}
        aria-busy={busy || undefined}
      />
    </div>
  );
}
