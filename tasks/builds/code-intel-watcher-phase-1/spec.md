# Stub: Code-intel watcher Phase 1 hardening

**Trigger to activate:** Bundle with the code-graph-module-split work OR when a watcher race produces an observably stale cache.

**Scope (one paragraph).** Three reviewer-flagged Phase 1 items that ship together: cache/shard race (concurrent watcher updates corrupting `references/.code-graph/`), topology-change discrimination (distinguish "file moved" from "file deleted + new file added" so the graph doesn't drop edges), alias re-resolution (TypeScript path aliases that change mid-session need fresh resolution rather than cached stale results).

**Origin:** Code-intel-phase-0 ChatGPT R1 deferred items in legacy `tasks/todo.md`.
