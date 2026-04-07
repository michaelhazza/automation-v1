-- =============================================================================
-- Skill contents visibility flag — Code Change A from the Reporting Agent spec
-- Spec: docs/reporting-agent-paywall-workflow-spec.md §3 / T6
--
-- The agent runtime always has access to skill bodies regardless of this
-- flag. The flag is purely a UI/API concern: it controls whether lower-tier
-- users (subaccount admins viewing an org skill) can read the skill body
-- and access the "Manage Skill" page. Name and description are ALWAYS
-- visible because the LLM agent must see them to know which skills are
-- attached.
--
-- For system_skills, visibility is already managed via the .md frontmatter
-- field `isVisible` (see server/services/systemSkillService.ts). This
-- migration only adds the equivalent for org-scoped skills, where there is
-- no .md file backing the row.
-- =============================================================================

ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS contents_visible BOOLEAN NOT NULL DEFAULT FALSE;

-- No index needed — this flag is read on the detail endpoint per request,
-- not used as a filter on list queries.
