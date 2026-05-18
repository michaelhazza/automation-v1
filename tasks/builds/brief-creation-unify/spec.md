# Stub: Brief creation unify endpoints

**Status:** superseded by docs/superpowers/specs/2026-05-18-new-task-modal-overhaul-spec.md

**Trigger to activate:** When the next divergence between `/api/briefs` and `/api/session/message` is discovered OR when a third brief-creation entry point is added.

**Scope (one paragraph).** Six related architectural items from PR #233 that all touch the brief-creation entry-point unification: F1 (unify `/api/briefs` and `/api/session/message` response envelope; service extraction shipped 2026-04-29, response harmonisation deferred to this build); F5 (refactor `createBrief` into `normalizeBriefInput` + `classifyBriefIntent` + `persistBrief`); F6 (rate limiting / abuse control on `/api/session/message`); F7 (bound `findEntitiesMatching` ILIKE search — min hint length, prefix fallback, or pg_trgm index); F8 (tests for `/api/session/message` Path A/B/C, cross-tenant rejection, stale subaccount drop); F15 (real `organisationName` / `subaccountName` from Path C). Six items, one routes file family.

**Origin:** PR #233 F1 / F5 / F6 / F7 / F8 / F15 in legacy `tasks/todo.md`.
