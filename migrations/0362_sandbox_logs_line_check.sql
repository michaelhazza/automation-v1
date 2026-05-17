BEGIN;
-- Backfill: the previous application cap was 65,536 bytes (~64 KB) via
-- MAX_LOG_LINE_BYTES; any existing row with a line longer than the new
-- 10,000-character cap would block this ALTER TABLE on deploy. Truncate
-- over-cap rows up-front so the CHECK validates cleanly.
UPDATE sandbox_logs
  SET line = left(line, 10000)
  WHERE char_length(line) > 10000;
ALTER TABLE sandbox_logs
  ADD CONSTRAINT sandbox_logs_line_max_length CHECK (char_length(line) <= 10000);
COMMIT;
