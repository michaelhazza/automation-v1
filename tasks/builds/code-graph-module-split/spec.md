# Stub: Code-graph module split

**Trigger to activate:** When the 1,113-line code-graph file next needs a non-trivial change OR when type-inference / compile times on the file become friction.

**Scope (one paragraph).** Split the 1,113-line code-graph implementation into three modules: extractor (read TypeScript source, emit AST-derived graph nodes), cache (read/write `references/.code-graph/`), watcher (subscribe to filesystem events, drive incremental updates). Concrete refactor with a clear shape; no behaviour change, just structure.

**Origin:** Code-graph refactor split in legacy `tasks/todo.md`.
