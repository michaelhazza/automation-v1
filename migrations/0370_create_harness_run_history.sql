-- system-scoped: harness operational telemetry, not tenant data; documented opt-out in spec §7.1

CREATE TABLE harness_run_history (
  id                 UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_slug          TEXT        NOT NULL,
  mode               TEXT        NOT NULL,
  score              NUMERIC(4,3),
  baseline_score     NUMERIC(4,3),
  baseline_tolerance NUMERIC(4,3),
  outcome            TEXT        NOT NULL,
  browser_version    TEXT        NOT NULL,
  playwright_version TEXT        NOT NULL,
  template_digest    TEXT        NOT NULL,
  run_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT harness_run_history_mode_check
    CHECK (mode IN ('blocking','nightly','advisory','disabled')),
  CONSTRAINT harness_run_history_outcome_check
    CHECK (outcome IN ('pass','fail','baseline_established','site_unavailable','parse_error'))
);

CREATE INDEX harness_run_history_site_slug_run_at_idx
  ON harness_run_history (site_slug, run_at DESC);
