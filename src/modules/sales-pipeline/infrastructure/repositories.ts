import { queryOne, type Queryable } from "../../shared/db";
import type { IdGenerator } from "../../shared/kernel";
import type {
  Lead,
  LeadListFilter,
  LeadRepository,
  LostReasonSource,
  OutboxWriter,
  Person,
  PersonRepository,
  StageCode,
  StageEvent,
  StageEventRepository,
  TerritoryRule,
  TerritoryRuleSource,
} from "../domain";
import {
  attributionFromRow,
  consentFromRow,
  leadFromRow,
  personFromRow,
  stageEventFromRow,
  type AttributionRow,
  type ConsentRow,
  type LeadRow,
  type PersonRow,
  type StageEventRow,
} from "./rows";

const LEAD_COLS =
  "id, source, platform_lead_id, form_id, person_id, full_name, email, phone_e164, country, city, company, product_interest, " +
  "campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, assigned_user_id, current_stage, is_test, notes, extra_answers, created_at, updated_at";

export function pgLeadRepository(q: Queryable): LeadRepository {
  return {
    async findById(id) {
      const r = await queryOne<LeadRow>(q, `SELECT ${LEAD_COLS} FROM leads WHERE id = $1`, [id]);
      return r && leadFromRow(r);
    },
    async findByPlatformId(source, platformLeadId) {
      const r = await queryOne<LeadRow>(
        q,
        `SELECT ${LEAD_COLS} FROM leads WHERE source = $1 AND platform_lead_id = $2`,
        [source, platformLeadId],
      );
      return r && leadFromRow(r);
    },
    async list(f: LeadListFilter) {
      const where: string[] = [];
      const params: unknown[] = [];
      const p = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      if (!f.includeTest) where.push("is_test = false");
      if (f.visibleTo) {
        const countries = f.visibleTo.countries.map((c) => c.toUpperCase());
        where.push(
          `(assigned_user_id = ${p(f.visibleTo.userId)} OR (assigned_user_id IS NULL AND (country IS NULL OR ${
            countries.length ? `country = ANY(${p(countries)}::text[])` : "true"
          })))`,
        );
      }
      if (f.stage) where.push(`current_stage = ${p(f.stage)}`);
      if (f.search) {
        const like = p(`%${f.search.toLowerCase()}%`);
        where.push(
          `(lower(full_name) LIKE ${like} OR lower(coalesce(email,'')) LIKE ${like} OR lower(company) LIKE ${like} OR coalesce(phone_e164,'') LIKE ${like})`,
        );
      }
      const sql = `SELECT ${LEAD_COLS} FROM leads ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC, id ${
        f.limit ? `LIMIT ${p(f.limit)}` : ""
      }`;
      return (await q.query<LeadRow>(sql, params)).map(leadFromRow);
    },
    async insert(l: Lead) {
      await q.query(
        `INSERT INTO leads (${LEAD_COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
        [
          l.id,
          l.source,
          l.platformLeadId,
          l.formId,
          l.personId,
          l.fullName,
          l.email,
          l.phoneE164,
          l.country,
          l.city,
          l.company,
          l.productInterest,
          l.campaign.campaignId,
          l.campaign.campaignName,
          l.campaign.adsetId,
          l.campaign.adsetName,
          l.campaign.adId,
          l.campaign.adName,
          l.assignedUserId,
          l.currentStage,
          l.isTest,
          l.notes,
          JSON.stringify(l.extraAnswers),
          l.createdAt,
          l.updatedAt,
        ],
      );
    },
    async updateStage(id, stage: StageCode, updatedAt) {
      await q.query("UPDATE leads SET current_stage = $2, updated_at = $3 WHERE id = $1", [id, stage, updatedAt]);
    },
    async updateAssignee(id, userId, updatedAt) {
      await q.query("UPDATE leads SET assigned_user_id = $2, updated_at = $3 WHERE id = $1", [id, userId, updatedAt]);
    },
    async saveAttribution(leadId, a) {
      await q.query(
        `INSERT INTO lead_attribution (${ATTR_COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (lead_id) DO UPDATE SET gclid = EXCLUDED.gclid, gbraid = EXCLUDED.gbraid, wbraid = EXCLUDED.wbraid,
           fbclid = EXCLUDED.fbclid, fbc = EXCLUDED.fbc, fbp = EXCLUDED.fbp, utm_source = EXCLUDED.utm_source,
           utm_medium = EXCLUDED.utm_medium, utm_campaign = EXCLUDED.utm_campaign, utm_term = EXCLUDED.utm_term,
           utm_content = EXCLUDED.utm_content, landing_url = EXCLUDED.landing_url, click_at = EXCLUDED.click_at`,
        [
          leadId,
          a.gclid,
          a.gbraid,
          a.wbraid,
          a.fbclid,
          a.fbc,
          a.fbp,
          a.utmSource,
          a.utmMedium,
          a.utmCampaign,
          a.utmTerm,
          a.utmContent,
          a.landingUrl,
          a.clickAt,
        ],
      );
    },
    async findAttribution(leadId) {
      const r = await queryOne<AttributionRow>(q, `SELECT ${ATTR_COLS} FROM lead_attribution WHERE lead_id = $1`, [
        leadId,
      ]);
      return r && attributionFromRow(r);
    },
    async saveConsents(rows) {
      for (const c of rows) {
        await q.query(`INSERT INTO lead_consents (${CONSENT_COLS}) VALUES ($1,$2,$3,$4,$5,$6)`, [
          c.id,
          c.leadId,
          c.type,
          c.granted,
          c.textVersion,
          c.grantedAt,
        ]);
      }
    },
    async findConsents(leadId) {
      return (
        await q.query<ConsentRow>(
          `SELECT ${CONSENT_COLS} FROM lead_consents WHERE lead_id = $1 ORDER BY granted_at, consent_type`,
          [leadId],
        )
      ).map(consentFromRow);
    },
  };
}

const CONSENT_COLS = "id, lead_id, consent_type, granted, text_version, granted_at";

const ATTR_COLS =
  "lead_id, gclid, gbraid, wbraid, fbclid, fbc, fbp, utm_source, utm_medium, utm_campaign, utm_term, utm_content, landing_url, click_at";

export function pgPersonRepository(q: Queryable): PersonRepository {
  return {
    async findByEmailOrPhone(email, phone) {
      if (!email && !phone) return undefined;
      const r = await queryOne<PersonRow>(
        q,
        `SELECT id, full_name, email_normalized, phone_e164, country, company, created_at FROM persons
          WHERE ($1::text IS NOT NULL AND email_normalized = $1) OR ($2::text IS NOT NULL AND phone_e164 = $2)
          ORDER BY created_at LIMIT 1`,
        [email, phone],
      );
      return r && personFromRow(r);
    },
    async insert(p: Person) {
      await q.query(
        "INSERT INTO persons (id, full_name, email_normalized, phone_e164, country, company, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [p.id, p.fullName, p.emailNormalized, p.phoneE164, p.country, p.company, p.createdAt],
      );
    },
  };
}

const EVENT_COLS =
  "id, lead_id, change_id, stage_code, occurred_at, sequence, actor_user_id, origin, value_amount, currency, lost_reason_code, qualification_answers, undone_at";

export function pgStageEventRepository(q: Queryable): StageEventRepository {
  return {
    async listByLead(leadId) {
      return (
        await q.query<StageEventRow>(
          `SELECT ${EVENT_COLS} FROM lead_stage_events WHERE lead_id = $1 ORDER BY sequence`,
          [leadId],
        )
      ).map(stageEventFromRow);
    },
    async findByIds(ids) {
      if (!ids.length) return [];
      return (
        await q.query<StageEventRow>(
          `SELECT ${EVENT_COLS} FROM lead_stage_events WHERE id = ANY($1::uuid[]) ORDER BY occurred_at, sequence`,
          [[...ids]],
        )
      ).map(stageEventFromRow);
    },
    async listSince(since, sources) {
      if (!sources.length) return [];
      return (
        await q.query<StageEventRow>(
          `SELECT ${EVENT_COLS.split(", ")
            .map((c) => `e.${c}`)
            .join(", ")}
             FROM lead_stage_events e JOIN leads l ON l.id = e.lead_id
            WHERE l.source = ANY($2::text[]) AND l.is_test = false AND e.undone_at IS NULL AND e.occurred_at >= $1
            ORDER BY e.occurred_at, e.sequence`,
          [since, [...sources]],
        )
      ).map(stageEventFromRow);
    },
    async nextSequence(leadId) {
      const r = await queryOne<{ n: number | string }>(
        q,
        "SELECT coalesce(max(sequence), 0) + 1 AS n FROM lead_stage_events WHERE lead_id = $1",
        [leadId],
      );
      return Number(r?.n ?? 1);
    },
    async insert(e: StageEvent) {
      await q.query(
        `INSERT INTO lead_stage_events (${EVENT_COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          e.id,
          e.leadId,
          e.changeId,
          e.stageCode,
          e.occurredAt,
          e.sequence,
          e.actorUserId,
          e.origin,
          e.value?.amount ?? null,
          e.value?.currency ?? null,
          e.lostReasonCode,
          e.qualificationAnswers === null ? null : JSON.stringify(e.qualificationAnswers),
          e.undoneAt,
        ],
      );
    },
    async markUndone(ids, undoneAt, byUserId) {
      await q.query(
        "UPDATE lead_stage_events SET undone_at = $2, undone_by_user_id = $3 WHERE id = ANY($1::uuid[]) AND undone_at IS NULL",
        [[...ids], undoneAt, byUserId],
      );
    },
  };
}

export function pgOutboxWriter(q: Queryable, ids: IdGenerator): OutboxWriter {
  return {
    async enqueue(stageEventId, provider, notBefore) {
      await q.query(
        `INSERT INTO outbound_conversion_events (id, stage_event_id, provider, status, next_attempt_at)
         VALUES ($1, $2, $3, 'pending', $4) ON CONFLICT (stage_event_id, provider) DO NOTHING`,
        [ids.next(), stageEventId, provider, notBefore],
      );
    },
    async skipForEvents(stageEventIds, reason) {
      await q.query(
        "UPDATE outbound_conversion_events SET status = 'skipped', skip_reason = $2 WHERE stage_event_id = ANY($1::uuid[]) AND status = 'pending'",
        [[...stageEventIds], reason],
      );
    },
  };
}

export function pgTerritoryRuleSource(q: Queryable): TerritoryRuleSource {
  return {
    async all() {
      const rows = await q.query<{ country_code: string; assigned_user_id: string; fallback_user_id: string | null }>(
        "SELECT country_code, assigned_user_id, fallback_user_id FROM territory_rules",
      );
      return rows.map((r): TerritoryRule => ({
        countryCode: r.country_code,
        assignedUserId: r.assigned_user_id,
        fallbackUserId: r.fallback_user_id,
      }));
    },
  };
}

export function pgLostReasonSource(q: Queryable): LostReasonSource {
  return {
    async activeCodes() {
      return (await q.query<{ code: string }>("SELECT code FROM lost_reasons WHERE is_active ORDER BY sort_order")).map(
        (r) => r.code,
      );
    },
  };
}
