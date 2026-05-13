# Stub: Auto-knowledge-retrieval v2 ranker realignment

**Trigger to activate:** Per ADR-0017 — when a real retrieval failure surfaces, when 30+ days of production retrieval telemetry show a measurable quality gap, OR when a feature spec depends on per-document scoring beyond v1's dedupe key.

**Scope (one paragraph).** Realign AKR after ADR-0017 locks the v1-simplified-vs-multi-signal-learned-ranker direction. Consolidate deferred items: AKR-CONF-1 / CONF-2 / CONF-5 / CONF-6 / CONF-9 and PR-REV-B2 / B3 / S2 / S4 / S6. The work is focused once ADR-0017's direction is concrete — a single chunk that rebuilds the ranker per the locked decision.

**Origin:** Auto-Knowledge-Retrieval ranker realignment in legacy `tasks/todo.md`; depends on ADR-0017.
