BEGIN;
ALTER TABLE sandbox_logs
  ADD CONSTRAINT sandbox_logs_line_max_length CHECK (char_length(line) <= 10000);
COMMIT;
