import { useCallback, useState, type ReactNode } from "react";
import { useLang } from "../i18n";
import type { ChangeStageBody, LeadDto, ReferenceDto, StageCodeDto } from "../modules/sales-pipeline/api/dto";
import { useCrm } from "../state/CrmContext";
import { pipelineApi } from "./api";
import { useErrorText } from "./hooks";
import { LostDialog, QualifiedDialog, WonDialog } from "./StageDialogs";

/**
 * Tek giriş noktası: detay sayfası, Kanban sürükle-bırak ve "Sonraki aşama" düğmesi aynı akışı çağırır.
 * Kural (ileri / ek bilgi) sunucuda; arayüz yalnız gereken pencereyi açar ve sonucu gösterir.
 * En fazla iki tık: 1) hedef aşama, 2) varsa pencere onayı.
 */
export function useStageMove(ref: ReferenceDto | null, onChanged: (lead: LeadDto) => void) {
  const { t } = useLang();
  const { toast } = useCrm();
  const errText = useErrorText();
  const [pending, setPending] = useState<{ lead: LeadDto; target: StageCodeDto } | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = useCallback(
    async (lead: LeadDto, body: ChangeStageBody): Promise<boolean> => {
      setSaving(true);
      try {
        const r = await pipelineApi.changeStage(lead.id, body);
        const name = ref?.stages.find((s) => s.code === body.target);
        toast(t("stage.changed", { stage: name ? name.nameTr : body.target }), {
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
        onChanged(r.lead);
        return true;
      } catch (e) {
        toast(errText(e), { bad: true });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [ref, t, toast, errText, onChanged],
  );

  const move = useCallback(
    (lead: LeadDto, target: StageCodeDto) => {
      if (lead.currentStage === target) return;
      if (target === "QUALIFIED" || target === "WON" || target === "LOST") setPending({ lead, target });
      else void submit(lead, { target });
    },
    [submit],
  );

  let dialog: ReactNode = null;
  if (pending && ref) {
    const close = () => setPending(null);
    const confirm = async (body: ChangeStageBody) => {
      if (await submit(pending.lead, body)) close();
    };
    if (pending.target === "QUALIFIED")
      dialog = (
        <QualifiedDialog questions={ref.qualificationQuestions} saving={saving} onCancel={close} onConfirm={confirm} />
      );
    else if (pending.target === "WON")
      dialog = <WonDialog currencies={ref.currencies} saving={saving} onCancel={close} onConfirm={confirm} />;
    else dialog = <LostDialog reasons={ref.lostReasons} saving={saving} onCancel={close} onConfirm={confirm} />;
  }

  return { move, dialog, saving };
}
