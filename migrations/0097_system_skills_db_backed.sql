-- Migration 0097: system_skills DB-backed (Phase 0 of skill-analyzer-v2)
-- See docs/skill-analyzer-v2-spec.md §10 Phase 0 for the full contract.
--
-- Adds the two columns the rest of skill-analyzer-v2 depends on:
--
--   visibility text NOT NULL DEFAULT 'none'
--     The three-state visibility cascade ('none' | 'basic' | 'full') previously
--     stored as markdown frontmatter on server/skills/*.md. Validated at the
--     application layer (not via a CHECK constraint) to match the codebase's
--     existing convention of light schema-level constraints + service-layer
--     enforcement.
--
--   handler_key text NOT NULL UNIQUE
--     Pairs each skill row with a TypeScript handler in skillExecutor.ts
--     SKILL_HANDLERS. The handlerKey = slug invariant is enforced at write
--     time by createSystemSkill, at boot time by validateSystemSkillHandlers,
--     and at execute time by the skill analyzer's DISTINCT branch. UNIQUE
--     matches the slug invariant — slug already has a unique index, so this
--     constraint makes the relationship enforceable at the schema level.
--
-- Pre-existing rows: the system_skills table is dormant today (no code reads
-- or writes it). After this migration applies, run `npm run skills:backfill`
-- to upsert every server/skills/*.md file into the table. The validator that
-- runs at server boot will refuse to start until every active row has a
-- handler_key that resolves to SKILL_HANDLERS.
--
-- The handler_key column is added with a temporary default of '' so the
-- ALTER works against the (empty) existing table. The default is dropped
-- immediately after — every future INSERT must supply handler_key explicitly
-- via systemSkillService.createSystemSkill.

ALTER TABLE system_skills
  ADD COLUMN visibility text NOT NULL DEFAULT 'none';

ALTER TABLE system_skills
  ADD COLUMN handler_key text NOT NULL DEFAULT '';

ALTER TABLE system_skills
  ALTER COLUMN handler_key DROP DEFAULT;

CREATE UNIQUE INDEX system_skills_handler_key_idx
  ON system_skills (handler_key);
