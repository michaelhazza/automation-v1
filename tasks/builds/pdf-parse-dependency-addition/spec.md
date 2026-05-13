# Stub: pdf-parse dependency addition + PDF support hardening

**Trigger to activate:** When the next document-ingestion path needs PDF support OR when a real customer uploads a PDF and the absence becomes user-visible.

**Scope (one paragraph).** Add `pdf-parse` as a direct dependency, audit the surrounding ingestion path for PDF support hardening, and amend the relevant spec. Requires HITL approval (per legacy todo.md REQ #C12) because it's a new runtime dependency with a non-trivial transitive footprint.

**Origin:** REQ #C12 in legacy `tasks/todo.md`.
