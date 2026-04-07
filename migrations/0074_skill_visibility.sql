-- =============================================================================
-- Skill visibility — replace boolean contents_visible with three-state enum
--
-- Spec: user instruction round 4 (this branch).
--
-- Why: contents_visible was a binary "show or hide everything" flag. The
-- product design now needs three states so org admins can advertise the
-- existence of a skill without leaking its body:
--
--   none   — skill is invisible to lower tiers entirely
--   basic  — skill name + description visible only; body stripped
--   full   — everything visible (instructions, methodology, definition)
--
-- Default is 'none' for ALL skills (system and org). Existing rows are
-- forcibly reset to 'none' regardless of their previous contents_visible
-- value — admins must explicitly opt skills back in via the new UI.
-- =============================================================================

ALTER TABLE skills
  DROP COLUMN IF EXISTS contents_visible;

ALTER TABLE skills
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'none';

ALTER TABLE skills
  ADD CONSTRAINT skills_visibility_chk
  CHECK (visibility IN ('none', 'basic', 'full'));

-- system_skills.visibility used to live as a boolean isVisible in the .md
-- frontmatter (file-based source of truth — no DB column). The .md files
-- are migrated separately by replacing the isVisible line with visibility:
-- none. Nothing to do at the database layer for system_skills.
