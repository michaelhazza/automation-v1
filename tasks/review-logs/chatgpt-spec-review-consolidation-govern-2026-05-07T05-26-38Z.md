# ChatGPT Spec Review Session — consolidation-govern — 2026-05-07T05:26:38Z

## Session Info
- Spec: tasks/builds/consolidation-govern/spec.md
- Branch: claude/learn-harbour-ui-B4k7a
- PR: #268 — https://github.com/michaelhazza/automation-v1/pull/268
- Mode: manual
- Started: 2026-05-07T05:26:38Z

---

## Round 1 — 2026-05-07T05:26:38Z

### ChatGPT Feedback (raw)

Executive summary

Approved directionally. The spec is tight, consistent with your existing patterns, and low risk to build. The main gaps are around invariants (especially auto-memory override safety), pagination determinism, and aggregator edge cases. Tightening those now will prevent subtle data drift and UI inconsistencies later.

What's solid (no action needed)
- Scope discipline is strong. Clear separation from Operate (A) and Build (B). No domain creep.
- Reuse vs extend decisions are correct. Especially: knowledge pipeline extension via auto_update_disabled; spend services as pure aggregators (no persistence); connections unification without breaking existing per-kind routes.
- Execution + idempotency model is clean. State-based for approve/reject; Key-based + ETag for override; retry-safe connection test. Aligns with broader invariants-first approach.
- Frontend composition is consistent with foundation. <SortableTable>, useViewMode, <Modal> all used correctly with no leakage.
- Chunking is buildable. Backend-first split (C1–C6) then frontend is exactly how this should land.

High-impact tightenings

1. Auto-memory override invariant is underspecified.
"pipeline MUST skip writes when auto_update_disabled = true" — necessary but not sufficient.
Missing invariant: Auto-extraction MUST NOT create a new version for an overridden block, even if the extracted content differs.
Otherwise: silent reversion via new version rows; or divergence between memory_blocks.body and versions.
Add explicitly: pipeline must check auto_update_disabled before BOTH UPDATE and version INSERT. Guarantee no new memory_block_versions rows are written once disabled.

2. Knowledge list pagination determinism.
Cursor pagination but ordering guarantees missing.
Add invariant: ORDER BY created_at DESC, id DESC. Cursor must encode both fields.
Without this: duplicate rows across pages; unstable ordering after updates.

3. Override idempotency definition is incomplete.
(memory_block_id, body_hash) uniqueness implicit. Make explicit.
Add: UNIQUE(memory_block_id, body_hash). Define body hash canonicalisation: trimmed; normalised whitespace; case-sensitive or not (pick one).
Otherwise: accidental duplicate revisions.

4. Spend trends "Other" rollup edge case.
"index 4 is synthetic 'Other'" not defined when ≤5 workspaces.
Define: ≤5 → no "Other"; >5 → positions 0–3 = top 4, 4 = "Other"; id = '__other__', name = "Other".

5. Spend insights time window ambiguity.
MTD, deltaPct, runs30d not consistently defined.
Add: MTD = calendar month UTC. deltaPct = current MTD vs previous MTD. fastestGrower same window. mostActiveAgent = last 30 days rolling UTC.

6. Connection test failure contract.
"never bubbles 5xx" — incomplete.
Define: always 200; status='failed' for timeout/network/auth; error.code from enum: TIMEOUT/AUTH_FAILED/NETWORK_ERROR/PROVIDER_ERROR.

Medium-impact

7. Knowledge status vs override ambiguity.
status=in_use + auto_update_disabled=true coexist with status=overridden — dual meaning.
Recommendation: keep status unchanged + flag; drop overridden as a status.

8. Ledger cost precision invariant missing.
Add: stored as integer micros (or cents); rendered as decimal.

9. FilterOptions contract missing for new endpoints.
Add: post-RLS pre-filter counts; stable ordering; zero-count options decision.

10. Connection usage aggregator consistency.
Reads agent_data_sources + agent_triggers + workflows.
Add: same snapshot timestamp (single transaction).

Low-impact / polish
- Max page size (e.g. 50) for all list endpoints.
- q semantics: case-insensitive; partial match; no stemming.
- Empty-state copy guidelines (optional).

Verdict: APPROVED with tightenings. No structural issues. No blockers.

Required before build: 1, 2, 4, 5, 6.
Nice-to-have: 7, 8, 9.

### Recommendations and Decisions

| # | Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---|---------|--------|----------------|----------------|----------|-----------|
| F1 | Auto-memory override invariant underspecified (skip UPDATE + skip version INSERT) | technical-escalated | apply | apply (user) | high | Data-integrity invariant — silent reversion risk. User approved as recommended. |
| F2 | List pagination determinism (default order + cursor encoding) | technical-escalated | apply | apply (user) | high | Without it: duplicate rows across pages, unstable order. User approved as recommended. |
| F3 | Override idempotency: explicit UNIQUE + body hash canonicalisation | technical | apply | auto (apply) | medium | Mechanical contract clarification; chose: SHA-256, trim+collapse-whitespace, case-sensitive. |
| F4 | Spend trends "Other" rollup behaviour for ≤5 vs >5 workspaces | technical | apply | auto (apply) | medium | Spelled out positions, id, name, capUsage6mo aggregation. |
| F5 | Insights time windows (MTD / deltaPct / runs30d) UTC-anchored | technical | apply | auto (apply) | medium | Removes drift across implementations. |
| F6 | Connection test failure contract: always 200 + closed error.code enum | technical | apply | auto (apply) | medium | Locks observability shape; enum = TIMEOUT/AUTH_FAILED/NETWORK_ERROR/PROVIDER_ERROR. |
| F7 | Drop `overridden` from status enum; use `auto_update_disabled` as source of truth | user-facing | apply | apply (user) | medium | Removes dual meaning; visible filter chip set drops "Overridden", new `autoUpdateDisabled` filter added. User approved as recommended. |
| F8 | Ledger cost precision: integer microcents in storage, no floats | technical | apply | auto (apply) | medium | Prevents rounding drift in aggregators; plan responsible for any alignment migration. |
| F9 | FilterOptions contract (post-RLS pre-filter counts, sort, zero-count) | technical | apply | auto (apply) | low | Lifts implicit contract into §4.0 explicitly. |
| F10 | Connection usage aggregator: single read transaction across 3 tables | technical | apply | auto (apply) | medium | Snapshot consistency; READ COMMITTED is sufficient. |
| F11 | Max page size = 50 across list endpoints (clamp, not error) | technical | apply | auto (apply) | low | Polish — safety cap. |
| F12 | `q` semantics: case-insensitive partial substring, no stemming, AND-composes with filters | technical | apply | auto (apply) | low | Standardisation across endpoints. |
| F13 | Empty-state copy guidelines per list page | user-facing | defer | defer (user) | low | Spec already names `<EmptyState>` + "Clear filters"; final copy lands during build via mockup-designer. Deferred to §10 + tasks/todo.md. |

### Applied (auto-applied technical + user-approved user-facing)

- [auto] **§4.0** New "List endpoint invariants" subsection covering max page size (50), `q` semantics, `filterOptions` contract.
- [auto] **§4.4** Time window definitions (MTD / deltaPct / runs30d) UTC-anchored.
- [auto] **§4.5** "Other" rollup spelled out: ≤5 → no Other; >5 → top 4 + synthetic at index 4 with id='__other__', name='Other', capUsage6mo aggregation rule.
- [auto] **§4.9** `error.code` typed as closed enum; response contract block (always 200; enum semantics; message rules).
- [auto] **§4.10** Snapshot consistency note: single read transaction across `agent_data_sources` + `agent_triggers` + workflow definitions.
- [auto] **§6 Knowledge override** Body hash canonicalisation (trim, collapse whitespace, preserve case, SHA-256 hex lower-case); UNIQUE (memory_block_id, body_hash) explicit; atomicity with version insert.
- [auto] **§6 Cost precision** Integer microcents invariant; floats forbidden in storage and aggregation; plan responsible for alignment migration if existing schema differs.
- [user] **§4.0** Default ordering and cursor encoding rule (knowledge / spend ledger / connections all end with `id DESC` tiebreaker; cursor encodes both fields).
- [user] **§4.1** Source-of-truth precedence strengthened: pipeline must skip BOTH `memory_blocks` UPDATE AND `memory_block_versions` INSERT when `auto_update_disabled = true`.
- [user] **§4.1** Dropped `overridden` from `KnowledgeListQuery.status` and `KnowledgeEntry.status`; added `autoUpdateDisabled?: boolean` filter; new "Status vs override" paragraph.
- [user] **§6 State machine** Status enum reduced to `pending_review | in_use | ignored`; clarified that override is a flag-only operation.
- [user] **§10 Deferred items** Added "Empty-state copy guidelines per list page" deferred entry.
- [auto] **§11 Self-consistency check** Updated to enumerate every new invariant against its source section.
- [auto] **§12 Pre-review checklist** Added §12-§19 covering all new contractual items.
- [auto] **Header `Last updated`** Reflects round 1 changes.

### Integrity check

- Forward references: scanned for stale references to `'overridden'` status — only intentional explanatory mentions remain (line 109, line 137).
- Contradictions: §4.12 "Override confirmation" copy is consistent with the new flag-only model.
- Missing inputs/outputs: §4.0 invariants are cross-cutting rules (no input/output surface). New `autoUpdateDisabled` query field is typed and explained.
- Issues found this round: 0 (auto: 0, escalated: 0).

### Top themes

Invariants-first tightening: pagination determinism, override gate completeness, time-window UTC anchoring, error-enum closure, snapshot consistency, body-hash canonicalisation, status enum hygiene. No structural changes; spec remains buildable per existing chunk plan.
