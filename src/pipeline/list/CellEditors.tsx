import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { Button, Modal } from "../../components/ui";
import { useLang } from "../../i18n";
import type {
  ActivityOutcomeDto,
  ActivityTypeDto,
  LeadDto,
  LeadListDto,
  ProductPrefsDto,
  StageCodeDto,
} from "../../modules/sales-pipeline/api/dto";
import { useCrm } from "../../state/CrmContext";
import { AddActivityForm } from "../activityBits";
import { pipelineApi } from "../api";
import { ProductPrefsForm, WarningsPanel } from "../contact/LeadSections";
import type { LogContactOpen } from "../contact/LogContactDialog";
import { useLogContact } from "../contact/useLogContact";
import { useErrorText, useReference } from "../hooks";
import { LeadContactForm } from "../LeadContactForm";
import { LeadFieldsForm } from "../LeadFieldsForm";
import { useStageMove } from "../useStageMove";
import type { CellForm } from "./cellEdit";

export interface CellEditorsApi {
  log: (o: LogContactOpen) => void;
  quick: (leadId: string, type: ActivityTypeDto, outcome: ActivityOutcomeDto) => Promise<void>;
  moveStage: (lead: LeadListDto, target: StageCodeDto) => void;
  form: (form: CellForm, leadId: string) => void;
}

type OnChanged = (leadId?: string, lead?: LeadDto) => void;

const TITLE: Record<CellForm, string> = {
  note: "lead.editNotes",
  products: "product.title",
  contact: "lead.editContact",
  plan: "activity.add",
  warnings: "list.col.warn",
};

/**
 * Hücrelerin açtığı pencereler. Durum burada tutulur, sayfa ref ile çağırır: pencere açmak bütün tabloyu ve sütun
 * sayaçlarını yeniden hesaplatmaz. Formlar lead'i sunucudan taze okur; not ve ürünler bütün olarak yazıldığı için
 * listedeki eski değerle başkasının değişikliği ezilmesin.
 */
export const CellEditors = forwardRef<CellEditorsApi, { onChanged: OnChanged }>(function CellEditors(
  { onChanged },
  apiRef,
) {
  const { toast } = useCrm();
  const { ref } = useReference();
  const errText = useErrorText();
  const contact = useLogContact(onChanged);
  const { move, dialog: stageDialog } = useStageMove(ref, (l) => onChanged(l.id, l), {
    // Kazanıldı penceresi son teklif tutarıyla açılır; aşama hücresi her zaman liste satırı verir.
    lastValue: (l) => (l as LeadListDto).value,
  });
  const [editor, setEditor] = useState<{ form: CellForm; lead: LeadListDto } | null>(null);
  const seq = useRef(0);

  const openForm = useCallback(
    (form: CellForm, leadId: string) => {
      const n = ++seq.current;
      pipelineApi
        .get(leadId)
        .then((d) => n === seq.current && setEditor({ form, lead: d.lead }))
        .catch((e) => toast(errText(e), { bad: true }));
    },
    [toast, errText],
  );

  const { openDialog, quick } = contact;
  useImperativeHandle(
    apiRef,
    () => ({
      log: openDialog,
      quick,
      form: openForm,
      moveStage: (lead, target) => {
        // Panodaki kural: lead "İletişim kuruldu"ya geçerken iletişim penceresi açılır (görüşme notu zorunlu).
        if (lead.currentStage === "NEW" && target === "CONTACTED") {
          openDialog({
            leadId: lead.id,
            leadName: lead.fullName,
            outcome: "reply_received",
          });
          return;
        }
        move(lead, target);
      },
    }),
    [openDialog, quick, openForm, move],
  );

  return (
    <>
      {contact.dialog}
      {stageDialog}
      {editor && (
        <FormEditor
          key={`${editor.form}:${editor.lead.id}`}
          form={editor.form}
          lead={editor.lead}
          onClose={() => setEditor(null)}
          onChanged={onChanged}
          onRefresh={() => openForm(editor.form, editor.lead.id)}
        />
      )}
    </>
  );
});

function FormEditor({
  form,
  lead,
  onClose,
  onChanged,
  onRefresh,
}: {
  form: CellForm;
  lead: LeadListDto;
  onClose: () => void;
  onChanged: OnChanged;
  onRefresh: () => void;
}) {
  const { t } = useLang();
  const dirty = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const markDirty = () => {
    dirty.current = true;
  };
  const requestClose = () => (dirty.current ? setConfirming(true) : onClose());
  const saved = (l: LeadDto) => {
    onClose();
    onChanged(l.id, l);
  };

  return (
    <Modal title={t(TITLE[form])} onClose={requestClose}>
      <p className="cd-sub">{lead.fullName}</p>
      <div onChange={markDirty}>
        {form === "note" && <LeadFieldsForm lead={lead} notesOnly hideHint onSaved={saved} onCancel={requestClose} />}
        {form === "contact" && <LeadContactForm lead={lead} onSaved={saved} onCancel={requestClose} />}
        {form === "plan" && (
          <AddActivityForm
            leadId={lead.id}
            startOpen
            onCancel={requestClose}
            onAdded={() => {
              onClose();
              onChanged(lead.id);
            }}
          />
        )}
        {form === "products" && (
          <ProductsEditor lead={lead} onDirty={markDirty} onSaved={saved} onCancel={requestClose} />
        )}
        {form === "warnings" && (
          <WarningsPanel
            lead={lead}
            onChanged={(l) => {
              onChanged(l.id, l);
              onRefresh();
            }}
          />
        )}
      </div>
      {confirming && (
        <div className="cd-confirm" role="alertdialog" aria-label={t("list.cell.discard")}>
          <p>{t("list.cell.discard")}</p>
          <Button variant="pri" autoFocus onClick={() => setConfirming(false)}>
            {t("contact.keepEditing")}
          </Button>
          <Button onClick={onClose}>{t("common.close")}</Button>
        </div>
      )}
    </Modal>
  );
}

function ProductsEditor({
  lead,
  onDirty,
  onSaved,
  onCancel,
}: {
  lead: LeadListDto;
  onDirty: () => void;
  onSaved: (l: LeadDto) => void;
  onCancel: () => void;
}) {
  const { t } = useLang();
  const { toast } = useCrm();
  const errText = useErrorText();
  const [draft, setDraft] = useState<ProductPrefsDto>(() => structuredClone(lead.products));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const l = await pipelineApi.update(lead.id, { products: draft });
      toast(t("product.saved"));
      onSaved(l);
    } catch (e) {
      toast(errText(e), { bad: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ProductPrefsForm
        value={draft}
        onChange={(p) => {
          onDirty();
          setDraft(p);
        }}
      />
      <div className="form-actions">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button variant="pri" loading={busy} onClick={save}>
          {t("common.save")}
        </Button>
      </div>
    </>
  );
}
