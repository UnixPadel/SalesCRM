/**
 * Kod birlikleri (Faz 7g ayrımı): `dto.ts`, `dto.tracking.ts` ve `dto.contact.ts` buradan alır; döngüsel içe aktarma
 * olmasın diye yaprak dosyadır.
 */
export type StageCodeDto = "NEW" | "CONTACTED" | "QUALIFIED" | "PROPOSAL" | "WON" | "LOST";
export type LeadSourceDto = "meta_form" | "google_form" | "web_form" | "manual" | "import";
export type StageEventOriginDto = "manual" | "auto_fill" | "system";
export type ActivityTypeDto = "call" | "email" | "whatsapp" | "meeting" | "proposal_sent" | "site_visit" | "other";
/** Temas sonucu (Faz 7g). */
export type ActivityOutcomeDto =
  "reply_received" | "awaiting_reply" | "proposal_sent" | "follow_up" | "negative" | "agreed";
