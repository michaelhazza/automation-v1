-- Migration C (down): restore tasks.brief column

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS brief text;
