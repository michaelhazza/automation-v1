-- migrations/0101_skill_versions.sql
CREATE TABLE skill_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_skill_id uuid REFERENCES system_skills(id) ON DELETE CASCADE,
  skill_id        uuid REFERENCES skills(id) ON DELETE CASCADE,
  version_number  integer NOT NULL,
  name            text NOT NULL,
  description     text,
  definition      jsonb NOT NULL,
  instructions    text,
  change_summary  text,
  authored_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  regression_ids  uuid[] NOT NULL DEFAULT '{}',
  simulation_pass_count   integer NOT NULL DEFAULT 0,
  simulation_total_count  integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_versions_one_source CHECK (
    (system_skill_id IS NOT NULL AND skill_id IS NULL) OR
    (system_skill_id IS NULL AND skill_id IS NOT NULL)
  )
);
CREATE INDEX skill_versions_system_skill_idx ON skill_versions (system_skill_id, version_number DESC);
CREATE INDEX skill_versions_skill_idx ON skill_versions (skill_id, version_number DESC);
