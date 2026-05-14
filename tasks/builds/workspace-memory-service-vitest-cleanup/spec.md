# Stub: workspaceMemoryService vitest cleanup

**Trigger to activate:** When the next test-authoring round touches `workspaceMemoryService` test files OR when a CI run flakes on the module-load `await client.end()` pattern.

**Scope (one paragraph).** Finish TI-005's tail: two test files in `server/services/__tests__/` still execute `await client.end()` at module load time. Convert both to vitest's `beforeAll`/`afterAll` lifecycle so the connection close happens only when tests run, not when the module is imported. Mechanical fix; tested pattern already exists in sibling files.

**Origin:** TI-005 tail in legacy `tasks/todo.md`.
