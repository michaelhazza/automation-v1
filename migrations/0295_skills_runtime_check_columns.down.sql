ALTER TABLE skills
  DROP COLUMN IF EXISTS verify,
  DROP COLUMN IF EXISTS verify_null_justification,
  DROP COLUMN IF EXISTS reversible,
  DROP COLUMN IF EXISTS blast_radius;
