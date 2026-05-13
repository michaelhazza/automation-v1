-- Down migration 0333: drop memory_block_version_sources table (cascade drops policy and indexes)
DROP TABLE IF EXISTS memory_block_version_sources CASCADE;
