# ChatGPT Spec Review Session — memory-improvements — 2026-05-13T01-17-21Z

## Session Info
- Spec: docs/superpowers/specs/2026-05-13-memory-improvements-spec.md
- Branch: claude/add-memvid-integration-ehAOr
- PR: none (Phase 1 — PR creation deferred to Phase 3 / finalisation-coordinator per build_slug pipeline)
- Mode: manual
- Started: 2026-05-13T01:17:21Z
- Spec context: pre_production=yes, staged_rollout=never_for_this_codebase_yet, feature_flags=only_for_behaviour_modes
- Build slug: memory-improvements
- Source brief: tasks/builds/memory-improvements/brief.md (Rev 6.3, LOCKED 2026-05-12)
- Prior review: spec-reviewer iteration 1 (REVIEW_GAP, applied 12 mechanical fixes)
- Open questions: all 7 resolved by operator before review

---

## Round 1 — 2026-05-13

**ChatGPT verdict:** CHANGES_REQUESTED — "Not lock-ready yet. Fix F1-F3 before finalising. T1-T4 are small but worth applying in the same pass because they remove likely implementation ambiguity."

**Triage:** All 7 findings classified as **technical / architectural** (none are user-facing product policy). Auto-applied per the standard chatgpt-spec-review contract.

### Findings and decisions

| ID | Severity | Category | Title | Triage | Action |
|----|----------|----------|-------|--------|--------|
| F1 | high | architecture | B2 dashboard needs time-series data but MV is single 30d aggregate | technical | **Auto-applied.** Extended §4 Phase 4 to specify two read shapes (per-agent aggregate from MV; daily series computed on-demand from raw `agent_runs`); added §6.6 `MemoryUtilityPayload` contract with `agents[]` + `dailySeries[]`; added `memoryUtilityDailySeriesPure.ts` + test to §5.1 inventory. |
| F2 | high | architecture | Reverse-lineage contract contradicts itself (default-on vs default-off) | technical | **Auto-applied.** Rewrote §15 Q6 resolution: v1 contract is **default-off; opt-in on expand**. Aligns §15, §6.1, and §14.1 UI section. Build phase may promote default-on in a follow-up after EXPLAIN confirms acceptable cost. |
| F3 | high | architecture | /api/orgs/:orgId/usage/memory-utility needs explicit path-org/session-org invariant | technical | **Auto-applied.** Added explicit "MUST reject :orgId mismatch with 403 before any query executes" row to §7.3 table and to §7.4 cross-tenant leak class. Daily-series query symmetric (RLS-protected, but route-layer guard is defence-in-depth). |
| T1 | medium | architecture | Phase 1 lineage idempotency missing `ON CONFLICT DO NOTHING` + retry/block-version scoping | technical | **Auto-applied.** Added explicit `onConflictDoNothing` clause to §4 Phase 1 write site; tightened §13.1 idempotency posture to "key-based, scoped to committed block version" — clarifies that a retry creating a *new* block version gets its own lineage rows. |
| T2 | medium | architecture | Source-run provenance field on cluster entry not named | technical | **Auto-applied.** Added explicit build-phase verification note to §4 Phase 1: if no stable `originatingRunId` field exists on `WorkspaceMemoryEntry`, write NULL run provenance; do not infer from synthesis-job context. |
| T3 | medium | style | `source_type` union broader than schema FK supports | technical | **Auto-applied.** Narrowed §6.1 payload `sourceType` to `'workspace_memory'` only for v1; added comment + §3.2 footnote that other values are reserved for future expansion. |
| T4 | low | style | Threshold spot-check protocol belongs in plan, not spec contract | technical | **Auto-applied.** Simplified §15 Q2 to "default 0.30; any pre-enablement change recorded in implementation plan with evidence." Moved spot-check procedure to handoff's build-phase acceptance checklist (pending Step 9). |
| W1 | low | style | §13.5 terminal-event wording too strong | technical | **Auto-applied.** Rewrote §13.5 terminal-event bullet: "embedding failure emits at most one... empty_after_semantic may emit once per affected category... embedding failure precludes empty_after_semantic." |

### Files modified this round

- `docs/superpowers/specs/2026-05-13-memory-improvements-spec.md` — F1/F2/F3/T1/T2/T3/T4/W1 applied
- `tasks/builds/memory-improvements/progress.md` — (will append Round 1 decisions on next commit)

### Verdict at end of Round 1

**APPROVED_AFTER_FIXES (subject to one more round confirming the fixes).**

All Required (F1-F3) and Tightening (T1-T4) findings closed in the same pass. Wording cleanup also applied. No deferrals routed to `tasks/todo.md`. No directional findings required operator approval.

**Recommended next step:** one more ChatGPT round to confirm the fixes close cleanly. If ChatGPT closes APPROVED on Round 2, the spec is lock-ready and Phase 1 can proceed to handoff. If Round 2 surfaces new findings, triage and apply per the same contract.

---

## Round 2 — 2026-05-13

**ChatGPT verdict:** "I'd call this lock-ready after 2 small tightenings." All Round 1 majors confirmed closed (F1 charts, F2 reverse-lineage default-off, F3 path-org/session-org 403, T1 onConflictDoNothing, T2 source-run verification, T3 sourceType narrowing, T4 spot-check relocation, W1 wording). No new blockers found in the daily-series query / SQL shape / DST edges.

**Triage:** Both findings classified as **technical** (T1 banner copy is user-facing surface but operationally required to disclose the table/chart refresh-split, not a product-policy decision; auto-applied with operator-visible note for confirmation before final lock).

### Findings and decisions

| ID | Severity | Category | Title | Triage | Action |
|----|----------|----------|-------|--------|--------|
| R2-T1 | low | style | Dashboard banner should disclose table/chart refresh split | technical (operator-visible surface) | **Auto-applied.** Updated banner copy in §4 Phase 4 and §14.2 to: *"Runs predating the entry-manifest migration are excluded from entry utility calculations. Agent table refreshes nightly; charts reflect live run data. Citation detection is heuristic, so figures are directional."* Operator-facing copy flagged for confirmation before final lock. |
| R2-T2 | low | architecture | `memoryUtilityDailySeriesPure.test.ts` missing from §12.1 test list | technical | **Auto-applied.** Added test entry to §12.1 with explicit cases: UTC bucket boundaries, zero-measured-run buckets returning null, entry-side measured/unmeasured partition, block-side denominator-zero handling, 30-bucket shape with gap-filling. |

### Verdict at end of Round 2

**APPROVED (operator confirmation pending on banner copy only).**

ChatGPT explicitly: *"Recommendation: apply T1 and T2, then lock."* No further blockers found. The Phase 1 lineage contract is correctly tightened; the Phase 4 route/RLS posture is explicit; the D ranker section remains appropriately simple.

**Recommended next step:** confirm banner copy with operator → lock the spec → proceed to handoff write (Step 9 of spec-coordinator playbook).
