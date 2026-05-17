-- OSI-DEF-9: tighten integration_connections.usability_state to the closed
-- enum the operator-session lifecycle service emits. Without this constraint
-- the column accepts arbitrary text; the enum lives in TypeScript only.

ALTER TABLE integration_connections
  ADD CONSTRAINT usability_state_check
  CHECK (usability_state IN (
    'connected_usable',
    'connected_needs_consent',
    'connected_needs_reauth',
    'connected_unverified',
    'revoked',
    'disabled'
  ));
