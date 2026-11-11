/**
 * Yönetim paneli API'si (`/api/admin`, Faz 7a–7c). Sunucu bu router'ı oturum + yalnız-yönetici kontrolünden sonra
 * bağlar. Controller doğrular, çağırır, döner; iş kuralı ilgili modülün application katmanındadır (gelen kutusu:
 * lead-intake, giden kuyruk: ad-feedback, eşlemeler ve ayarlar: bu modül). Sağlayıcı adları koda yazılmaz: kompozisyon
 * kökünün verdiği listeden gelir. Secret değerleri hiçbir yanıtta yoktur.
 */
import { Router, type Request, type Response } from "express";
import type { OutboxHealth, OutboundStatus } from "../../ad-feedback/application";
import type { InboxHealth } from "../../lead-intake/application";
import { RuleError, type Logger, type Result } from "../../shared/kernel";
import { MAPPING_TARGETS, OUTBOUND_ENABLED_KEY, type IntegrationSettings } from "../application";
import type {
  AdminErrorDto,
  EurRatesDto,
  FieldMappingsDto,
  HealthDto,
  InboxFailedDto,
  OutboxItemDto,
  ProviderSettingsDto,
  RequestStatusDto,
  StageMappingsDto,
} from "./dto";

export interface ProviderInfo {
  provider: string;
  /** Gelen akış yapılandırıldı mı; bu sağlayıcıda gelen akış yoksa null. */
  inbound: boolean | null;
  /** Gönderici kurulu mu; giden akışı olmayan sağlayıcıda null. */
  outbound: boolean | null;
  /** ENABLED_PROVIDERS içinde mi (aşama olayları için kuyruk satırı açılır). */
  listed: boolean;
  secrets: { name: string; set: boolean }[];
  /** Ekrandan düzenlenebilen (secret olmayan) ayar anahtarları. */
  settings: { key: string; kind: "text" | "list" }[];
}

export interface AdminRouterDeps {
  settings: IntegrationSettings;
  outbox: OutboxHealth;
  inbox: InboxHealth;
  logger: Logger;
  /** Oturumdaki kullanıcının kimliği (yalnız log için). */
  actorIdOf(req: Request): string;
  providers(): ProviderInfo[];
  generalSecrets(): { name: string; set: boolean }[];
  stageCodes: readonly string[];
  retentionDays: number;
  eurRates: {
    get(): Promise<EurRatesDto>;
    save(rates: unknown): Promise<Result<EurRatesDto, RuleError>>;
  };
  now(): Date;
}

const STATUS: Record<string, number> = { not_found: 404, "status.unsupported": 409, "status.unavailable": 502 };
const OUTBOUND_STATUSES: readonly OutboundStatus[] = ["pending", "failed", "dead", "skipped", "sent"];
const MAX_SETTING = 500;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function createAdminRouter(deps: AdminRouterDeps): Router {
  const r = Router();
  const { settings, logger } = deps;

  const fail = (res: Response, error: RuleError) =>
    res
      .status(STATUS[error.code] ?? 422)
      .json(<AdminErrorDto>{ error: error.message, code: error.code, details: error.details });
  const send = <T>(res: Response, result: Result<T, RuleError>) =>
    result.ok ? res.json(result.value) : fail(res, result.error);

  /** Yol parametresindeki sağlayıcı bilinen listede mi; değilse 404 yazar. */
  const providerOf = (req: Request, res: Response): ProviderInfo | undefined => {
    const name = String(req.params["provider"] ?? "");
    const p = deps.providers().find((x) => x.provider === name);
    if (!p) {
      res.status(404).json(<AdminErrorDto>{ error: "Bilinmeyen sağlayıcı.", code: "provider.unknown" });
      return undefined;
    }
    return p;
  };

  const ids = (req: Request): string[] => {
    const raw = (req.body as { ids?: unknown } | undefined)?.ids;
    return Array.isArray(raw) ? raw.map(String).slice(0, 500) : [];
  };

  /* ---------------- 7a: sağlık ---------------- */

  r.get("/health", async (_req, res) => {
    const [inbox, outbox] = await Promise.all([deps.inbox.stats(), deps.outbox.stats()]);
    const statusProviders = deps.outbox.statusProviders();
    const providers = await Promise.all(
      deps.providers().map(async (p) => ({
        provider: p.provider,
        inbound: p.inbound === null ? null : { configured: p.inbound },
        outbound:
          p.outbound === null
            ? null
            : {
                configured: p.outbound,
                listed: p.listed,
                enabled: await settings.outboundEnabled(p.provider),
                statusQuery: statusProviders.includes(p.provider),
              },
        secrets: p.secrets,
      })),
    );
    const body: HealthDto = {
      generatedAt: deps.now().toISOString(),
      providers,
      secrets: deps.generalSecrets(),
      inbox: {
        counts: inbox.counts,
        receivedLastDay: inbox.receivedLastDay,
        oldestPendingAt: iso(inbox.oldestPendingAt),
        lastPurgedAt: iso(inbox.lastPurgedAt),
        purgeBacklog: inbox.purgeBacklog,
        retentionDays: deps.retentionDays,
      },
      outbox: {
        counts: outbox.counts,
        skipReasons: outbox.skipReasons,
        oldestDueAt: iso(outbox.oldestDueAt),
        lastSentAt: iso(outbox.lastSentAt),
      },
    };
    res.json(body);
  });

  r.get("/outbox", async (req, res) => {
    const wanted = String(req.query["status"] ?? "dead,failed")
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is OutboundStatus => (OUTBOUND_STATUSES as readonly string[]).includes(s));
    const provider = String(req.query["provider"] ?? "").trim();
    const rows = await deps.outbox.list({
      statuses: wanted.length ? wanted : ["dead", "failed"],
      provider: provider || undefined,
      limit: Math.min(Number(req.query["limit"]) || 100, 500),
    });
    res.json(
      rows.map((x): OutboxItemDto => ({
        id: x.id,
        provider: x.provider,
        status: x.status,
        attempts: x.attempts,
        nextAttemptAt: x.nextAttemptAt.toISOString(),
        skipReason: x.skipReason,
        lastResponseCode: x.lastResponseCode,
        lastError: x.lastError,
        createdAt: x.createdAt.toISOString(),
        finishedAt: iso(x.finishedAt),
        sentAt: iso(x.sentAt),
        hasRequestId: Boolean(x.requestId),
        leadId: x.leadId,
        stageCode: x.stageCode,
        occurredAt: iso(x.occurredAt),
      })),
    );
  });

  r.post("/outbox/requeue", async (req, res) => {
    send(res, await deps.outbox.requeue(ids(req), deps.actorIdOf(req)));
  });

  /* 7c: platformdaki akıbet; satır başına tek istek (toplu sorgu yok, kota). */
  r.get("/outbox/:id/status", async (req, res) => {
    const result = await deps.outbox.requestStatus(String(req.params["id"]));
    if (!result.ok) return fail(res, result.error);
    const body: RequestStatusDto = result.value;
    res.json(body);
  });

  r.get("/inbox/failed", async (req, res) => {
    const rows = await deps.inbox.listFailed(Number(req.query["limit"]) || 100);
    res.json(
      rows.map((x): InboxFailedDto => ({
        id: x.id,
        provider: x.provider,
        kind: x.kind,
        receivedAt: x.receivedAt.toISOString(),
        attempts: x.attempts,
        lastErrorCode: x.lastErrorCode,
        lastError: x.lastError,
        leadId: x.leadId,
        processedAt: iso(x.processedAt),
        hasPayload: x.hasPayload,
      })),
    );
  });

  r.post("/inbox/requeue", async (req, res) => {
    send(res, await deps.inbox.requeue(ids(req), deps.actorIdOf(req)));
  });

  /* Acil durdurma: anahtar kapalıyken dağıtıcı satırları `emergency_stop` ile atlar. */
  r.post("/providers/:provider/outbound", async (req, res) => {
    const p = providerOf(req, res);
    if (!p) return;
    const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
    if (p.outbound === null || typeof enabled !== "boolean") {
      return fail(
        res,
        new RuleError("provider.outbound_invalid", "Bu sağlayıcıda giden akış yok ya da değer geçersiz."),
      );
    }
    await settings.set(p.provider, OUTBOUND_ENABLED_KEY, enabled ? "true" : "false");
    logger.warn("giden akış anahtarı değişti", { provider: p.provider, enabled, changedBy: deps.actorIdOf(req) });
    res.json({ provider: p.provider, enabled });
  });

  /* ---------------- 7b: eşlemeler ---------------- */

  const stageRows = async (provider: string): Promise<StageMappingsDto> => {
    const have = await settings.listStageMappings(provider);
    return {
      provider,
      rows: deps.stageCodes.map((stageCode) => {
        const m = have.find((x) => x.stageCode === stageCode);
        return {
          stageCode,
          platformEventName: m?.platformEventName ?? "",
          enabled: m?.enabled ?? false,
          isOptimizationTarget: m?.isOptimizationTarget ?? false,
        };
      }),
    };
  };

  r.get("/stage-mappings/:provider", async (req, res) => {
    const p = providerOf(req, res);
    if (p) res.json(await stageRows(p.provider));
  });

  r.put("/stage-mappings/:provider", async (req, res) => {
    const p = providerOf(req, res);
    if (!p) return;
    const rows = (req.body as { rows?: unknown } | undefined)?.rows;
    const saved = await settings.saveStageMappings(p.provider, Array.isArray(rows) ? rows : [], deps.stageCodes);
    if (!saved.ok) return fail(res, saved.error);
    logger.info("aşama eşlemesi kaydedildi", { provider: p.provider, changedBy: deps.actorIdOf(req) });
    res.json(await stageRows(p.provider));
  });

  const fieldRows = async (provider: string): Promise<FieldMappingsDto> => ({
    provider,
    targets: [...MAPPING_TARGETS],
    rows: (await settings.listMappings(provider)).map((m) => ({
      id: m.id,
      formId: m.formId,
      platformField: m.platformField,
      target: m.target,
      isActive: m.isActive,
    })),
  });

  r.get("/field-mappings/:provider", async (req, res) => {
    const p = providerOf(req, res);
    if (p) res.json(await fieldRows(p.provider));
  });

  r.put("/field-mappings/:provider", async (req, res) => {
    const p = providerOf(req, res);
    if (!p) return;
    const saved = await settings.saveFieldMapping(p.provider, req.body);
    if (!saved.ok) return fail(res, saved.error);
    logger.info("alan eşlemesi kaydedildi", {
      provider: p.provider,
      id: saved.value.id,
      changedBy: deps.actorIdOf(req),
    });
    res.json(await fieldRows(p.provider));
  });

  r.delete("/field-mappings/:provider/:id", async (req, res) => {
    const p = providerOf(req, res);
    if (!p) return;
    const removed = await settings.removeFieldMapping(p.provider, String(req.params["id"]));
    if (!removed.ok) return fail(res, removed.error);
    logger.info("alan eşlemesi silindi", { provider: p.provider, changedBy: deps.actorIdOf(req) });
    res.json(await fieldRows(p.provider));
  });

  /* ---------------- 7b: ayarlar (secret olmayanlar) ---------------- */

  const listText = (json: string): string => {
    try {
      const v: unknown = JSON.parse(json || "[]");
      return Array.isArray(v) ? v.map(String).join(", ") : "";
    } catch {
      return "";
    }
  };

  const providerSettings = async (p: ProviderInfo): Promise<ProviderSettingsDto> => {
    const stored = await settings.list(p.provider);
    return {
      provider: p.provider,
      settings: p.settings.map((def) => {
        const s = stored.find((x) => x.key === def.key);
        return {
          key: def.key,
          kind: def.kind,
          value: def.kind === "list" ? listText(s?.value ?? "[]") : (s?.value ?? ""),
          updatedAt: iso(s?.updatedAt),
        };
      }),
      secrets: p.secrets,
    };
  };

  r.get("/settings/:provider", async (req, res) => {
    const p = providerOf(req, res);
    if (p) res.json(await providerSettings(p));
  });

  r.put("/settings/:provider", async (req, res) => {
    const p = providerOf(req, res);
    if (!p) return;
    const values = ((req.body as { values?: unknown } | undefined)?.values ?? {}) as Record<string, unknown>;
    const changed: string[] = [];
    for (const [key, raw] of Object.entries(values)) {
      const def = p.settings.find((d) => d.key === key);
      const text = typeof raw === "string" ? raw.trim() : "";
      if (!def || typeof raw !== "string" || text.length > MAX_SETTING) {
        return fail(res, new RuleError("setting.invalid", "Ayar anahtarı ya da değeri geçersiz.", { key }));
      }
      const value =
        def.kind === "list"
          ? JSON.stringify(
              text
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
            )
          : text;
      await settings.set(p.provider, key, value);
      changed.push(key);
    }
    // Değerler loglanmaz (kimlikler olabilir); yalnız hangi anahtarın değiştiği.
    logger.info("sağlayıcı ayarı kaydedildi", { provider: p.provider, keys: changed, changedBy: deps.actorIdOf(req) });
    res.json(await providerSettings(p));
  });

  r.get("/eur-rates", async (_req, res) => {
    res.json(await deps.eurRates.get());
  });

  r.put("/eur-rates", async (req, res) => {
    const saved = await deps.eurRates.save((req.body as { rates?: unknown } | undefined)?.rates);
    if (!saved.ok) return fail(res, saved.error);
    logger.info("EUR kurları kaydedildi", { changedBy: deps.actorIdOf(req) });
    res.json(saved.value);
  });

  return r;
}
