-- 0288_skills_runtime_check_columns.sql
-- Trust & Verification Layer — Chunk 1, spec §6.1
--
-- Adds four columns to skills for runtime-check configuration:
--   verify               — JSONB descriptor of the runtime check (null = no check)
--   verify_null_justification — required when verify IS NULL (text rationale)
--   reversible           — whether the skill's side-effects can be undone
--   blast_radius         — scope of impact: 'self' | 'tenant' | 'external'
--
-- Backfill: DEFAULT values handle existing rows implicitly (no explicit UPDATE needed).
-- RLS: column-level additions only; no policy change required.

ALTER TABLE skills
  ADD COLUMN verify jsonb,
  ADD COLUMN verify_null_justification text,
  ADD COLUMN reversible boolean NOT NULL DEFAULT false,
  ADD COLUMN blast_radius text NOT NULL DEFAULT 'self'
    CONSTRAINT skills_blast_radius_check
      CHECK (blast_radius IN ('self', 'tenant', 'external'));
