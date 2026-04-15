-- Phase G / §7.4 / G7.1-G7.3 — auto-attach policy wiring.
--
-- Adds the columns and tombstone semantics required for Reference-note /
-- Memory-Block auto-attach across a sub-account's linked agents:
--
--   memory_blocks.auto_attach (boolean, default false)
--     Drives the two auto-attach entry points in `memoryBlockService`:
--       1. createBlock with auto_attach=true  → iterate linked agents and
--          insert memory_block_attachments rows (source='auto_attach').
--       2. subaccountAgentService.linkAgent → iterate blocks with
--          auto_attach=true in this subaccount and insert attachments.
--
--   memory_block_attachments.source ('manual' | 'auto_attach')
--     Distinguishes inherited attachments from manual ones so the Knowledge
--     page UI can show the right affordance ("inherited from Reference X"
--     vs. "manually attached").
--
--   memory_block_attachments.deleted_at (timestamptz, nullable)
--     Soft-delete tombstone. `detachBlock` now sets `deleted_at` instead of
--     hard-deleting the row. Auto-attach iteration uses ON CONFLICT (block_id,
--     agent_id) DO NOTHING so a tombstoned row is NOT revived — honours G7.3
--     "attachments created via auto-attach can be individually detached and
--     do not reappear".

ALTER TABLE memory_blocks
  ADD COLUMN auto_attach BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE memory_block_attachments
  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD CONSTRAINT memory_block_attachments_source_chk
    CHECK (source IN ('manual', 'auto_attach'));

-- Drop and recreate the unique index so it applies to live attachments
-- AND to tombstoned ones (we need the tombstone to block re-auto-attach).
-- The existing index is already `(block_id, agent_id)` without a predicate
-- — so it already enforces one row per (block, agent) regardless of
-- tombstone state. No rebuild needed.

-- Supports the auto-attach entry points finding candidate blocks.
CREATE INDEX memory_blocks_subaccount_auto_attach_idx
  ON memory_blocks (subaccount_id)
  WHERE auto_attach = true AND deleted_at IS NULL;
