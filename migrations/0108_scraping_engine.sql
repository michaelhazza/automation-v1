-- ═══════════════════════════════════════════════════════════════
-- 0108 — Scraping Engine: selectors + cache tables
-- ═══════════════════════════════════════════════════════════════

-- 1. Scraping selectors — learned element fingerprints
CREATE TABLE scraping_selectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id UUID REFERENCES subaccounts(id),
  url_pattern TEXT NOT NULL,
  selector_name TEXT NOT NULL,
  selector_group TEXT,
  css_selector TEXT NOT NULL,
  element_fingerprint JSONB NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  miss_count INTEGER NOT NULL DEFAULT 0,
  last_matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX scraping_selectors_org_idx
  ON scraping_selectors (organisation_id);
CREATE INDEX scraping_selectors_url_pattern_idx
  ON scraping_selectors (organisation_id, url_pattern);
CREATE INDEX scraping_selectors_group_idx
  ON scraping_selectors (organisation_id, selector_group);
CREATE UNIQUE INDEX scraping_selectors_upsert_key
  ON scraping_selectors (organisation_id, subaccount_id, url_pattern, selector_group, selector_name)
  NULLS NOT DISTINCT;

-- 2. Scraping cache — pure dedup cache (monitoring baselines stored in workspace memory)
CREATE TABLE scraping_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  subaccount_id UUID REFERENCES subaccounts(id),
  url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  extracted_data JSONB,
  raw_content_preview TEXT,
  ttl_seconds INTEGER NOT NULL DEFAULT 3600,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX scraping_cache_org_url_idx
  ON scraping_cache (organisation_id, subaccount_id, url)
  NULLS NOT DISTINCT;
CREATE INDEX scraping_cache_fetched_at_idx
  ON scraping_cache (fetched_at);
CREATE INDEX scraping_cache_expiry_idx
  ON scraping_cache (fetched_at, ttl_seconds);

-- 3. RLS policies (standard org-scoped isolation — matching migrations 0079-0083 convention)
ALTER TABLE scraping_selectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraping_selectors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scraping_selectors_org_isolation ON scraping_selectors;
CREATE POLICY scraping_selectors_org_isolation ON scraping_selectors
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

ALTER TABLE scraping_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraping_cache FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scraping_cache_org_isolation ON scraping_cache;
CREATE POLICY scraping_cache_org_isolation ON scraping_cache
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );
