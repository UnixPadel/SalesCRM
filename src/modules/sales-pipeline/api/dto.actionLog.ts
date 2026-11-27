/**
 * İşlem günlüğü (Yönetim > Loglar, 2026-11-20; 2026-11-27 bütün işlemler, yalnız ekleme). `ActionTypeDto`,
 * `TargetTypeDto` ve `ActionResultDto` application katmanındaki `ACTION_TYPES` / `TARGET_TYPES` / `ACTION_RESULTS`
 * ile aynıdır (actionLog.api.test.ts denetler).
 */
export type ActionTypeDto =
  | "lead.created"
  | "lead.assigned"
  | "lead.fields_updated"
  | "lead.status_changed"
  | "stage.changed"
  | "stage.undone"
  | "contact.logged"
  | "contact.undone"
  | "contact.deleted"
  | "contact.updated"
  | "activity.planned"
  | "activity.updated"
  | "activity.done"
  | "activity.reopened"
  | "activity.deleted"
  | "attachment.added"
  | "attachment.deleted"
  | "lead.deleted"
  | "lead.restored"
  | "warning.checked"
  | "warning.unchecked"
  | "organization.created"
  | "organization.updated"
  | "organization.archived"
  | "organization.unarchived"
  | "person.merged"
  | "territory.updated"
  | "territory.deleted"
  | "territory.applied_to_pool"
  | "territory.reassigned"
  | "product_catalog.imported"
  | "settings.updated"
  | "stage_mapping.updated"
  | "field_mapping.updated"
  | "field_mapping.deleted"
  | "fx_rates.updated"
  | "fx_rates.refreshed"
  | "outbox.requeued"
  | "inbox.requeued"
  | "provider.outbound_updated"
  | "checkpoint.restored"
  | "sheet_sync.run"
  | "st_customer_sync.run"
  | "mail_stats.run"
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "request.other";

export type TargetTypeDto =
  | "lead"
  | "organization"
  | "person"
  | "territory"
  | "product_catalog"
  | "settings"
  | "mapping"
  | "fx_rates"
  | "queue"
  | "checkpoint"
  | "sync"
  | "session"
  | "request";

/** ok · denied (yetki yok) · rejected (geçersiz istek) · error (sunucu hatası). */
export type ActionResultDto = "ok" | "denied" | "rejected" | "error";

export interface ActionLogDto {
  id: string;
  occurredAt: string;
  actorUserId: string;
  action: ActionTypeDto;
  /** Lead işlemi değilse ya da kimlik geçersizse null. */
  leadId: string | null;
  leadName: string;
  targetType: TargetTypeDto;
  targetId: string | null;
  /** O anki görünen ad (lead adı, ülke kodu, sağlayıcı…). */
  targetLabel: string;
  result: ActionResultDto;
  /**
   * İşleme göre: {from,to} · {fields:[…], changes?} · {status} · {type,outcome} · {fileName,image} ·
   * {method,path,status} (HTTP katmanı). Kişisel veri değeri taşımaz.
   */
  details: Record<string, unknown>;
}

export interface ActionLogPageDto {
  items: ActionLogDto[];
  /** Sonraki sayfanın `before` değeri; yoksa null. */
  next: string | null;
  /** Günlükte kaydı olan kullanıcı kimlikleri (süzgeç). */
  actors: string[];
}
