/**
 * Kampanya adlarının görünürlüğü (2026-11-20): reklam kampanyası, reklam seti ve reklam adları yalnız oturumu
 * `seesCampaign` olan kişilere gider (server/roles.mjs CRM_CAMPAIGN_VIEWERS). Diğerlerinde yanıttaki her lead'in
 * `campaign` bilgisi boşaltılır, rapordaki kampanya listesi boş döner ve kampanya süzgeci yok sayılır. Arayüz
 * sütunu ayrıca gizler; karar burada.
 */
import type { NextFunction, Request, Response } from "express";
import { EMPTY_CAMPAIGN } from "../domain";

/** `seesCampaign` açıkça false olan oturum kampanya görmez (tanımsız: eski çağıranlar ve testler, kısıt yok). */
export const hidesCampaign = (actor: { seesCampaign?: boolean } | undefined): boolean => actor?.seesCampaign === false;

const isCampaignInfo = (v: unknown): boolean =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "campaignName" in v;

function walk(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(walk);
  if (typeof node !== "object" || node === null) return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "campaign" && isCampaignInfo(v)) out[k] = { ...EMPTY_CAMPAIGN };
    else if (k === "campaign" && typeof v === "string") out[k] = null;
    else if (k === "campaigns" && Array.isArray(v) && v.every((x) => typeof x === "string")) out[k] = [];
    else out[k] = walk(v);
  }
  return out;
}

/** Yanıt gövdesindeki kampanya bilgisini boşaltır (JSON'a çevrilmiş kopya üzerinde; girdi değişmez). */
export function redactCampaigns<T>(body: T): T {
  if (body === undefined) return body;
  return walk(JSON.parse(JSON.stringify(body))) as T;
}

/** Router ara katmanı: kampanya görmeyen oturumun bütün JSON yanıtlarını süzer. */
export function campaignRedaction(actorOf: (req: Request) => { seesCampaign?: boolean } | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (hidesCampaign(actorOf(req))) {
      const json = res.json.bind(res);
      res.json = ((body: unknown) => json(redactCampaigns(body))) as Response["json"];
    }
    next();
  };
}
