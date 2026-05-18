-- Migration F: rename permission key 'org.briefs.write' to 'org.tasks.write'
BEGIN;

INSERT INTO permissions (key, description, group_name)
SELECT 'org.tasks.write', 'Create Tasks and post messages into a conversation', 'org.tasks'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE key = 'org.tasks.write');

UPDATE permission_set_items SET permission_key = 'org.tasks.write'
WHERE permission_key = 'org.briefs.write';

DELETE FROM permissions
WHERE key = 'org.briefs.write'
AND NOT EXISTS (SELECT 1 FROM permission_set_items WHERE permission_key = 'org.briefs.write');

COMMIT;
