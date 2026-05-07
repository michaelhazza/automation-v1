# Spec Conformance Log

**Spec:** `tasks/builds/consolidation-govern/spec.md`
**Spec commit at check:** `4557dd3a` (HEAD of `ui-consolidation-govern`)
**Branch:** `ui-consolidation-govern`
**Base (merge-base with main):** `79a95a52`
**Scope:** all chunks C1–C13 (caller-confirmed completed implementation)
**Changed-code set:** 47 files (committed) + plan.md (untracked)
**Run at:** 2026-05-07T20:21:46Z
**Commit at finish:** `374af7f4`

---

## Summary

- Requirements extracted:     50
- PASS:                       30
- MECHANICAL_GAP → fixed:      0
- DIRECTIONAL_GAP → deferred: 16
- AMBIGUOUS → deferred:        2
- OUT_OF_SCOPE → skipped:      0
- PARTIAL/PASS-with-caveat:    2 (REQ-18 documented schema gap; REQ-37 OAuth capabilities not populated)

**Verdict:** NON_CONFORMANT (18 blocking gaps — see deferred items)

The implementation lands the structural shape of the spec — all named files exist, all named endpoints route, migration ships the named columns, pure aggregators carry spec-named function names and pass their tests. Where it diverges is in **wire-contract field shape**, **error-code closure**, **filterOptions snapshot semantics**, and **frontend literal copy**.

These are not mechanical typos. Each requires a small design judgment (which DB column sources `name`? do we add a JOIN or a separate query for `lastSync`? rewrite the CTE to compute filter counts pre-filter? swap the wording?). Per the fail-closed posture, all routed to `tasks/todo.md`.

---

## Requirements extracted (full checklist)

### §4.1 Knowledge — list + approve / reject / override

| # | Section | Requirement | Verdict |
|---|---|---|---|
| REQ-1 | §4.1 | `GET /api/knowledge` exists, takes `KnowledgeListQuery` | PASS |
| REQ-2 | §4.1 | `POST /api/knowledge/:id/approve` (state-based idempotent) | PASS |
| REQ-3 | §4.1 | `POST /api/knowledge/:id/reject` (state-based) | PASS |
| REQ-4 | §4.1 | `POST /api/knowledge/:id/override` with body `{ body }` | PASS (extended with `expectedEtag` per §6) |
| REQ-5 | §4.1 | Override sets `auto_update_disabled = true`; status stays `in_use` | PASS |
| REQ-6 | §4.1 | Override pre-condition: `status='in_use'`, else 409 `invalid_state_transition` with `currentStatus` | PASS |
| REQ-7 | §4.1 | `KnowledgeEntry` shape includes `id, kind, body, confidence (0-1), status, source, subaccount, autoUpdateDisabled, lastEditedBy` | PARTIAL — `source.runId` returns empty string, `lastEditedBy` returns null. Other fields PASS. → CONSOL-GOV-DEF-1 |
| REQ-8 | §4.1 | `auto_update_disabled` is separate filter (not 4th status) | PASS |
| REQ-9 | §4.1, §6 | Auto-extraction skips BOTH the `memory_blocks` UPDATE AND the `memory_block_versions` INSERT when `auto_update_disabled = true` | PASS — gate wired into `memoryBlockService.upsertBlock` |

### §4.0 List endpoint invariants

| # | Section | Requirement | Verdict |
|---|---|---|---|
| REQ-10 | §4.0 | Default sort ends with `id` tiebreaker; tiebreaker direction follows primary sort | PASS |
| REQ-11 | §4.0 | `limit` clamped ≤ 50 | PASS |
| REQ-12 | §4.0 | `q` is case-insensitive partial substring | PASS |
| REQ-13 | §4.0 | `q` knowledge searches `body + source.agentName + source.runId` (§4.8) | PARTIAL — implementation searches only `mb.content` (body). agentName + runId not searched. → CONSOL-GOV-DEF-17 |
| REQ-14 | §4.0 | `filterOptions` counts computed AFTER RLS scoping, BEFORE applying caller's filter selection | FAIL — knowledge `listEntries` and spend `listLedger` aggregate filter counts FROM the same `base` CTE that already includes user filters; counts are post-filter. Connections facetRows query is pre-filter — that one passes. → CONSOL-GOV-DEF-2 |
| REQ-15 | §4.0 | `filterOptions` ordered by `count DESC, value ASC` IN SQL (not JS) | PASS in all three services |
| REQ-16 | §4.0 | Counts and rows from same SQL statement / CTE (snapshot-consistent) | PARTIAL — knowledge and ledger use single CTE; connections runs row query and facet query in two separate `db.execute` calls. → CONSOL-GOV-DEF-3 |

### §4.2 Spend Ledger

| # | Section | Requirement | Verdict |
|---|---|---|---|
| REQ-17 | §4.2 | `GET /api/spend/ledger` with `LedgerQuery` shape | PASS |
| REQ-18 | §4.2 | `LedgerRow.tokensIn / tokensOut / model` | PARTIAL — schema doesn't track these (plan §3 Gap R3); implementation returns `null`. Acceptable per documented gap. PASS-with-caveat |
| REQ-19 | §4.2 | `KnowledgeListResponse.filterOptions` returns options for status, kind, agent | PARTIAL — implementation only returns `status` filterOptions. Missing `kind`, `agent`. → CONSOL-GOV-DEF-18 |

### §4.3 / §4.11 Caps & pace

| # | Section | Requirement | Verdict |
|---|---|---|---|
| REQ-20 | §4.3 | `GET /api/spend/caps` returns `CapsResponse` | PASS |
| REQ-21 | §4.11 | `periodResetAt`, `paceWindow`, `paceProjectedEndOfPeriodUsd` added | PASS |

### §4.4 Spend insights

| # | Section | Requirement | Verdict |
|---|---|---|---|
| REQ-22 | §4.4 | `GET /api/spend/insights?scope=org` returns `SpendInsights` | PASS |
| REQ-23 | §4.4 | UTC-anchored MTD; deltaPct vs previous full calendar month; runs30d rolling | PASS |
| REQ-24 | §4.4 | Previous-month-zero → null deltaPct | PASS (tested) |

### §4.5 Spend trends (top-5 + Other rollup)

| # | Section | Requirement | Verdict |
|---|---|---|---|
| REQ-25 | §4.5 | `GET /api/spend/trends?scope=org` returns `SpendTrends` | PASS |
| REQ-26 | §4.5 | actual ≤ 5 → no Other; > 5 → top-4 + synthetic `__other__` at index 4 | PASS (tested) |
| REQ-27 | §4.5 | `monthLabels` length 6, oldest → current | PASS |
| REQ-28 | §4.5 | Per-workspace cap6moCents reflects historical cap per month | PARTIAL — implementation uses current cap repeated across all 6 months. Schema does not track per-month cap history; defensible approximation but spec implies historical lookup. → CONSOL-GOV-DEF-4 |

### §4.6 Connections — unified list

| # | Section | Requirement | Verdict |
|---|---|---|---|
| REQ-29 | §4.6 | `GET /api/connections` returns unified list | PASS (route exists) |
| REQ-30 | §4.6 | `Connection` wire shape: `id, name, provider, authMethod, status, lastSyncAt, owner: { kind, id, name }, createdAt` | FAIL — backend returns `{ id, kind, provider, label, displayName, authMethod, status, createdAt }`. Missing on the wire: `name`, `lastSyncAt`, `owner`. Frontend reads `r.name`, `r.lastSyncAt`, `r.owner.kind/id/name` — runtime undefined access. → CONSOL-GOV-DEF-5 |
| REQ-31 | §4.6 | `ConnectionsQuery.provider`, `authMethod`, `status` are arrays | FAIL — backend Zod schema accepts only single-value enum (not array). → CONSOL-GOV-DEF-6 |
| REQ-32 | §4.6 | `ConnectionsQuery.sortKey` enum: `'name' \| 'provider' \| 'authMethod' \| 'status' \| 'lastSync' \| 'owner'` | FAIL — backend has no `sortKey` parameter; always sorts by `created_at`. → CONSOL-GOV-DEF-7 |
| REQ-33 | §4.6 | `GET /api/connections/:id` returns full detail (kind-specific) | NOT IMPLEMENTED — only `/usage` and `/test` exist on `:id`. → CONSOL-GOV-DEF-8 |

### §4.9 Connection test

| # | Section | Requirement | Verdict |
|---|---|---|---|
| REQ-34 | §4.9 | `POST /api/connections/:id/test` always returns 200 | PASS |
| REQ-35 | §4.9 | 10s monotonic timeout via `process.hrtime.bigint()` | PASS |
| REQ-36 | §4.9 | `error.code` closed enum: `'TIMEOUT' \| 'AUTH_FAILED' \| 'NETWORK_ERROR' \| 'PROVIDER_ERROR'` | FAIL — implementation emits `'NO_CREDENTIALS'`, `'TOKEN_EXPIRED'`, `'NOT_FOUND'`, `'SERVER_ERROR'`, `'UNKNOWN'` — five values outside the closed spec enum. → CONSOL-GOV-DEF-9 |
| REQ-37 | §4.9 | Capabilities returned for OAuth (verified scopes) | PARTIAL — only MCP returns `capabilities`; OAuth path does not populate scopes. → CONSOL-GOV-DEF-10 |
| REQ-38 | §4.9 | Rate limit max 6 tests per connection per minute | NOT IMPLEMENTED. Plan §R4 acknowledged this could defer; spec lists it as a hard requirement. → CONSOL-GOV-DEF-11 |

### §4.10 Connection disconnect — usage aggregator

| # | Section | Requirement | Verdict |
|---|---|---|---|
| REQ-39 | §4.10 | `ConnectionUsage` shape: `agents [{ id, name, lastUsedAt }], recurringTasks [{ id, name, nextFireAt }], workflows [{ id, name }]` | FAIL — `agents [{ id, name }]` missing `lastUsedAt`; `recurringTasks: []` always (no aggregation source); workflows OK. → CONSOL-GOV-DEF-12 |
| REQ-40 | §4.10 | Single SQL statement (CTE) so counts are snapshot-consistent | PARTIAL — implementation uses two separate `db.execute` calls under READ COMMITTED. Plan §R5 acknowledges. → CONSOL-GOV-DEF-13 |

### §4.11 Pace + period semantics (UI)

| # | Section | Requirement | Verdict |
|---|---|---|---|
| REQ-41 | §4.11 | UI renders `<HelpHint>` on pace bar with copy `"Pace based on the last 7 days of spend extrapolated to the period end."` | FAIL — `SpendingPage.CapsTab` shows static text `"7-day window"` next to pace, no `<HelpHint>` component, different copy. → CONSOL-GOV-DEF-14 |

### §4.12 / §4.13 Knowledge UX clarifiers + confirmation copy

| # | Section | Requirement | Verdict |
|---|---|---|---|
| REQ-42 | §4.12 | Confidence column carries `<HelpHint>` tooltip | PASS (wording adapted; equivalent semantics) |
| REQ-43 | §4.12 | Pending-review + confidence > 0.8 shows "high confidence" badge | PASS |
| REQ-44 | §4.12 | `runId` opens `/run-trace/<id>?embedded=1` in `<Modal size="iframe">` | PASS |
| REQ-45 | §4.13 | Reject confirm copy literal | PASS — exact match |
| REQ-46 | §4.12 | Override confirm copy literal | AMBIGUOUS — implementation uses semantically-equivalent rewrite. → CONSOL-GOV-DEF-15 |
| REQ-47 | §4.10 | Disconnect dialog copy literal | AMBIGUOUS — implementation uses different (more verbose) copy. → CONSOL-GOV-DEF-16 |

### §4.14 Frontend permission gating

| # | Section | Requirement | Verdict |
|---|---|---|---|
| REQ-48 | §4.14 | Knowledge approve/reject/override hidden when no `knowledge:write` perm | PASS |
| REQ-49 | §4.14 | Connection disconnect/refresh hidden for non-org-admin on org-owned | PASS |
| REQ-50 | §4.14 | Org-spend insights tiles + per-workspace caps + trend charts hidden for non-org-admin in org view | PASS |

---

## Mechanical fixes applied

None.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

- CONSOL-GOV-DEF-1 — `KnowledgeEntry.source.runId` is empty string and `lastEditedBy` is always null
- CONSOL-GOV-DEF-2 — `filterOptions` counts include user-supplied filters (knowledge + ledger) — should be pre-filter per §4.0
- CONSOL-GOV-DEF-3 — Connections list runs row + facet queries in two separate executions (not single-CTE snapshot)
- CONSOL-GOV-DEF-4 — Trends `cap6moCents` repeats current cap across all 6 months (no historical lookup)
- CONSOL-GOV-DEF-5 — Connection wire shape missing `name`, `lastSyncAt`, `owner: { kind, id, name }` (frontend reads them at runtime)
- CONSOL-GOV-DEF-6 — `ConnectionsQuery` `provider` / `authMethod` / `status` accept only single value, not array
- CONSOL-GOV-DEF-7 — `ConnectionsQuery.sortKey` parameter not honoured (always sorts by `created_at`)
- CONSOL-GOV-DEF-8 — `GET /api/connections/:id` detail endpoint not implemented
- CONSOL-GOV-DEF-9 — `ConnectionTestResponse.error.code` emits values outside closed §4.9 enum
- CONSOL-GOV-DEF-10 — OAuth `testConnection` does not populate `capabilities` (verified scopes)
- CONSOL-GOV-DEF-11 — Connection test rate limit (max 6/conn/min) not enforced
- CONSOL-GOV-DEF-12 — `ConnectionUsage` missing `lastUsedAt` on agents, `nextFireAt` on tasks; `recurringTasks` always returns []
- CONSOL-GOV-DEF-13 — Connection-usage aggregator runs two separate queries (not single CTE per §4.10)
- CONSOL-GOV-DEF-14 — Pace bar `<HelpHint>` tooltip absent; static "7-day window" label instead
- CONSOL-GOV-DEF-15 — Override confirm copy diverges from §4.12 spec literal
- CONSOL-GOV-DEF-16 — Disconnect dialog copy diverges from §4.10 spec literal
- CONSOL-GOV-DEF-17 — Knowledge `q` search covers only `body`, not `agentName + runId` per §4.8
- CONSOL-GOV-DEF-18 — Knowledge `filterOptions` returns only `status` facet; missing `kind` and `agent`

---

## Files modified by this run

None.

---

## Next step

NON_CONFORMANT — 18 directional gaps routed to `tasks/todo.md` under "Deferred from spec-conformance review — consolidation-govern". The main session triages each item.

Recommended priority for the main session:
- **Runtime-impacting (address before merge):** CONSOL-GOV-DEF-5 (Connection wire-shape mismatch breaks ConnectionsPage at runtime), -9 (test error.code outside spec enum is user-visible), -12 (ConnectionUsage missing lastUsedAt/nextFireAt; recurringTasks always empty)
- **Contract-correctness:** -2 (filterOptions pre-filter), -6 (provider/authMethod/status array filters), -7 (sortKey unsupported), -17 (knowledge q only searches body), -18 (knowledge filterOptions missing kind/agent)
- **Documented deviations or schema-bound:** -1 (source.runId; documented gap in plan §3 Gap 4), -3, -4, -10, -11, -13
- **Copy refinements:** -14 (HelpHint), -15 (override copy), -16 (disconnect copy) — design judgement

Once gaps are addressed (or explicitly accepted with deferred-items routing), re-run `pr-reviewer` on the expanded changed-code set before opening the PR.
