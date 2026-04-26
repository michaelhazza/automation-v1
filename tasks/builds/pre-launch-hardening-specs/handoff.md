# Pre-Launch Hardening Specs — Handoff Log

**Authored:** 2026-04-26
**Branch:** `spec/pre-launch-hardening`
**Outgoing session state:** spec authoring complete; 6 PRs open; preliminary freeze stamped; consistency sweep complete with 1 finding resolved.

This document is the handoff record for the next session / user review pass.

---

## Table of contents

1. What was produced
2. Workflow deviations from plan.md
3. Open Decisions — user adjudicates at PR review
4. Implementation order — BINDING
5. Post-merge protocol
6. Cross-chunk dependencies + Highest-impact insights
7. Closing

---

## 1. What was produced

### Per-chunk specs (6 PRs open against `spec/pre-launch-hardening`)

| Chunk | Slug | PR | Surface |
|---|---|---|---|
| 1 | `pre-launch-rls-hardening` | [#204](https://github.com/michaelhazza/automation-v1/pull/204) | RLS hardening (12 of 14 items closed by 0227; 2 truly-open: P3-C5 phantom-var sweep + GATES-2026-04-26-1 reference_documents parent-EXISTS) |
| 2 | `pre-launch-schema-decisions` | [#209](https://github.com/michaelhazza/automation-v1/pull/209) | Schema decisions + renames (12 decisions; W1-6 + W1-29 verified closed; 10 architect-pinned resolutions) |
| 3 | `pre-launch-dead-path-completion` | [#208](https://github.com/michaelhazza/automation-v1/pull/208) | Dead-path completion (4 truly-open: DR1, DR2, DR3, C4a-REVIEWED-DISP; architect-pinned at `6bbbd737`) |
| 4 | `pre-launch-maintenance-job-rls` | [#205](https://github.com/michaelhazza/automation-v1/pull/205) | Maintenance-job RLS contract (B10-MAINT-RLS — 3 jobs to refactor) |
| 5 | `pre-launch-execution-correctness` | [#207](https://github.com/michaelhazza/automation-v1/pull/207) | Execution-path correctness (5 truly-open + 2 verified-closed; C4a-6-RETSHAPE owned post-sweep) |
| 6 | `pre-launch-gate-hygiene` | [#206](https://github.com/michaelhazza/automation-v1/pull/206) | Gate hygiene cleanup (5 truly-open; ~11 verified-closed by surrounding work) |

### Supporting artefacts

- **Cross-chunk invariants doc** at `docs/pre-launch-hardening-invariants.md` (commit SHA `cf2ecbd06fa8b61a4ed092b931dd0c54a9a66ad2`). 6 invariant categories, 36 invariants, every one testable/enforceable with typed Gate/Test/Static/Manual enforcement and named owner.
- **Architect outputs** at `tasks/builds/pre-launch-hardening-specs/architect-output/`:
  - `schema-decisions.md` (commit `65494c88` — 630-line resolution document for Chunk 2's 12 decisions)
  - `dead-path-completion.md` (commit `6bbbd737` — resolution document for Chunk 3's 4 decisions)
- **Verification log** at `tasks/builds/pre-launch-hardening-specs/chunk-1-verification-log.md` (Chunk 1 SC-1 audit + 12 closed-by-0227 evidence).
- **Consistency sweep log** at `tasks/builds/pre-launch-hardening-specs/consistency-sweep.md` (sweep findings + resolution).
- **Plan** at `tasks/builds/pre-launch-hardening-specs/plan.md` (1,165-line authoring plan with 8 tightenings).
- **Progress** at `tasks/builds/pre-launch-hardening-specs/progress.md` (status tracker, pinned SHAs, freeze stamp, coverage baseline).
- **Spec-authoring process improvement (Q4 idea)** captured at `tasks/ideas.md` IDEA-2 for separate triage.

### `tasks/todo.md` annotations

48 cited items annotated:

- 12 Chunk 1 items: 12 annotated as `→ verified closed by migration 0227 (commit c6f491c3); owned by pre-launch-rls-hardening-spec`.
- 14 Chunk 6 items: 11 annotated as verified-closed; 5 annotated as owned (P3-M10, P3-M16, S2-SKILL-MD, RLS-CONTRACT-IMPORT, SC-COVERAGE-BASELINE).
- 12 Chunk 2 items: 2 verified-closed (W1-6, W1-29); 10 owned.
- 7 Chunk 5 items: 2 verified-closed (W1-44, W1-38); 5 owned.
- 4 Chunk 3 items: all owned.
- 1 Chunk 4 item: owned (B10-MAINT-RLS).

No item was deleted. Every annotation is an append-only suffix.

---

## 2. Workflow deviations from plan.md (user-authorised)

Two protocol deviations applied during execution per user instruction 2026-04-26:

1. **`spec-reviewer` agent was SKIPPED** for every chunk in this sprint. The user adjudicates spec quality directly at PR review.
2. **Review-cadence checkpoints were SKIPPED.** The session ran straight through to Task 7 without pausing at the cadence stops named in plan.md § 15.

Both deviations recorded in `progress.md § Workflow deviations`. The other tightenings (per-chunk verification before drafting, scope guard, coverage check, etc.) were retained.

---

## 3. Open Decisions — user adjudicates at PR review

5 chunks have outstanding HITL decisions captured in their § Review Residuals. Final spec freeze (Task 6.5) cannot finalise until these are resolved.

| Chunk | Open Decision | Recommendation |
|---|---|---|
| 1 | RLS gate posture (hard-block vs warn) | **Hard-block** (drift = 2 known-deferred tables; pre-launch posture means false-positive cost is near zero) |
| 2 | F6 default for legacy `workflow_runs` rows | **Leave at `'explore'`** (safe default; no live data) |
| 2 | F10 inheritance precedence (5-step ladder) | **Adopt 5-step:** parentRun → request → portal default → agent default → 'explore' literal |
| 2 | F22 rejected proposals counted as meaningful | **Yes** (the proposal is the meaningful signal; rejection is downstream) |
| 3 | High-risk action handling | **Single human gate** (brief approval IS the human gate; no chained second-tier) |
| 3 | DR1 + DR2 rate limiting | **No v1 cooldown** (defer to existing rate-limit middleware OR post-launch) |
| 5 | C4a-6-RETSHAPE branch | **Branch A grandfather** (flat-string pattern; resolved via consistency sweep) |
| 5 | C4b-INVAL-RACE wrapper scope | **Single helper `withInvalidationGuard`** |
| 5 | H3 option choice | **Option (b) side-channel `summaryMissing`** (no DDL; preserves runResultStatus semantics) |
| 6 | capabilities.md editorial wording | **`Hyperscaler-scale distribution`** (vs `provider-marketplace-scale distribution` alternative) |

Each decision is non-blocking for PR open; user resolves at review and the implementation PR ships against the chosen value.

---

## 4. Implementation order — BINDING

```
1 → {2, 4, 6} → 5 → 3
```

After all 6 spec PRs merge, implementation branches start in this order:

1. **Chunk 1 lands first** — RLS hardening is the foundation; no other chunk's code starts before this.
2. **Chunks 2 + 4 + 6 in parallel** after Chunk 1 lands. Chunk 2 carries schema decisions; Chunks 4 + 6 are independent.
3. **Chunk 5 after Chunk 2** — Chunk 5's C4a-6-RETSHAPE work depends on Chunk 2's schema landings (no actual schema dep for Branch A; Branch B forces coupling).
4. **Chunk 3 last** — depends on RLS (1), schema (2), and execution-correctness (5) being stable.

PR merge order does NOT imply dependency order. Engineers picking up implementation branches MUST honour the order graph above.

---

## 5. Post-merge protocol (next session)

When the 6 spec PRs merge into `spec/pre-launch-hardening`:

1. **Re-run consistency sweep** (`tasks/builds/pre-launch-hardening-specs/consistency-sweep.md`) on the merged state. This ensures any merge-time edits are checked.
2. **Re-stamp Task 6.5 spec freeze** at the post-merge HEAD. Update `progress.md § Spec Freeze` with the new SHA.
3. **Resolve all Open Decisions** with the user. Each resolution is recorded in the relevant spec's `## Review Residuals § HITL decisions` section.
4. **Spec freeze becomes FINAL** when all Open Decisions are resolved and the post-merge sweep is clean.
5. **Implementation branches start** in the binding order. Each implementation PR cites the spec slug + commit SHA at freeze.

If any spec needs amendment post-freeze, the protocol in `tasks/builds/pre-launch-hardening-specs/plan.md` § Task 6.5 applies: explicit `## Amendments` section in the spec, invariants doc update if impacted, re-run Task 6.6 (consistency sweep), re-stamp Task 6.5 (freeze).

---

## 6. Cross-chunk dependencies + Highest-impact insights

### Cross-chunk dependencies (implementation-time)

| From | To | Type |
|---|---|---|
| Chunk 3 (DR1 error envelope) | Chunk 5 (C4a-6-RETSHAPE branch decision) | Aligned: both ship with Branch A by default; if user picks Branch B, both PRs migrate together |
| Chunk 3 (C4a-REVIEWED-DISP resume path) | Chunk 5 (`withInvalidationGuard` helper) | Chunk 5 must merge first; Chunk 3's resume path uses the helper |
| Chunk 5 (W1-43 / dispatcher boundary) | Chunk 2 (W1-38 error vocabulary) | W1-38 verified closed; no cross-dep at implementation time |
| Chunk 4 (admin/org tx) | Chunk 1 (RLS contract) | Chunk 1 must merge first; Chunk 4 mirrors the established pattern |
| Chunk 6 (P3-H7 Principal-Context) | Chunk 1 (RLS Layer B) | Chunk 1 must merge first; Chunk 6 verifies present-state alignment |

### Highest-impact insights from execution

1. **Verification before authoring is essential.** The Chunk 1 scope mismatch (60 → 2 drift) was caught by Step 1 verification before drafting. Without it, the spec would have re-litigated 12 already-closed items. Chunks 4, 5, 6 all surfaced similar (smaller) closures during their pre-draft verification.
2. **Cross-spec consistency sweep caught one finding.** The C4a-6-RETSHAPE unowned-decision finding came from Chunk 5's spec misattributing ownership to Chunk 2's architect; the architect-output conflict check missed it because it ran before the specs were drafted. The sweep is more valuable than the conflict check at the architect stage because the specs themselves can introduce drift.
3. **Migration 0227 closed more than the mini-spec assumed.** Around 30+ items across Chunks 1, 5, 6 were already closed by surrounding work between mini-spec authoring (2026-04-26) and Chunk 1 spec drafting. Future "deferred-items spec" work should always re-derive present state.
4. **Long-doc-guard at 10000 chars enforced chunked authoring.** The skeleton + Edit-append pattern was used 9 times; without the guard, long Writes would have stalled or truncated.
5. **The architect agent without Write access was a problem.** The first Chunk 2 architect dispatch (feature-dev:code-architect) returned its output as a response message; the parent session had to reconstruct or re-dispatch. The fix (use feature-coordinator for Chunk 2 redo) worked. Future architect dispatches should use an agent type with Write tooling.

---

## 7. Closing

Spec authoring complete. PR #210 open (consolidated; the 6 per-chunk PRs were closed). Preliminary freeze stamped. Consistency sweep clean (1 finding resolved at v1; 8 execution-safety gaps resolved at v2 amendment). Implementation cleared to begin AFTER PR #210 merges + final freeze re-stamp + Open Decisions resolution.

### Pre-implementation hardening pass (2026-04-26 amendment v2)

External review surfaced 8 execution-safety gaps post-consistency-sweep. All resolved inline in the affected specs:

- Chunk 3 § 4.5 — DR3 idempotency, C4a optimistic guard (CRITICAL), DR2 loop cap, DR1 GIN index, webhook timeout/retry, no-silent-partial-success per flow, observability hooks, response shapes.
- Chunk 4 § 6.5 — Per-org error isolation (REQUIRED), no-silent-partial-success per job, observability hooks.
- Chunk 5 § 6.5 — No-silent-partial-success per execution flow, observability hooks, webhook-timeout cross-reference to Chunk 3.

### System-coherence final pass (2026-04-26 amendment v3)

Third external review surfaced 9 cross-flow coherence gaps. Resolved by promoting 4 to cross-spec invariants (§ 7 of the invariants doc) and 5 to per-flow contracts:

- **Invariants § 7 (new):** 7.1 Idempotency posture classified per write; 7.2 Source-of-truth precedence; 7.3 Correlation key (`executionId`/`runId`/`jobRunId`); 7.4 Status enum on every flow.
- **Chunk 3 amendments:** stale-decision guard (HTTP 410); artefact-ID uniqueness check; orchestrator concurrency cap (1 active per conversation); status enum on response shapes; correlation key on every event.
- **Chunk 4 amendments:** sequential per-org processing REQUIRED; status enum on every job event.
- **Chunk 5 amendments:** idempotency posture classified per execution flow; status enum mapping; correlation key.

### Edge-condition tightening pass (2026-04-26 amendment v4)

Fourth external review surfaced 7 edge-condition gaps. Resolved by promoting 3 to cross-spec invariants (§ 7.5–7.7, re-pinned to SHA `335e86cb`) and 4 to per-flow contracts:

- **Invariants § 7.5–7.7 (new):** 7.5 Retry classification (`safe | guarded | unsafe`) declared per operation; 7.6 `status` vs `executionStatus` distinct semantics; 7.7 Terminal event guarantee per chain.
- **Chunk 3 § 4.5.1 (DR3):** first-commit-wins rule for concurrent different decisions (no deterministic preference between approve/reject).
- **Chunk 3 § 4.5.3 (DR2):** suppressed-follow-up ordering LOCKED to Option A (NOT re-queued); Option B deferred.
- **Chunk 3 § 4.5.5 + 4.5.7 (C4a):** HTTP-disconnect / gateway-timeout behaviour pinned (execution continues; result persisted; events fire; client recovers via WS).
- **Chunk 3 § 4.5.7 (DR1):** `rule.draft_candidates.collision_detected` event for JSONB multi-match data-integrity flag.
- **Chunks 3, 4, 5:** terminal events declared per chain to satisfy invariant 7.7.

See `tasks/builds/pre-launch-hardening-specs/consistency-sweep.md § Amendment 2026-04-26 (third pass)` and § Amendment 2026-04-26 (fourth pass) for the full audit.
