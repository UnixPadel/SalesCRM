import { useCallback, useState, type ReactNode } from "react";
import { useLang } from "../../i18n";
import type { ActivityOutcomeDto, ActivityTypeDto } from "../../modules/sales-pipeline/api/dto";
import type { LogContactResultDto } from "../../modules/sales-pipeline/api/dto.contact";
import { useCrm } from "../../state/CrmContext";
import { useErrorText, useReference } from "../hooks";
import { contactApi } from "./contactApi";
import { LogContactDialog, type LogContactOpen } from "./LogContactDialog";

/**
 * Temas kaydını her yerden (lead sayfası, liste satırı, Bugün, pano) aynı biçimde açar ve sonucu tek bildirimle
 * söyler: "Temas kaydedildi · Aşama: … · Takip: … · Lead size atandı [Geri al]". Geri al birleşiktir (temas + aşama).
 */
export function useLogContact(onDone: () => void): {
  openDialog: (o: LogContactOpen) => void;
  quick: (leadId: string, type: ActivityTypeDto, outcome: ActivityOutcomeDto) => Promise<void>;
  undo: (logId: string) => Promise<void>;
  dialog: ReactNode;
} {
  const { toast, user } = useCrm();
  const { t, lang } = useLang();
  const { stageName } = useReference();
  const errText = useErrorText();
  const [open, setOpen] = useState<LogContactOpen | null>(null);

  const undo = useCallback(
    async (logId: string) => {
      try {
        const u = await contactApi.undo(logId);
        if (u.undone) toast(t("contact.undone"));
        onDone();
      } catch (e) {
        toast(errText(e), { bad: true });
      }
    },
    [toast, t, onDone, errText],
  );

  const announce = useCallback(
    (r: LogContactResultDto) => {
      const parts = [t("contact.saved")];
      if (r.stage) parts.push(t("contact.savedStage", { stage: stageName(r.lead.currentStage) }));
      if (r.next) {
        parts.push(
          t("contact.savedNext", {
            when: new Date(r.next.dueAt).toLocaleString(lang === "tr" ? "tr-TR" : "en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            }),
          }),
        );
      }
      if (r.assignedTo && r.assignedTo === user?.id && r.lead.assignedUserId === user.id) {
        parts.push(t("contact.savedAssigned"));
      }
      toast(parts.join(" · "), {
        action: {
          label: t("contact.undo"),
          run: () => {
            contactApi
              .undo(r.logId)
              .then((u) => {
                toast(r.stage && !u.stageUndone ? t("contact.undoneNoStage") : t("contact.undone"));
                onDone();
              })
              .catch((e) => toast(errText(e), { bad: true }));
          },
        },
      });
    },
    [t, lang, stageName, toast, user, onDone, errText],
  );

  const quick = useCallback(
    async (leadId: string, type: ActivityTypeDto, outcome: ActivityOutcomeDto) => {
      try {
        const r = await contactApi.log(leadId, { type, outcome, quick: true });
        announce(r);
        onDone();
      } catch (e) {
        toast(errText(e), { bad: true });
      }
    },
    [announce, onDone, toast, errText],
  );

  const dialog = open ? (
    <LogContactDialog
      open={open}
      onClose={() => setOpen(null)}
      onSaved={(r) => {
        setOpen(null);
        announce(r);
        onDone();
      }}
    />
  ) : null;

  return { openDialog: setOpen, quick, undo, dialog };
}
