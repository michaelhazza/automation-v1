-- migration: 0203_tasks_delegation_direction
ALTER TABLE tasks ADD COLUMN delegation_direction text;

ALTER TABLE tasks ADD CONSTRAINT tasks_delegation_direction_chk
  CHECK (delegation_direction IN ('down', 'up', 'lateral'));
