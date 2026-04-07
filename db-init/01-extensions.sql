-- Mounted into /docker-entrypoint-initdb.d/ in docker-compose.yml. Postgres
-- runs every .sql file in this directory exactly once, on first boot of an
-- empty data volume. Extensions enabled here are required by the schema in
-- server/db/schema/* — without them, `drizzle-kit push` fails before it can
-- create any tables.
CREATE EXTENSION IF NOT EXISTS vector;
