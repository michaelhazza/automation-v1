-- DOWN MIGRATION IS PRE-PRODUCTION-ONLY. See plan.md §Chunk-4 Migration F down safety caveat. DO NOT run this down on a live production database after cutover.
BEGIN;

INSERT INTO permissions (key, description, group_name)
SELECT 'org.briefs.write', 'Create Briefs and post messages into a conversation', 'org.briefs'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE key = 'org.briefs.write');

UPDATE permission_set_items SET permission_key = 'org.briefs.write'
WHERE permission_key = 'org.tasks.write';

DELETE FROM permissions
WHERE key = 'org.tasks.write'
AND NOT EXISTS (SELECT 1 FROM permission_set_items WHERE permission_key = 'org.tasks.write');

COMMIT;
