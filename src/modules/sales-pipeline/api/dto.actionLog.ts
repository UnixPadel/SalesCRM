/** İşlem günlüğü (Yönetim > Loglar, 2026-11-20). `ActionTypeDto` application `ACTION_TYPES` ile aynıdır. */
export type ActionTypeDto =
  | "lead.created"
  | "lead.assigned"
  | "lead.fields_updated"
  | "lead.status_changed"
  | "stage.changed"
  | "stage.undone"
  | "contact.logged"
  | "contact.undone"
  | "activity.planned"
  | "activity.done"
  | "activity.reopened"
  | "activity.deleted"
  | "attachment.added"
  | "attachment.deleted";

export interface ActionLogDto {
  id: string;
  occurredAt: string;
  actorUserId: string;
  action: ActionTypeDto;
  /** Lead silindiyse null. */
  leadId: string | null;
  leadName: string;
  /** İşleme göre: {from,to} · {fields:[…]} · {status} · {type,outcome} · {fileName,image}. */
  details: Record<string, unknown>;
}

export interface ActionLogPageDto {
  items: ActionLogDto[];
  /** Sonraki sayfanın `before` değeri; yoksa null. */
  next: string | null;
  /** Günlükte kaydı olan kullanıcı kimlikleri (süzgeç). */
  actors: string[];
}
