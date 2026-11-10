import { useState } from "react";
import { Button, Icon } from "../../components/ui";
import { useLang } from "../../i18n";
import type { ActivityOutcomeDto, ActivityTypeDto } from "../../modules/sales-pipeline/api/dto";

type Kind = "whatsapp" | "email" | "call";

/**
 * Telefon / WhatsApp / e-posta bağlantıları ve tıklanınca altta kalan, modal olmayan kayıt çubuğu (iş emri §5.2,
 * [U-I6]): mesajı gönderen satışçı tek dokunuşla kaydeder, Excel'de ✔ koymak gibi. Bildirim değildir, kaybolmaz.
 */
export function ContactLinks({
  phone,
  email,
  canLog,
  onQuick,
  onDetails,
  compact = false,
}: {
  phone: string | null;
  email: string | null;
  canLog: boolean;
  onQuick: (type: ActivityTypeDto, outcome: ActivityOutcomeDto) => Promise<void> | void;
  onDetails: (type: ActivityTypeDto, outcome: ActivityOutcomeDto) => void;
  compact?: boolean;
}) {
  const { t } = useLang();
  const [bar, setBar] = useState<Kind | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = (k: Kind) => canLog && setBar(k);
  const run = async (type: ActivityTypeDto, outcome: ActivityOutcomeDto) => {
    setBusy(true);
    try {
      await onQuick(type, outcome);
      setBar(null);
    } finally {
      setBusy(false);
    }
  };
  const wa = phone ? `https://wa.me/${phone.replace(/\D/g, "")}` : null;

  return (
    <div className={"qlinks" + (compact ? " compact" : "")}>
      <div className="qlinks-row">
        {phone ? (
          <>
            <a className="qlink" href={wa!} target="_blank" rel="noreferrer" onClick={() => pick("whatsapp")}>
              <Icon name="chat" size={16} /> <span>{compact ? "WhatsApp" : phone}</span>
            </a>
            <a className="qlink" href={`tel:${phone}`} onClick={() => pick("call")}>
              <Icon name="phone" size={16} /> <span>{t("contact.callLink")}</span>
            </a>
          </>
        ) : null}
        {email && (
          <a className="qlink" href={`mailto:${email}`} onClick={() => pick("email")}>
            <Icon name="mail" size={16} /> <span>{compact ? t("summary.email") : email}</span>
          </a>
        )}
        {!phone && !email && <span className="muted">—</span>}
      </div>
      {bar && (
        <div className="qbar" role="group" aria-label={t("contact.log")}>
          {bar === "call" ? (
            <>
              <span>{t("contact.quick.call")}</span>
              <Button size="sm" loading={busy} onClick={() => run("call", "awaiting_reply")}>
                {t("contact.quick.noAnswer")}
              </Button>
              <Button
                size="sm"
                variant="pri"
                onClick={() => {
                  setBar(null);
                  onDetails("call", "reply_received");
                }}
              >
                {t("contact.quick.talked")}
              </Button>
            </>
          ) : (
            <>
              <span>{bar === "whatsapp" ? t("contact.quick.wa") : t("contact.quick.email")}</span>
              <Button size="sm" variant="pri" loading={busy} onClick={() => run(bar, "awaiting_reply")}>
                {t("contact.quick.yes")}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setBar(null);
                  onDetails(bar, "awaiting_reply");
                }}
              >
                {t("contact.quick.details")}
              </Button>
              <button type="button" className="link-btn" onClick={() => setBar(null)}>
                {t("contact.quick.no")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
