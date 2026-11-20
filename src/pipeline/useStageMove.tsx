import { useCallback, useState, type ReactNode } from "react";
import { refName, useLang } from "../i18n";
import type { ChangeStageBody, LeadDto, ReferenceDto, StageCodeDto } from "../modules/sales-pipeline/api/dto";
import { useCrm } from "../state/CrmContext";
import { displayCurrency } from "../state/currency";
import { pipelineApi } from "./api";
import { uploadAll } from "./attachments/attachmentApi";
import { FilePicker } from "./attachments/FilePicker";
import { useErrorText } from "./hooks";
import { LostDialog, ProposalDialog, QualifiedDialog, WonDialog, type MoneyValue } from "./StageDialogs";

export interface StageMoveOptions {
  /** Kazanıldı penceresini dolduracak son teklif tutarı (detay sayfası zaman çizelgesinden). */
  lastValue?: (lead: LeadDto) => MoneyValue | null;
}

/**
 * Tek giriş noktası: detay sayfası, Kanban sürükle-bırak ve "Sonraki aşama" düğmesi aynı akışı çağırır.
 * Kural (ileri / ek bilgi) sunucuda; arayüz yalnız gereken pencereyi açar ve sonucu gösterir.
 * En fazla iki tık: 1) hedef aşama, 2) varsa pencere onayı.
 */
export function useStageMove(
  ref: ReferenceDto | null,
  onChanged: (lead: LeadDto) => void,
  opts: StageMoveOptions = {},
) {
  const { t, lang } = useLang();
  const { toast } = useCrm();
  const errText = useErrorText();
  const [pending, setPending] = useState<{ lead: LeadDto; target: StageCodeDto } | null>(null);
  const [saving, setSaving] = useState(false);
  // Aşama penceresinde seçilen dosyalar; aşama değişince lead'e yüklenir (2026-11-19).
  const [files, setFiles] = useState<File[]>([]);

  const submit = useCallback(
    async (lead: LeadDto, body: ChangeStageBody, attach: readonly File[] = []): Promise<boolean> => {
      setSaving(true);
      try {
        const r = await pipelineApi.changeStage(lead.id, body);
        if (attach.length) {
          const failed = await uploadAll(lead.id, attach);
          if (failed.length) toast(t("attach.failed", { names: failed.join(", ") }), { bad: true });
        }
        const name = ref?.stages.find((s) => s.code === body.target);
        toast(t("stage.changed", { stage: name ? refName(lang, "stage", name) : body.target }), {
          action: {
            label: t("stage.undo"),
            run: () =>
              pipelineApi
                .undo(lead.id)
                .then((u) => {
                  toast(t("stage.undone"));
                  onChanged(u.lead);
                })
                .catch((e) => toast(errText(e), { bad: true })),
          },
        });
        if (r.followUp) toast(t("activity.followUp"));
        onChanged(r.lead);
        return true;
      } catch (e) {
        toast(errText(e), { bad: true });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [ref, t, lang, toast, errText, onChanged],
  );

  const move = useCallback(
    (lead: LeadDto, target: StageCodeDto) => {
      if (lead.currentStage === target) return;
      if (target === "QUALIFIED" || target === "PROPOSAL" || target === "WON" || target === "LOST") {
        setFiles([]);
        setPending({ lead, target });
      } else void submit(lead, { target });
    },
    [submit],
  );

  let dialog: ReactNode = null;
  if (pending && ref) {
    const close = () => setPending(null);
    const confirm = async (body: ChangeStageBody) => {
      if (await submit(pending.lead, body, files)) close();
    };
    // İlk sıradaki para birimi pencerenin varsayılanıdır: lead'in çalışma para birimi, yoksa görünüm para birimi.
    const first = pending.lead.currency || displayCurrency();
    const currencies = [first, ...ref.currencies.filter((c) => c !== first)];
    const extra = <FilePicker files={files} onChange={setFiles} rules={ref.attachments} disabled={saving} />;
    if (pending.target === "QUALIFIED")
      dialog = (
        <QualifiedDialog
          questions={ref.qualificationQuestions}
          currencies={currencies}
          saving={saving}
          extra={extra}
          onCancel={close}
          onConfirm={confirm}
        />
      );
    else if (pending.target === "PROPOSAL")
      dialog = (
        <ProposalDialog currencies={currencies} saving={saving} extra={extra} onCancel={close} onConfirm={confirm} />
      );
    else if (pending.target === "WON")
      dialog = (
        <WonDialog
          currencies={currencies}
          initial={opts.lastValue?.(pending.lead) ?? null}
          saving={saving}
          extra={extra}
          onCancel={close}
          onConfirm={confirm}
        />
      );
    else
      dialog = (
        <LostDialog reasons={ref.lostReasons} saving={saving} extra={extra} onCancel={close} onConfirm={confirm} />
      );
  }

  return { move, dialog, saving };
}
