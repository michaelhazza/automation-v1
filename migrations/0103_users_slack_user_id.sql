-- migrations/0103_users_slack_user_id.sql
ALTER TABLE users ADD COLUMN slack_user_id text;
CREATE UNIQUE INDEX users_slack_user_id_idx ON users (slack_user_id) WHERE slack_user_id IS NOT NULL;
