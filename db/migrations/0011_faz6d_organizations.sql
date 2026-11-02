-- Faz 6d: kuruluşlar (ADR-0013 madde 4). Kulüp / yatırımcı / distribütör / yüklenici / diğer.
-- Kişi ve lead kuruluşa bağlanır; lead'deki serbest `company` metni geçiş süresince kalır.
-- legacy_id: eski JSON panodaki kimlik; taşıma betiği (db:migrate-legacy) ikinci çalıştırmada aynı kaydı açmaz.
CREATE TABLE organizations (
  id          uuid PRIMARY KEY,
  name        text NOT NULL CHECK (length(trim(name)) > 0),
  type        text NOT NULL DEFAULT 'club' CHECK (type IN ('club','investor','distributor','contractor','other')),
  country     char(2),
  website     text NOT NULL DEFAULT '',
  notes       text NOT NULL DEFAULT '',
  legacy_id   text UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX organizations_name_country_uq ON organizations (lower(name), coalesce(country, ''));

ALTER TABLE persons ADD COLUMN organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE leads   ADD COLUMN organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
CREATE INDEX persons_org_idx ON persons (organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX leads_org_idx   ON leads (organization_id) WHERE organization_id IS NOT NULL;

-- Eski panodaki 28 aktivite taşınırken ikinci çalıştırma aynı satırı açmasın.
ALTER TABLE activities ADD COLUMN legacy_id text UNIQUE;
