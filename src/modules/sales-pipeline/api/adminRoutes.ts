import type { Request, Response, Router } from "express";
import type { RuleError, Result } from "../../shared/kernel";
import type { Actor, SalesPipeline } from "../application";
import type {
  MergePersonBody,
  MergePersonResultDto,
  OrganizationDto,
  PoolApplyBody,
  PoolApplyResultDto,
  TerritoriesDto,
  TerritoryBody,
  TerritoryRuleDto,
} from "./dto";

/**
 * Faz 7b/7d yönetim uçları: bölge kuralları ("Bölgeler" sekmesi), kişi birleştirme, kuruluş arşivleme. Yetki
 * application katmanında (`admin_only`); görüntüleyici yazamaz (`read_only`).
 */
export interface AdminRouteDeps {
  pipeline: SalesPipeline;
  actor(req: Request, res: Response, write: boolean): (Actor & { readOnly: boolean }) | undefined;
  send<T>(res: Response, result: Result<T, RuleError>, okStatus?: number): unknown;
  sendError(res: Response, error: RuleError): Response;
}

export function registerAdminRoutes(r: Router, deps: AdminRouteDeps): void {
  const { pipeline, actor, send, sendError } = deps;

  r.get("/territories", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    const result = await pipeline.territories.overview(a);
    if (!result.ok) return sendError(res, result.error);
    const body: TerritoriesDto = {
      rules: result.value.rules.map((x) => ({
        countryCode: x.rule.countryCode.trim(),
        assignedUserId: x.rule.assignedUserId,
        fallbackUserId: x.rule.fallbackUserId,
        leadCount: x.leadCount,
        poolCount: x.poolCount,
        assignedInactive: x.assignedInactive,
        fallbackInactive: x.fallbackInactive,
      })),
      uncovered: result.value.uncovered,
    };
    res.json(body);
  });

  r.put("/territories/:cc", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const b = (req.body ?? {}) as TerritoryBody;
    const result = await pipeline.territories.save({
      actor: a,
      fields: { countryCode: req.params["cc"], assignedUserId: b.assignedUserId, fallbackUserId: b.fallbackUserId },
    });
    if (!result.ok) return sendError(res, result.error);
    res.json(<TerritoryRuleDto>{ ...result.value });
  });

  r.delete("/territories/:cc", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const result = await pipeline.territories.remove({ actor: a, countryCode: String(req.params["cc"]) });
    if (!result.ok) return sendError(res, result.error);
    res.status(204).end();
  });

  /** Önce `dryRun: true` ile sonuç gösterilir; onaydan sonra `dryRun: false`. */
  r.post("/territories/apply-to-pool", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const b = (req.body ?? {}) as PoolApplyBody;
    const result = await pipeline.territories.applyToPool({ actor: a, dryRun: b.dryRun !== false });
    if (!result.ok) return sendError(res, result.error);
    res.json(<PoolApplyResultDto>result.value);
  });

  r.post("/persons/:id/merge", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const b = (req.body ?? {}) as MergePersonBody;
    const result = await pipeline.mergePersons.execute({
      targetId: String(req.params["id"]),
      sourceId: String(b.sourceId ?? ""),
      actor: a,
    });
    if (!result.ok) return sendError(res, result.error);
    res.json(<MergePersonResultDto>{ personId: result.value.person.id, movedLeads: result.value.movedLeads });
  });

  for (const [path, archived] of [
    ["archive", true],
    ["unarchive", false],
  ] as const) {
    r.post(`/organizations/:id/${path}`, async (req, res) => {
      const a = actor(req, res, true);
      if (!a) return;
      send(
        res,
        (await pipeline.archiveOrganization.execute({
          organizationId: String(req.params["id"]),
          archived,
          actor: a,
        })) as unknown as Result<OrganizationDto, RuleError>,
      );
    });
  }
}
