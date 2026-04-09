-- Migration 0088: Shared memory blocks (P4.2)
-- Named memory blocks attachable to multiple agents with read/read_write permissions.

-- ── memory_blocks ──────────────────────────────────────────────────────────────

CREATE TABLE memory_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  subaccount_id uuid REFERENCES subaccounts(id),
  name text NOT NULL,
  content text NOT NULL,
  owner_agent_id uuid REFERENCES agents(id),
  is_read_only boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX memory_blocks_org_name_idx
  ON memory_blocks (organisation_id, name)
  WHERE deleted_at IS NULL;

CREATE INDEX memory_blocks_org_idx ON memory_blocks (organisation_id);
CREATE INDEX memory_blocks_subaccount_idx ON memory_blocks (subaccount_id)
  WHERE subaccount_id IS NOT NULL;

-- ── memory_block_attachments ───────────────────────────────────────────────────

CREATE TABLE memory_block_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id uuid NOT NULL REFERENCES memory_blocks(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id),
  permission text NOT NULL CHECK (permission IN ('read', 'read_write')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX memory_block_attachments_block_agent_idx
  ON memory_block_attachments (block_id, agent_id);

CREATE INDEX memory_block_attachments_agent_idx
  ON memory_block_attachments (agent_id);

-- ── RLS policies ───────────────────────────────────────────────────────────────

ALTER TABLE memory_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_blocks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_blocks_org_isolation ON memory_blocks;
CREATE POLICY memory_blocks_org_isolation ON memory_blocks
  USING (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.organisation_id', true) IS NOT NULL
    AND current_setting('app.organisation_id', true) <> ''
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
  );

-- memory_block_attachments is protected transitively through the memory_blocks
-- FK + CASCADE. The block_id FK ensures you can only attach to blocks you can
-- see under RLS. No independent RLS policy needed on the attachments table.
