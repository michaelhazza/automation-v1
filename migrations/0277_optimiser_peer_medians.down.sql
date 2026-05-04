DROP MATERIALIZED VIEW IF EXISTS optimiser_skill_peer_medians;
DELETE FROM system_agents WHERE slug = 'subaccount-optimiser';
