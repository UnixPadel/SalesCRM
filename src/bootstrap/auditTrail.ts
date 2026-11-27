import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type {
  ActionRecorder,
  ActionResult,
  ActionType,
  RecordActionInput,
  TargetType,
} from "../modules/sales-pipeline/application";

/**
 * HTTP denetim izi (2026-11-27): oturumu olan herkesin her yazma isteği (POST / PUT / PATCH / DELETE) işlem günlüğüne
 * bir satır bırakır. Lead işlemleri use-case içinde, işlemle aynı transaction'da ayrıntılı yazılır (`ActionLog.record`);
 * bu katman yalnız onların yazmadığını tamamlar:
 *
 *  - yönetim paneli, kuruluş/kişi, elle başlatılan aktarımlar (use-case'i günlük yazmayan uçlar) → başarılıysa da;
 *  - reddedilen ya da hata veren her istek (403 yetki yok, 4xx geçersiz, 5xx hata) → lead uçları dahil;
 *  - tabloda olmayan yeni bir yazma ucu → `request.other` (yöntem + yol), ki hiçbir hareket kayıtsız kalmasın.
 *
 * İstek gövdesinden yalnız alan adları ve kişisel olmayan değerler (ülke kodu, sorumlu kimliği, adet) alınır; ayar
 * değerleri, şifre, dosya içeriği, telefon / e-posta hiçbir zaman yazılmaz. Önizleme (`dryRun`) istekleri bir şey
 * değiştirmediği için yazılmaz. Giriş / çıkış `server/index.mjs` içinde açıkça yazılır (`record`).
 */

interface AuditContext {
  recorded: boolean;
}
const requestAudit = new AsyncLocalStorage<AuditContext>();

/** `ActionLog` her başarılı kayıttan sonra çağırır: bu istek için ayrıca genel satır gerekmez. */
export const markRecorded = (): void => {
  const ctx = requestAudit.getStore();
  if (ctx) ctx.recorded = true;
};

type Body = Record<string, unknown>;

interface Route {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  /** `/api` sonrası yol; `:ad` parçaları yakalanır. */
  pattern: string;
  action: ActionType;
  /** Use-case başarıda kendisi yazar; bu katman yalnız başarısız isteği yazar. */
  domain?: boolean;
  /** Gövdede `dryRun !== false` ise önizlemedir, yazılmaz. */
  dryRun?: boolean;
  /** Günlüğe girmeyen uçlar (okundu işareti, push aboneliği…). */
  skip?: boolean;
  target?: (
    p: Record<string, string>,
    body: Body,
  ) => { type: TargetType; id?: string | null | undefined; label?: string | undefined };
  details?: (p: Record<string, string>, body: Body) => Record<string, unknown>;
}

const lead = (p: Record<string, string>) => ({ type: "lead" as const, id: p["id"] ?? null });
const keys = (b: Body) => Object.keys(b).filter((k) => k !== "dryRun");
const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
const provider = (p: Record<string, string>) => ({
  type: "settings" as const,
  id: p["provider"],
  label: p["provider"],
});

/** Yazma uçlarının işlem karşılığı. Yeni bir uç eklenince buraya da yazılır (yazılmazsa `request.other` olur). */
export const AUDIT_ROUTES: readonly Route[] = [
  // ---- lead (use-case aynı transaction'da yazar) ----
  { method: "POST", pattern: "/pipeline/leads", action: "lead.created", domain: true },
  { method: "PATCH", pattern: "/pipeline/leads/:id", action: "lead.fields_updated", domain: true, target: lead },
  { method: "DELETE", pattern: "/pipeline/leads/:id", action: "lead.deleted", domain: true, target: lead },
  { method: "POST", pattern: "/pipeline/leads/:id/restore", action: "lead.restored", domain: true, target: lead },
  {
    method: "PATCH",
    pattern: "/pipeline/leads/:id/contact",
    action: "lead.fields_updated",
    domain: true,
    target: lead,
  },
  { method: "POST", pattern: "/pipeline/leads/:id/stage", action: "stage.changed", domain: true, target: lead },
  { method: "POST", pattern: "/pipeline/leads/:id/undo", action: "stage.undone", domain: true, target: lead },
  { method: "POST", pattern: "/pipeline/leads/:id/assign", action: "lead.assigned", domain: true, target: lead },
  { method: "POST", pattern: "/pipeline/leads/:id/activities", action: "activity.planned", domain: true, target: lead },
  { method: "POST", pattern: "/pipeline/leads/:id/contacts", action: "contact.logged", domain: true, target: lead },
  {
    method: "PUT",
    pattern: "/pipeline/leads/:id/customer-status",
    action: "lead.status_changed",
    domain: true,
    target: lead,
  },
  {
    method: "POST",
    pattern: "/pipeline/leads/:id/warnings/:code/check",
    action: "warning.checked",
    domain: true,
    target: lead,
    details: (p) => ({ code: p["code"] }),
  },
  {
    method: "DELETE",
    pattern: "/pipeline/leads/:id/warnings/:code/check",
    action: "warning.unchecked",
    domain: true,
    target: lead,
    details: (p) => ({ code: p["code"] }),
  },
  {
    method: "POST",
    pattern: "/pipeline/leads/:id/attachments",
    action: "attachment.added",
    domain: true,
    target: lead,
  },
  { method: "POST", pattern: "/pipeline/activities/:aid/done", action: "activity.done", domain: true },
  { method: "PATCH", pattern: "/pipeline/activities/:aid", action: "activity.updated", domain: true },
  { method: "DELETE", pattern: "/pipeline/activities/:aid", action: "activity.deleted", domain: true },
  { method: "DELETE", pattern: "/pipeline/attachments/:aid", action: "attachment.deleted", domain: true },
  { method: "POST", pattern: "/pipeline/contact-logs/:aid/undo", action: "contact.undone", domain: true },
  { method: "DELETE", pattern: "/pipeline/contact-logs/:aid", action: "contact.deleted", domain: true },
  { method: "POST", pattern: "/pipeline/organizations", action: "organization.created", domain: true },
  { method: "PATCH", pattern: "/pipeline/organizations/:oid", action: "organization.updated", domain: true },
  {
    method: "POST",
    pattern: "/pipeline/organizations/:oid/archive",
    action: "organization.archived",
    target: (p) => ({ type: "organization", id: p["oid"] }),
  },
  {
    method: "POST",
    pattern: "/pipeline/organizations/:oid/unarchive",
    action: "organization.unarchived",
    target: (p) => ({ type: "organization", id: p["oid"] }),
  },
  // ---- kişisel ayarlar: hareket değil ----
  { method: "POST", pattern: "/pipeline/notifications/read-all", action: "request.other", skip: true },
  { method: "POST", pattern: "/pipeline/notifications/:nid/read", action: "request.other", skip: true },
  { method: "POST", pattern: "/pipeline/push/subscriptions", action: "request.other", skip: true },
  { method: "POST", pattern: "/pipeline/push/unsubscribe", action: "request.other", skip: true },
  // ---- yönetim paneli ----
  {
    method: "PUT",
    pattern: "/pipeline/territories/:cc",
    action: "territory.updated",
    target: (p) => ({ type: "territory", id: p["cc"], label: p["cc"] }),
    details: (_p, b) => ({ assignedUserId: b["assignedUserId"] ?? null, fallbackUserId: b["fallbackUserId"] ?? null }),
  },
  {
    method: "DELETE",
    pattern: "/pipeline/territories/:cc",
    action: "territory.deleted",
    target: (p) => ({ type: "territory", id: p["cc"], label: p["cc"] }),
  },
  {
    method: "POST",
    pattern: "/pipeline/territories/apply-to-pool",
    action: "territory.applied_to_pool",
    dryRun: true,
    target: () => ({ type: "territory" }),
  },
  {
    method: "POST",
    pattern: "/pipeline/territories/reassign-non-sales",
    action: "territory.reassigned",
    dryRun: true,
    target: () => ({ type: "territory" }),
  },
  {
    method: "POST",
    pattern: "/pipeline/products/import",
    action: "product_catalog.imported",
    dryRun: true,
    target: () => ({ type: "product_catalog" }),
    details: (_p, b) => ({ rows: count(b["rows"]), skipped: count(b["skip"]) }),
  },
  {
    method: "POST",
    pattern: "/pipeline/persons/:pid/merge",
    action: "person.merged",
    target: (p) => ({ type: "person", id: p["pid"] }),
    details: (_p, b) => ({ sourceId: typeof b["sourceId"] === "string" ? b["sourceId"] : null }),
  },
  {
    method: "PUT",
    pattern: "/admin/settings/:provider",
    action: "settings.updated",
    target: provider,
    // Ayar değerleri (anahtar, belirteç) asla yazılmaz: yalnız hangi alanların gönderildiği.
    details: (_p, b) => ({
      fields: typeof b["values"] === "object" && b["values"] !== null ? Object.keys(b["values"] as Body) : keys(b),
    }),
  },
  {
    method: "PUT",
    pattern: "/admin/stage-mappings/:provider",
    action: "stage_mapping.updated",
    target: (p) => ({ type: "mapping", id: p["provider"], label: p["provider"] }),
  },
  {
    method: "PUT",
    pattern: "/admin/field-mappings/:provider",
    action: "field_mapping.updated",
    target: (p) => ({ type: "mapping", id: p["provider"], label: p["provider"] }),
  },
  {
    method: "DELETE",
    pattern: "/admin/field-mappings/:provider/:mid",
    action: "field_mapping.deleted",
    target: (p) => ({ type: "mapping", id: p["provider"], label: p["provider"] }),
    details: (p) => ({ mappingId: p["mid"] }),
  },
  {
    method: "POST",
    pattern: "/admin/providers/:provider/outbound",
    action: "provider.outbound_updated",
    target: provider,
    details: (_p, b) => ({ enabled: b["enabled"] === true }),
  },
  {
    method: "PUT",
    pattern: "/admin/eur-rates",
    action: "fx_rates.updated",
    target: () => ({ type: "fx_rates" }),
    // Kurlar kişisel ya da gizli değildir: eski değer ayarlarda, yeni değer burada.
    details: (_p, b) => ({
      rates: typeof b["rates"] === "object" && b["rates"] !== null ? b["rates"] : null,
      auto: b["auto"] ?? null,
    }),
  },
  {
    method: "POST",
    pattern: "/admin/eur-rates/refresh",
    action: "fx_rates.refreshed",
    target: () => ({ type: "fx_rates" }),
  },
  {
    method: "POST",
    pattern: "/admin/outbox/requeue",
    action: "outbox.requeued",
    target: () => ({ type: "queue", id: "outbox", label: "outbox" }),
    details: (_p, b) => ({ fields: keys(b) }),
  },
  {
    method: "POST",
    pattern: "/admin/inbox/requeue",
    action: "inbox.requeued",
    target: () => ({ type: "queue", id: "inbox", label: "inbox" }),
    details: (_p, b) => ({ fields: keys(b) }),
  },
  {
    method: "POST",
    pattern: "/admin/checkpoints/:cid/restore",
    action: "checkpoint.restored",
    target: (p) => ({ type: "checkpoint", id: p["cid"] }),
  },
  // ---- elle başlatılan aktarımlar ----
  {
    method: "POST",
    pattern: "/sheet-sync/run",
    action: "sheet_sync.run",
    target: () => ({ type: "sync", id: "sheet", label: "sheet" }),
  },
  {
    method: "POST",
    pattern: "/st-customer-sync/run",
    action: "st_customer_sync.run",
    target: () => ({ type: "sync", id: "st-customer", label: "st-customer" }),
  },
  {
    method: "POST",
    pattern: "/mail-activity/run",
    action: "mail_stats.run",
    target: () => ({ type: "sync", id: "mail", label: "mail" }),
  },
];

const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function compile(pattern: string): { re: RegExp; names: string[] } {
  const names: string[] = [];
  const src = pattern
    .split("/")
    .map((seg) => {
      if (!seg.startsWith(":")) return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      names.push(seg.slice(1));
      return "([^/]+)";
    })
    .join("/");
  return { re: new RegExp(`^${src}/?$`), names };
}
const COMPILED = AUDIT_ROUTES.map((r) => ({ route: r, ...compile(r.pattern) }));

/** Yöntem + yol → tablo satırı ve yakalanan parçalar. Sabit yollar (`/territories/apply-to-pool`) `:cc`'den önce gelir. */
export function matchAuditRoute(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  let best: { route: Route; params: Record<string, string>; vars: number } | null = null;
  for (const c of COMPILED) {
    if (c.route.method !== method) continue;
    const m = c.re.exec(path);
    if (!m) continue;
    const params = Object.fromEntries(c.names.map((n, i) => [n, decodeURIComponent(m[i + 1] ?? "")]));
    if (!best || c.names.length < best.vars) best = { route: c.route, params, vars: c.names.length };
  }
  return best ? { route: best.route, params: best.params } : null;
}

export const resultOf = (status: number): ActionResult =>
  status < 400 ? "ok" : status === 401 || status === 403 ? "denied" : status < 500 ? "rejected" : "error";

interface SessionLike {
  userId?: string;
  email?: string;
}

/**
 * `/api` önüne bağlanan ara katman (`express.json`'dan sonra). Yanıt bittiğinde karar verir; yanıtı hiçbir zaman
 * geciktirmez, kayıt hatası isteği bozmaz (ActionLog yalnız loglar).
 */
export function auditMiddleware(deps: { actions: ActionRecorder }): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!WRITE.has(req.method)) return next();
    const path = req.originalUrl.split("?")[0]!.replace(/^\/api(?=\/)/, "");
    if (path.startsWith("/auth/")) return next(); // giriş / çıkış açıkça yazılır
    const ctx: AuditContext = { recorded: false };
    res.on("finish", () => {
      const status = res.statusCode;
      if (ctx.recorded && status < 500) return;
      const s = (req as Request & { session?: SessionLike }).session;
      const userId = s?.userId || s?.email;
      if (!userId) return; // oturumsuz istek bir kullanıcının hareketi değildir
      const hit = matchAuditRoute(req.method, path);
      const route = hit?.route;
      if (route?.skip) return;
      if (route?.domain && status < 400) return; // use-case yazmadıysa değişiklik yoktur (aynı değer)
      const body: Body = typeof req.body === "object" && req.body !== null && !Array.isArray(req.body) ? req.body : {};
      if (route?.dryRun && body["dryRun"] !== false && status < 400) return;
      const params = hit?.params ?? {};
      const t = route?.target?.(params, body);
      const input: RecordActionInput = {
        actor: { userId },
        action: route?.action ?? "request.other",
        ...(t?.type === "lead" && t.id ? { lead: { id: t.id } } : t ? { target: t } : { target: { type: "request" } }),
        result: resultOf(status),
        details: {
          ...(route?.details?.(params, body) ?? (route ? {} : { fields: keys(body) })),
          method: req.method,
          path: route ? route.pattern : path.slice(0, 200),
          status,
        },
      };
      void deps.actions.record(input);
    });
    requestAudit.run(ctx, next);
  };
}
