-- Migration 0093: Merge methodology into instructions, drop column
-- Skills now have a single "instructions" field instead of instructions + methodology.

-- 1. Merge methodology into instructions for org skills
UPDATE skills
SET instructions = CASE
  WHEN instructions IS NOT NULL AND methodology IS NOT NULL
    THEN instructions || E'\n\n' || methodology
  WHEN instructions IS NULL AND methodology IS NOT NULL
    THEN methodology
  ELSE instructions
END,
updated_at = NOW()
WHERE methodology IS NOT NULL;

ALTER TABLE skills DROP COLUMN IF EXISTS methodology;

-- 2. Same for system_skills (table exists but is unused — clean it up anyway)
UPDATE system_skills
SET instructions = CASE
  WHEN instructions IS NOT NULL AND methodology IS NOT NULL
    THEN instructions || E'\n\n' || methodology
  WHEN instructions IS NULL AND methodology IS NOT NULL
    THEN methodology
  ELSE instructions
END,
updated_at = NOW()
WHERE methodology IS NOT NULL;

ALTER TABLE system_skills DROP COLUMN IF EXISTS methodology;
