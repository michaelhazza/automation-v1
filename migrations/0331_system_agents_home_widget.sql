-- Chunk 13b — Add system_agents.home_widget jsonb column
-- Generic primitive: nullable column that any system_agents row may populate.
-- The EA-specific seed lives in 0332 (chunk 15).

ALTER TABLE system_agents ADD COLUMN IF NOT EXISTS home_widget jsonb;

COMMENT ON COLUMN system_agents.home_widget IS
  'Optional home-widget declaration (HomeWidgetDeclaration shape). NULL means the template does not surface to the home zone.';
