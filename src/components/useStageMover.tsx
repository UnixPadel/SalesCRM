import { useState } from "react";
import { LOST_REASONS, STAGE } from "../domain/constants";
import type { ID, StageKey } from "../domain/types";
import { assignDeal, moveDealToStage, undoStageMove, type StageSnapshot } from "../services/crmService";
import { useCrm } from "../state/CrmContext";
import { Button, Field, fmtDate, Modal } from "./ui";

/**
 * Single entry point for stage moves from any screen.
 * Moves to the red line are parked until the user supplies a reason (rule 3).
 * Every completed move gets an "Undo" toast action (forgiving UI).
 */
export function useStageMover() {
  const { run, data } = useCrm();
  const [pending, setPending] = useState<{ dealId: ID; title: string; owner?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  /** `owner` (optional) hands the customer to another rep in the same step; undo restores both. */
  const doMove = async (dealId: ID, to: StageKey, lostReason?: string, owner?: string) => {
    const deal = data.deals.find((d) => d.id === dealId);
    if (!deal) return undefined;
    const prev: StageSnapshot = {
      stage: deal.stage,
      stage_entered_at: deal.stage_entered_at,
      won_at: deal.won_at,
      lost_at: deal.lost_at,
      lost_reason: deal.lost_reason,
    };
    const prevOwner = deal.owner;
    const handover = owner !== undefined && owner !== prevOwner;
    return run(
      async (repo) => {
        if (handover) await assignDeal(repo, dealId, owner);
        return moveDealToStage(repo, dealId, to, { lostReason });
      },
      (r) => ({
        msg:
          (r.followUp
            ? `${STAGE[to].label} — takip araması ${fmtDate(r.followUp.due_at)} için planlandı`
            : `${deal.title} → ${STAGE[to].no}. ${STAGE[to].label}`) +
          (handover ? ` · sorumlu: ${owner || "ortak havuz"}` : ""),
        action: {
          label: "Geri al",
          run: () =>
            run(async (repo) => {
              await undoStageMove(repo, dealId, prev, r.followUp?.id);
              if (handover) await assignDeal(repo, dealId, prevOwner);
            }, `${STAGE[prev.stage].label} aşamasına geri alındı`),
        },
      }),
    );
  };

  const move = (dealId: ID, to: StageKey, opts: { owner?: string } = {}) => {
    const deal = data.deals.find((d) => d.id === dealId);
    if (!deal || deal.stage === to) return;
    if (to === "lost") setPending({ dealId, title: deal.title, owner: opts.owner });
    else doMove(dealId, to, undefined, opts.owner);
  };

  const dialog = pending ? (
    <LostReasonDialog
      title={pending.title}
      saving={saving}
      onCancel={() => setPending(null)}
      onConfirm={async (reason) => {
        setSaving(true);
        const ok = await doMove(pending.dealId, "lost", reason, pending.owner);
        setSaving(false);
        if (ok) setPending(null);
      }}
    />
  ) : null;

  return { move, dialog };
}

function LostReasonDialog({
  title,
  saving,
  onCancel,
  onConfirm,
}: {
  title: string;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [preset, setPreset] = useState("");
  const [detail, setDetail] = useState("");
  const [tried, setTried] = useState(false);
  const reason = [preset, detail.trim()].filter(Boolean).join(" — ");
  const error = tried && !reason ? "Bir neden seçin ya da açıklama yazın." : "";

  return (
    <Modal
      title="Red line'a taşı"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Vazgeç</Button>
          <Button
            variant="danger"
            loading={saving}
            onClick={() => {
              setTried(true);
              if (reason) onConfirm(reason);
            }}
          >
            Red line'a taşı
          </Button>
        </>
      }
    >
      <p className="lede">
        <strong>{title}</strong> olumsuz sonuçlandı. Neden belirtmek zorunlu; kartın üstünde görünür ve raporlardaki
        analiz bu alandan beslenir.
      </p>
      <fieldset className="reason-list" aria-describedby={error ? "lost-err" : undefined}>
        <legend className="field-l">Neden</legend>
        {LOST_REASONS.map((r) => (
          <label key={r} className={"reason" + (preset === r ? " on" : "")}>
            <input type="radio" name="lost-reason" checked={preset === r} onChange={() => setPreset(r)} />
            {r}
          </label>
        ))}
      </fieldset>
      <Field label={preset ? "Açıklama (isteğe bağlı)" : "Açıklama"} error={error} errorId="lost-err">
        <textarea
          rows={3}
          value={detail}
          placeholder="Ör. yerel üretici %12 daha ucuz teklif verdi"
          onChange={(e) => setDetail(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
