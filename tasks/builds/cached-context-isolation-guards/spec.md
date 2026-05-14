# Stub: Cached-context isolation enforcement primitives

**Trigger to activate:** Per `docs/cached-context-infrastructure-spec.md` §8.7 — when a concrete observed cross-subaccount data leak surfaces on cached-context tables OR when the next service is added that needs read/write access to cached-context tables.

**Scope (one paragraph).** Build the enforcement primitives for cached-context isolation: (a) `assertSubaccountScopedRead(query, subaccountId)` shared helper used by every cached-context read site, plus a CI gate that fails when a cached-context table is queried without the helper (CHATGPT-PR211-F2a); (b) write-side `{ subaccountId: string } | { orgScoped: true; subaccountId: null }` discriminated input type threaded through every cached-context write entry point, plus promotion of `server/lib/cachedContextWriteScope.ts` from log-only to fail-closed assertion (CHATGPT-PR211-F2b). Spec §8.7 already locks the design — this is the enforcement-primitive build.

**Origin:** CHATGPT-PR211-F2a and F2b in legacy `tasks/todo.md`.
