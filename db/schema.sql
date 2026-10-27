-- Target Postgres schema. Column names match src/domain/types.ts exactly,
-- so a Postgres-backed CrmRepository only has to forward rows.
-- Today the Node server (server/index.mjs) keeps the same tables in server/data/crm.json.

CREATE TYPE org_type      AS ENUM ('club','investor','distributor','contractor');
CREATE TYPE lead_source   AS ENUM ('website_form','instagram','referral','fair');
CREATE TYPE lead_status   AS ENUM ('new','qualified','discarded');
-- The five board columns, in order:
--   contacted      1  İletişime geçildi
--   interested     2  Green line (replied, asking for a price)
--   proforma_sent  3  Proforma gönderildi
--   site_visit     4  Saha ziyareti / planlama
--   lost           5  Red line (negative outcome, reason mandatory)
CREATE TYPE deal_stage    AS ENUM ('contacted','interested','proforma_sent','site_visit','lost');
CREATE TYPE activity_type AS ENUM ('call','email','meeting','proforma_sent','site_visit');

CREATE TABLE organizations (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  country     char(2),
  type        org_type NOT NULL DEFAULT 'club',
  website     text NOT NULL DEFAULT '',
  notes       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contacts (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  role               text NOT NULL DEFAULT '',
  email              text NOT NULL DEFAULT '',
  phone              text NOT NULL DEFAULT '',
  organization_id    text REFERENCES organizations(id) ON DELETE SET NULL,
  preferred_language char(2) NOT NULL DEFAULT 'en',
  country            char(2),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deals (
  id                  text PRIMARY KEY,
  title               text NOT NULL,
  organization_id     text REFERENCES organizations(id) ON DELETE SET NULL,
  contact_id          text REFERENCES contacts(id) ON DELETE SET NULL,
  stage               deal_stage NOT NULL DEFAULT 'contacted',
  value               numeric(14,2) NOT NULL DEFAULT 0,
  currency            char(3) NOT NULL DEFAULT 'EUR',
  court_count         integer NOT NULL DEFAULT 0,
  court_model         text NOT NULL DEFAULT '',
  expected_close_date date,
  owner               text NOT NULL DEFAULT '',   -- '' = shared pool (not tagged to a rep yet)
  lost_reason         text,
  notes               text NOT NULL DEFAULT '',
  lead_id             text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  stage_entered_at    timestamptz NOT NULL DEFAULT now(),
  won_at              timestamptz,                -- sale closed; the card keeps its column
  lost_at             timestamptz,
  -- Rule 3: a red-line customer must carry a reason
  CONSTRAINT lost_needs_reason CHECK (stage <> 'lost' OR coalesce(trim(lost_reason),'') <> ''),
  CONSTRAINT lost_not_won CHECK (stage <> 'lost' OR won_at IS NULL)
);

CREATE TABLE leads (
  id           text PRIMARY KEY,
  source       lead_source NOT NULL,
  status       lead_status NOT NULL DEFAULT 'new',
  contact_id   text NOT NULL REFERENCES contacts(id),
  campaign     text NOT NULL DEFAULT '',
  product      text NOT NULL DEFAULT '',
  court_count  text NOT NULL DEFAULT '',
  urgency      text NOT NULL DEFAULT '',
  location     text NOT NULL DEFAULT '',
  owner        text NOT NULL DEFAULT '',   -- '' = shared pool
  form_answers text NOT NULL DEFAULT '',
  flags        text[] NOT NULL DEFAULT '{}',
  submissions  integer NOT NULL DEFAULT 1,
  mail         text NOT NULL DEFAULT 'none',
  phone_call   text NOT NULL DEFAULT 'none',
  whatsapp     text NOT NULL DEFAULT 'none',
  deal_id      text REFERENCES deals(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE activities (
  id           text PRIMARY KEY,
  type         activity_type NOT NULL,
  subject      text NOT NULL DEFAULT '',
  due_at       timestamptz NOT NULL,
  done         boolean NOT NULL DEFAULT false,
  done_at      timestamptz,
  deal_id      text NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  notes        text NOT NULL DEFAULT '',
  auto_created boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_open_by_deal ON activities (deal_id) WHERE NOT done;  -- "unattended" check

CREATE TABLE deal_stage_changes (
  id          text PRIMARY KEY,
  deal_id     text NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage  deal_stage,
  to_stage    deal_stage NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
