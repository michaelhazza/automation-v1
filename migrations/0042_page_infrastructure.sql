-- Page Infrastructure: multi-tenant page hosting for agent-controlled landing pages

-- 1. page_projects
CREATE TABLE IF NOT EXISTS page_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id UUID NOT NULL REFERENCES subaccounts(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  theme JSONB,
  custom_domain TEXT,
  github_repo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX page_projects_subaccount_idx ON page_projects(subaccount_id);
CREATE INDEX page_projects_org_idx ON page_projects(organisation_id);
CREATE INDEX page_projects_slug_subaccount_idx ON page_projects(subaccount_id, slug);
CREATE UNIQUE INDEX page_projects_slug_unique ON page_projects(slug) WHERE deleted_at IS NULL;

-- 2. pages
CREATE TABLE IF NOT EXISTS pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES page_projects(id),
  slug TEXT NOT NULL,
  page_type TEXT NOT NULL CHECK (page_type IN ('website', 'landing')),
  title TEXT,
  html TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  meta JSONB,
  form_config JSONB,
  created_by_agent_id UUID REFERENCES agents(id),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pages_project_slug_unique UNIQUE (project_id, slug)
);

CREATE INDEX pages_project_idx ON pages(project_id);
CREATE INDEX pages_project_status_idx ON pages(project_id, status);

-- 3. page_versions
CREATE TABLE IF NOT EXISTS page_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id),
  html TEXT,
  meta JSONB,
  change_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX page_versions_page_idx ON page_versions(page_id);

-- 4. project_integrations
CREATE TABLE IF NOT EXISTS project_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES page_projects(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('crm', 'payments', 'email', 'ads', 'analytics')),
  connection_id UUID NOT NULL REFERENCES integration_connections(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_integrations_project_purpose UNIQUE (project_id, purpose)
);

CREATE INDEX project_integrations_project_idx ON project_integrations(project_id);

-- 5. form_submissions
CREATE TABLE IF NOT EXISTS form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id),
  data JSONB NOT NULL,
  submission_hash TEXT NOT NULL,
  integration_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (integration_status IN ('pending', 'processing', 'success', 'partial_failure', 'failed')),
  integration_results JSONB,
  ip_address TEXT,
  user_agent TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT form_submissions_hash_unique UNIQUE (submission_hash)
);

CREATE INDEX form_submissions_page_idx ON form_submissions(page_id);
CREATE INDEX form_submissions_submitted_at_idx ON form_submissions(submitted_at);
CREATE INDEX form_submissions_status_idx ON form_submissions(integration_status);

-- 6. page_views
CREATE TABLE IF NOT EXISTS page_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id),
  session_id TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  country TEXT,
  device_type TEXT,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX page_views_page_idx ON page_views(page_id);
CREATE INDEX page_views_page_viewed_at_idx ON page_views(page_id, viewed_at);

-- 7. conversion_events
CREATE TABLE IF NOT EXISTS conversion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id),
  submission_id UUID REFERENCES form_submissions(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN ('form_submitted', 'checkout_started', 'checkout_completed', 'checkout_abandoned', 'contact_created')),
  session_id TEXT,
  metadata JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX conversion_events_page_idx ON conversion_events(page_id);
CREATE INDEX conversion_events_page_event_type_idx ON conversion_events(page_id, event_type);
CREATE INDEX conversion_events_occurred_at_idx ON conversion_events(occurred_at);

-- updated_at triggers
CREATE OR REPLACE TRIGGER page_projects_updated_at
  BEFORE UPDATE ON page_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER pages_updated_at
  BEFORE UPDATE ON pages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
