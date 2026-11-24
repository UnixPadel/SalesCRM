import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button, Modal } from "../components/ui";
import { refName, useLang } from "../i18n";
import type {
  ActivityTypeDto,
  ChangeStageBody,
  LeadDto,
  LeadListDto,
  ReferenceDto,
  StageCodeDto,
} from "../modules/sales-pipeline/api/dto";
import { useCrm } from "../state/CrmContext";
import { displayCurrency } from "../state/currency";
import { PipelineError, pipelineApi } from "./api";
import { uploadAll } from "./attachments/attachmentApi";
import { FilePicker } from "./attachments/FilePicker";
import { stageEvidenceRule } from "./contact/dialogState";
import { useErrorText } from "./hooks";
import {
  ContactedDialog,
  LostDialog,
  ProposalDialog,
  QualifiedDialog,
  StageContactFields,
  WonDialog,
  type MoneyValue,
} from "./StageDialogs";

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
  // `needContact`: lead'in temas kaydı yok ve hedef aşama temas gerektiriyor (aşama kapısı); pencere kanal ve tarih sorar.
  const [pending, setPending] = useState<{ lead: LeadDto; target: StageCodeDto; needContact: boolean } | null>(null);
  const [contact, setContact] = useState<{ type: ActivityTypeDto; at: string | null }>({ type: "call", at: null });
  const [saving, setSaving] = useState(false);
  // Aşama penceresinde seçilen dosyalar; aşama değişince lead'e yüklenir (2026-11-19). Dosya zorunluluğu
  // `stageEvidenceRule` (2026-11-24): Nitelikli / Teklif / Kazanıldı / Kaybedildi'de zorunlu; aşama kapısında
  // "İletişim kuruldu"ya geçiş temas gibi sayılır (yalnız WhatsApp ve telefonda zorunlu).
  const [files, setFiles] = useState<File[]>([]);
  const [fileTried, setFileTried] = useState(false);
  const fileBtn = useRef<HTMLButtonElement>(null);
  // Yönetici geri çekmesi (2026-11-24): onay penceresi; ek bilgi istenmez.
  const [back, setBack] = useState<{ lead: LeadDto; target: StageCodeDto } | null>(null);

  const submit = useCallback(
    async (lead: LeadDto, body: ChangeStageBody, attach: readonly File[] = []): Promise<boolean> => {
      setSaving(true);
      try {
        const r = await pipelineApi.changeStage(lead.id, body);
        if (attach.length) {
          const failed = await uploadAll(lead.id, attach);
          if (failed.length) toast(t("attach.failedSaved", { names: failed.join(", ") }), { bad: true });
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
        // Liste satırı eskimiş olabilir: sunucu temas istiyorsa aynı pencere kanal ve tarih alanlarıyla açılır.
        if (e instanceof PipelineError && e.code === "stage.contact_required" && !body.contact) {
          setPending({ lead, target: body.target, needContact: true });
        }
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
      // Detay ve liste satırı temas özetini taşır; taşımayan çağrıda kararı sunucu verir (`stage.contact_required`).
      const needContact =
        (ref?.contactStages ?? []).includes(target) && (lead as Partial<LeadListDto>).contact?.count === 0;
      if (needContact || target === "QUALIFIED" || target === "PROPOSAL" || target === "WON" || target === "LOST") {
        setFiles([]);
        setFileTried(false);
        setContact({ type: "call", at: null });
        setPending({ lead, target, needContact });
      } else void submit(lead, { target });
    },
    [submit, ref],
  );

  const stageName = (code: StageCodeDto) => {
    const s = ref?.stages.find((x) => x.code === code);
    return s ? refName(lang, "stage", s) : code;
  };

  /** Yalnız yönetici: lead'i daha önce geçtiği bir aşamaya geri çeker (sunucu aynı kuralı uygular). */
  const rollback = useCallback((lead: LeadDto, target: StageCodeDto) => {
    if (lead.currentStage !== target) setBack({ lead, target });
  }, []);

  const confirmRollback = async () => {
    if (!back) return;
    setSaving(true);
    try {
      const r = await pipelineApi.changeStage(back.lead.id, { target: back.target });
      toast(t("stage.rollback.done", { stage: stageName(back.target) }));
      setBack(null);
      onChanged(r.lead);
    } catch (e) {
      toast(errText(e), { bad: true });
    } finally {
      setSaving(false);
    }
  };

  let dialog: ReactNode = null;
  if (back) {
    dialog = (
      <Modal title={t("stage.rollback.title")} onClose={() => setBack(null)} width={440}>
        <p>
          {t("stage.rollback.text", {
            lead: back.lead.fullName,
            from: stageName(back.lead.currentStage),
            to: stageName(back.target),
          })}
        </p>
        <div className="modal-actions">
          <Button onClick={() => setBack(null)}>{t("common.cancel")}</Button>
          <Button variant="pri" loading={saving} onClick={() => void confirmRollback()}>
            {t("stage.rollback.confirm")}
          </Button>
        </div>
      </Modal>
    );
  } else if (pending && ref) {
    const close = () => setPending(null);
    const evidence = stageEvidenceRule(contact.type, pending.target);
    const missingFile = evidence.required && !files.length;
    // Gereken dosya yoksa gönderilmez: hata kutuda görünür, odak "Dosya seç" düğmesine gider.
    const tryFile = () => {
      setFileTried(true);
      if (missingFile) {
        fileBtn.current?.scrollIntoView({ block: "nearest" });
        fileBtn.current?.focus();
      }
    };
    const confirm = async (body: ChangeStageBody) => {
      tryFile();
      if (missingFile) return;
      const full: ChangeStageBody = pending.needContact
        ? {
            ...body,
            contact: { type: contact.type, occurredAt: contact.at ? new Date(contact.at).toISOString() : null },
          }
        : body;
      // Sunucu temas isterse `submit` pencereyi alanlarla yeniden açar; o zaman kapatılmaz.
      if (await submit(pending.lead, full, files)) close();
    };
    const contactFields = pending.needContact ? (
      <StageContactFields channels={ref.contactChannels} value={contact} disabled={saving} onChange={setContact} />
    ) : null;
    // İlk sıradaki para birimi pencerenin varsayılanıdır: lead'in çalışma para birimi, yoksa görünüm para birimi.
    const first = pending.lead.currency || displayCurrency();
    const currencies = [first, ...ref.currencies.filter((c) => c !== first)];
    const picker = (
      <FilePicker
        files={files}
        onChange={setFiles}
        rules={ref.attachments}
        disabled={saving}
        boxed
        required={evidence.required}
        purpose={t(evidence.purposeKey)}
        showError={fileTried}
        buttonRef={fileBtn}
      />
    );
    const extra = (
      <>
        {contactFields}
        {picker}
      </>
    );
    if (pending.target === "CONTACTED")
      dialog = (
        <ContactedDialog saving={saving} onCancel={close} onConfirm={() => void confirm({ target: "CONTACTED" })}>
          {contactFields}
          {picker}
        </ContactedDialog>
      );
    else if (pending.target === "QUALIFIED")
      dialog = (
        <QualifiedDialog
          questions={ref.qualificationQuestions}
          currencies={currencies}
          saving={saving}
          extra={extra}
          onTry={tryFile}
          onCancel={close}
          onConfirm={confirm}
        />
      );
    else if (pending.target === "PROPOSAL")
      dialog = (
        <ProposalDialog
          currencies={currencies}
          saving={saving}
          extra={extra}
          onTry={tryFile}
          onCancel={close}
          onConfirm={confirm}
        />
      );
    else if (pending.target === "WON")
      dialog = (
        <WonDialog
          currencies={currencies}
          initial={opts.lastValue?.(pending.lead) ?? null}
          saving={saving}
          extra={extra}
          onTry={tryFile}
          onCancel={close}
          onConfirm={confirm}
        />
      );
    else
      dialog = (
        <LostDialog
          reasons={ref.lostReasons}
          saving={saving}
          extra={extra}
          onTry={tryFile}
          onCancel={close}
          onConfirm={confirm}
        />
      );
  }

  return { move, rollback, dialog, saving };
}
