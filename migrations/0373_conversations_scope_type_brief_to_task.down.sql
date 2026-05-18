-- DOWN MIGRATION IS PRE-PRODUCTION-ONLY. See plan.md §Chunk-4 Migration D down safety caveat.
-- The spec (§6.3) designates this as a deliberate no-op: reversing the data update in production
-- would incorrectly reassign conversations created as 'task' back to 'brief'.
SELECT 1;
