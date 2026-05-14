# Stub: Operator Session Identity v2

**Trigger to activate:** Before the OpenClaw adapter activation OR when the operator_session credential primitive next needs to be production-load tested.

**Scope (one paragraph).** Pick up the 13 deferred items from operator-session-identity V1 (PR #286): OSI-DEF-1 (credentialBrokerService bare-db conversion), OSI-DEF-2 (defence-in-depth token encryption on mock path), OSI-DEF-3 (N+1 stale-disclosure pass coalescing), OSI-DEF-4 (`type="button"` sweep across new Govern modals), OSI-DEF-5 (down-migration ordering convention enforcement), OSI-DEF-6/7 (agent-allowlist probing + UUID validation), OSI-DEF-8 (generic connections route exposure), OSI-DEF-9 (`usability_state` CHECK constraint), OSI-DEF-10 (PII minimisation V1 stub), OSI-DEF-11 (deploy-coupled disclosure version), OSI-DEF-12 (legacy bookmark workspace-picker UX), OSI-DEF-13 (agent picker instead of raw ID entry). Coherent enough for one Phase 2 spec; each item carries a "when to revisit" trigger inline.

**Origin:** OSI-DEF-1 through OSI-DEF-13 in legacy `tasks/todo.md`.
