-- Rollback of 0294: drop document_promotion_audit and its FORCE-RLS flag.
-- Idempotent — wrapped in DO block so the NO FORCE step is a no-op when the
-- table does not yet exist (migrate-runner convention: this file is picked up
-- in lex order BEFORE 0294.sql against a fresh DB).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'document_promotion_audit') THEN
    EXECUTE 'ALTER TABLE document_promotion_audit NO FORCE ROW LEVEL SECURITY';
  END IF;
END $$;
DROP TABLE IF EXISTS document_promotion_audit;
