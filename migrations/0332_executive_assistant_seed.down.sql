-- 0332_executive_assistant_seed.down.sql
-- Removes EA template row and the per-user partial index.
-- Never touches the home_widget column (owned by migration 0331).

DROP INDEX IF EXISTS agents_personal_assistant_per_user_idx;
DELETE FROM system_agents WHERE slug = 'executive-assistant';
