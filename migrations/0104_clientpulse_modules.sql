-- Migration 0104: ClientPulse tables + module system
-- modules, subscriptions, org_subscriptions, reports
-- RLS policies for org-scoped tables
-- slug column on system_hierarchy_templates

BEGIN;

-- ─── modules (system catalogue, no RLS) ─────────────────────────────────────

CREATE TABLE modules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL,
  description       TEXT,
  allowed_agent_slugs JSONB,
  allow_all_agents  BOOLEAN NOT NULL DEFAULT false,
  sidebar_config    JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

INSERT INTO modules (slug, display_name, description, allowed_agent_slugs, allow_all_agents, sidebar_config)
VALUES
  ('client_pulse', 'ClientPulse', 'Weekly client health reports and churn-risk alerts for agencies',
   '["portfolio-health-agent"]'::jsonb, false,
   '["clientpulse","reports","companies","integrations","team","manage_org"]'::jsonb),
  ('operator', 'Automation OS', 'Full operator UI — every agent, every workflow, every tool',
   NULL, true,
   '["inbox","companies","agents","workflows","skills","integrations","team","health","manage_org","ops"]'::jsonb);

-- ─── subscriptions (system catalogue, no RLS) ───────────────────────────────

CREATE TABLE subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    TEXT NOT NULL UNIQUE,
  display_name            TEXT NOT NULL,
  description             TEXT,
  module_ids              JSONB NOT NULL DEFAULT '[]'::jsonb,
  price_monthly_cents     INTEGER,
  price_yearly_cents      INTEGER,
  yearly_discount_percent INTEGER NOT NULL DEFAULT 20,
  currency                TEXT NOT NULL DEFAULT 'USD',
  subaccount_limit        INTEGER,
  trial_days              INTEGER NOT NULL DEFAULT 14,
  status                  TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('active', 'draft', 'archived')),
  stripe_product_id       TEXT,
  stripe_price_id_monthly TEXT,
  stripe_price_id_yearly  TEXT,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ
);

INSERT INTO subscriptions (slug, display_name, description, module_ids, price_monthly_cents, subaccount_limit, trial_days, status)
VALUES
  ('starter', 'Starter',
   'Monitor up to 10 client accounts with weekly health reports',
   (SELECT jsonb_agg(id) FROM modules WHERE slug = 'client_pulse'),
   NULL, 10, 14, 'active'),
  ('growth', 'Growth',
   'Monitor up to 30 client accounts with weekly health reports',
   (SELECT jsonb_agg(id) FROM modules WHERE slug = 'client_pulse'),
   NULL, 30, 14, 'active'),
  ('scale', 'Scale',
   'Monitor up to 100 client accounts with weekly health reports',
   (SELECT jsonb_agg(id) FROM modules WHERE slug = 'client_pulse'),
   NULL, 100, 14, 'active'),
  ('automation_os', 'Automation OS',
   'Full operator experience — every agent, workflow, and tool',
   (SELECT jsonb_agg(id) FROM modules WHERE slug = 'operator'),
   NULL, NULL, 14, 'active'),
  ('agency_suite', 'Agency Suite',
   'Automation OS + ClientPulse — the full agency platform',
   (SELECT jsonb_agg(id) FROM modules WHERE slug IN ('operator', 'client_pulse')),
   NULL, NULL, 14, 'active'),
  ('internal', 'Internal',
   'Synthetos internal and design-partner orgs — all modules unlocked',
   (SELECT jsonb_agg(id) FROM modules WHERE slug IN ('operator', 'client_pulse')),
   NULL, NULL, 0, 'draft');

-- ─── org_subscriptions (per-org, RLS-protected) ─────────────────────────────

CREATE TABLE org_subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id         UUID NOT NULL REFERENCES organisations(id),
  subscription_id         UUID NOT NULL REFERENCES subscriptions(id),
  billing_cycle           TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'yearly', 'comp')),
  status                  TEXT NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'paused')),
  trial_ends_at           TIMESTAMPTZ,
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  stripe_subscription_id  TEXT,
  is_comped               BOOLEAN NOT NULL DEFAULT false,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_org_subscriptions_active
  ON org_subscriptions (organisation_id)
  WHERE status IN ('trialing', 'active', 'past_due');

CREATE INDEX idx_org_subscriptions_org_id ON org_subscriptions (organisation_id);

-- RLS for org_subscriptions
ALTER TABLE org_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY org_subscriptions_tenant_isolation ON org_subscriptions
  USING (organisation_id::text = current_setting('app.organisation_id', true))
  WITH CHECK (organisation_id::text = current_setting('app.organisation_id', true));

-- ─── reports (per-org, RLS-protected) ────────────────────────────────────────

CREATE TABLE reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   UUID NOT NULL REFERENCES organisations(id),
  title             TEXT NOT NULL,
  report_type       TEXT NOT NULL DEFAULT 'portfolio_health'
    CHECK (report_type IN ('portfolio_health', 'ad_hoc')),
  status            TEXT NOT NULL DEFAULT 'generating'
    CHECK (status IN ('generating', 'complete', 'error')),
  total_clients     INTEGER NOT NULL DEFAULT 0,
  healthy_count     INTEGER NOT NULL DEFAULT 0,
  attention_count   INTEGER NOT NULL DEFAULT 0,
  at_risk_count     INTEGER NOT NULL DEFAULT 0,
  html_content      TEXT,
  metadata          JSONB,
  generated_at      TIMESTAMPTZ,
  emailed_at        TIMESTAMPTZ,
  is_first_report   BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX idx_reports_org_id ON reports (organisation_id);
CREATE INDEX idx_reports_org_generated ON reports (organisation_id, generated_at DESC);

-- RLS for reports
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE ROW LEVEL SECURITY;

CREATE POLICY reports_tenant_isolation ON reports
  USING (organisation_id::text = current_setting('app.organisation_id', true))
  WITH CHECK (organisation_id::text = current_setting('app.organisation_id', true));

-- ─── system_hierarchy_templates: add slug column ─────────────────────────────

ALTER TABLE system_hierarchy_templates ADD COLUMN slug TEXT;

-- Backfill slug from name: lowercase, replace non-alphanum with hyphens, trim
UPDATE system_hierarchy_templates
SET slug = regexp_replace(
  regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'),
  '^-+|-+$', '', 'g'
);

-- Delete the duplicate zero-slot row (keep the one with agents)
DELETE FROM system_hierarchy_templates
WHERE name = 'GHL Agency Intelligence'
  AND agent_count = 0
  AND id NOT IN (
    SELECT id FROM system_hierarchy_templates
    WHERE name = 'GHL Agency Intelligence'
    ORDER BY agent_count DESC, created_at ASC
    LIMIT 1
  );

-- Now make slug NOT NULL and add partial unique index
ALTER TABLE system_hierarchy_templates ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX uq_system_hierarchy_templates_slug
  ON system_hierarchy_templates (slug)
  WHERE deleted_at IS NULL;

COMMIT;
