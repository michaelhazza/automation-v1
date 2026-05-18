-- Migration E down: restore description to nullable
ALTER TABLE tasks ALTER COLUMN description DROP NOT NULL;
