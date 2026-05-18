-- Migration D: update conversations.scope_type from 'brief' to 'task'
UPDATE conversations SET scope_type = 'task' WHERE scope_type = 'brief';
