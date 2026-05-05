-- Down: drop the three system incident tables created in 0224.
DROP TABLE IF EXISTS system_incident_suppressions;
DROP TABLE IF EXISTS system_incident_events;
DROP TABLE IF EXISTS system_incidents;
