DROP INDEX IF EXISTS memory_block_versions_block_body_hash_uq;
ALTER TABLE memory_block_versions DROP COLUMN IF EXISTS body_hash;
ALTER TABLE memory_blocks DROP COLUMN IF EXISTS auto_update_disabled;
