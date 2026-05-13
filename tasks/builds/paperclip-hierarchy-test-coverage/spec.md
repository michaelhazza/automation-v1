# Stub: Paperclip-hierarchy Chunk 4a test coverage + return-shape contract

**Trigger to activate:** Before the paperclip-hierarchy delegation surface ships its next behaviour change OR when one of the six untested branches produces a latent bug.

**Scope (one paragraph).** Six missing behavioural tests for `executeConfigListAgents`, `executeSpawnSubAgents`, and `executeReassignTask` (REQ #C4a-1 through #C4a-5 plus the missing-hierarchy WARN fallthrough cases) PLUS the REQ #C4a-6 architectural decision: do delegation errors adopt the spec §4.3 nested envelope `{ success: false, error: { code, message, context } }`, or stay grandfathered as flat-string errors? One focused chunk — extract a pure helper `evaluateSpawnPolicy({ effectiveScope, ... })` and unit-test, or add behavioural integration tests with DB + logger mocks; the path choice ships with the test pass.

**Origin:** Paperclip-hierarchy chunk 4a tests + REQ #C4a-6 in legacy `tasks/todo.md`.
