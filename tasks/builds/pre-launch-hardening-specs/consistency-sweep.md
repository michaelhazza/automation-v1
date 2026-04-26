# Cross-Spec Consistency Sweep — Findings Log

**Authored:** 2026-04-26
**Branch:** `spec/pre-launch-hardening`
**Specs swept:** all 6 per-chunk specs at `docs/pre-launch-*-spec.md`
**Invariants pinned:** `cf2ecbd0` (`docs/pre-launch-hardening-invariants.md`)
**Architects pinned:** Chunk 2 `65494c88`, Chunk 3 `6bbbd737`

This log records the consistency-sweep findings per `tasks/builds/pre-launch-hardening-specs/plan.md` § Task 6.6.

## Step 0 — Invariants re-validation

**Result: PASS.** All 6 specs pin invariants commit SHA `cf2ecbd06fa8b61a4ed092b931dd0c54a9a66ad2`. Implementation order `1 → {2, 4, 6} → 5 → 3` is uniformly declared. Architect input SHAs (Chunks 2 + 3) consistent with the committed architect outputs.

No invariant violations. No drift between any spec's claims and the cross-chunk invariants doc.

## Step 1 — Naming consistency check

**Result: PASS.** All identifier references are consistent:

- `safety_mode` (SQL) and `safetyMode` (TS) both appear; this is the standard convention. Not a finding.
- `handoff_source_run_id` (SQL) and `handoffSourceRunId` (TS) both appear; same convention. Not a finding.
- `withInvalidationGuard` introduced in Chunk 5; cited correctly by Chunk 3 as a cross-chunk dependency.
- `briefApprovalService` mentioned only in Chunk 3 + the mini-spec (verbatim quotes).
- `delegation_outcomes` mentioned in Chunk 2 (canonical truth declaration) + the mini-spec.

The two occurrences of `server/lib/playbook/actionCallAllowlist.ts` (legacy path) in Chunk 6 spec are inside verbatim mini-spec quotes that explicitly note the path moved to `server/lib/workflow/`. Verbatim quotation of the source text is correct behaviour.

## Step 2 — Shared-contract identity check

**Result: 1 directional finding (resolved inline).**

### Finding 2.1 — C4a-6-RETSHAPE unowned decision

**Description:** The skill error envelope contract decision (C4a-6-RETSHAPE) had drift across three specs:

- **Chunk 5 spec § 4.3** (pre-fix): "Until Chunk 2 architect picks one, this spec routes the decision to § Review Residuals as a HITL question."
- **Chunk 3 spec § 4.3** (pre-fix): "Migration to `{ code, message, context }` deferred to Chunk 5 C4a-6-RETSHAPE."
- **Chunk 2 architect output** (`schema-decisions.md`): does NOT include C4a-6-RETSHAPE in its 12 decisions.

Result: the decision was unowned. Chunk 3 expected Chunk 5 to pick; Chunk 5 expected Chunk 2 architect to pick; Chunk 2 architect didn't.

**Classification:** Directional (genuine cross-chunk disagreement on ownership).

**Resolution:** Chunk 5 spec § 4.3 updated to take ownership and recommend **Branch A — grandfather the flat-string pattern**. Rationale: pre-launch posture (rapid_evolution, prefer_existing_primitives, no introduce-then-defer); migrating ~40 skill handlers is high-effort low-value pre-launch; the legacy pattern works; the 3 delegation skills bring their shapes back to the legacy pattern. User can override at PR review.

Chunk 3 spec § 4.3 updated to align with the recommendation: "Aligns with Chunk 5 C4a-6-RETSHAPE Branch A recommendation (grandfather flat-string); see Chunk 5 spec § 4.3. If user picks Branch B at review, Chunk 5 + Chunk 3 ship together against nested envelope."

**Status:** Resolved inline (mechanical fix per protocol). Both Chunk 3 and Chunk 5 specs amended on their own branches (commits to follow).

## Step 3 — Duplicated-primitive check

**Result: PASS.** Each new primitive appears in exactly one spec:

| Primitive | Spec |
|---|---|
| `briefApprovalService` (new) | Chunk 3 |
| `briefMessageHandlerPure` (new) | Chunk 3 |
| `resumeInvokeAutomationStep` (new method) | Chunk 3 |
| `computeMeaningfulOutputPure` (new helper) | Chunk 2 |
| `validateInputAgainstSchema` (new helper) | Chunk 2 |
| `assertSingleWebhook` (new helper) | Chunk 5 |
| `withInvalidationGuard` (new helper) | Chunk 5 |

All cite `accepted_primitives` reuse where applicable (31 references across 6 specs). Each new primitive carries a "why not reuse" rationale per `docs/spec-authoring-checklist.md § Section 1`.

## Step 4 — Conflicting-assumption check

**Result: PASS.** Test posture is uniform: every spec declares `pure_function_only` adherence and lists vitest/jest/playwright/supertest in MUST NOT introduce per `convention_rejections`. MUST reuse listings cite `accepted_primitives` consistently. No spec proposes a primitive another spec's MUST NOT would block.

## Step 5 — Triage

| Finding | Classification | Resolution path applied | Status |
|---|---|---|---|
| 2.1 C4a-6-RETSHAPE unowned | Directional | Resolved in-line: Chunk 5 owns; Branch A recommended; Chunk 3 aligned | RESOLVED |

No mechanical-only findings. No false-alarm findings. No unresolved directional findings.

## Step 6 — Stamp

**Cross-spec consistency sweep COMPLETED at 2026-04-26.**
**Findings:** 1 total — 0 mechanical · 1 directional resolved inline · 0 false alarms.
**Sweep log:** this file (`tasks/builds/pre-launch-hardening-specs/consistency-sweep.md`).
**Implementation cleared (subject to PR merges + freeze stamp).**

The 1 directional finding (C4a-6-RETSHAPE unowned) was resolved by amending Chunk 3 + Chunk 5 specs to make Chunk 5 own the decision and recommend Branch A. User can override at PR review; the recommendation is non-blocking.

## Forward-looking notes

Per the workflow deviation in `tasks/builds/pre-launch-hardening-specs/progress.md § Workflow deviations`, the sweep ran on the integration-branch preview of all 6 specs. The 6 chunk PRs (#204–#209) were closed and consolidated into PR #210. After PR #210 merges, this log should be re-validated against the merged state.

---

## Amendment 2026-04-26 (post-sweep) — pre-implementation hardening pass

External review feedback after the consistency sweep surfaced 8 execution-safety gaps that were valid pre-implementation, not architectural. Folded into the affected specs as new § 4.5 / § 6.5 sections (no architectural change; tightening of execution contracts only):

- **Chunk 3 § 4.5** (added): DR3 idempotency contract (4.5.1); C4a-REVIEWED-DISP optimistic transition guard (4.5.2 — CRITICAL); DR2 loop protection at 5/10min cap (4.5.3); DR1 GIN-index requirement (4.5.4); webhook 30s timeout + retry posture (4.5.5); no-silent-partial-success rules per flow (4.5.6); observability hooks per flow (4.5.7); DR3 explicit response shape (4.5.8).
- **Chunk 4 § 6.5** (added): Per-org error isolation REQUIRED (6.5.1); no-silent-partial-success per job (6.5.2); observability hooks (6.5.3).
- **Chunk 5 § 6.5** (added): No-silent-partial-success per execution flow (6.5.1); observability hooks (6.5.2); webhook timeout cross-reference (6.5.3).

These amendments do NOT trigger the post-freeze amendment protocol because the sweep + freeze were preliminary stamps (PR #210 is still open; not yet merged). The amendments are absorbed into the same PR's diff. Final post-merge sweep + freeze re-stamp will validate the merged state.

### Sweep stamp v2

**Re-stamped at:** 2026-04-26 (same day as initial sweep)
**Findings since v1 stamp:** 8 execution-safety gaps from external feedback, all resolved in spec form. 0 mechanical resolved · 8 directional resolved inline · 0 false alarms.
**Cross-spec coherence verified:** Chunk 5 webhook-timeout contract cross-references Chunk 3's authoritative pin (one implementation in `invokeAutomationStep`); both chunks cite the same 30s value, no-retry posture, and failure-classification rules. No new cross-domain conflicts introduced.

---

## Amendment 2026-04-26 (third pass) — system-coherence final pass

External review's third pass surfaced 9 system-coherence gaps that crossed every flow. These are not architectural; they tighten cross-flow operational rules.

### Resolution

**Cross-spec rules (4 of 9) folded into invariants doc § 7 (commit `e485807b3e72c1303ffeb121d299e7ec53d4c9d0`):**

- 7.1 Idempotency posture explicitly classified per write (key-based / state-based / non-idempotent intentional)
- 7.2 Source-of-truth precedence fixed (execution records > step/run state > artefacts > logs)
- 7.3 Correlation key is `executionId` (or `runId`) across every cross-flow chain
- 7.4 Every flow emits explicit `success | partial | failed` status; no silent success-by-absence

All 6 spec front-matters re-pinned to invariants SHA `e485807b`.

**Per-flow contracts (5 of 9) folded into the affected specs:**

- **Chunk 3 § 4.5.1 + 4.5.3 + 4.5.7 + 4.5.8:** stale-decision guard (HTTP 410); artefact-ID uniqueness check; concurrency cap (1 active orchestrator per conversation); status enum on every response shape; `executionId` correlation key on every event.
- **Chunk 4 § 6.5.1 + 6.5.3:** sequential per-org processing REQUIRED (no parallelisation in v1); status enum on every job event; `jobRunId` correlation key.
- **Chunk 5 § 6.5.1 + 6.5.2:** idempotency posture classified per execution flow; status enum mapping for `runResultStatus`; `runId` / `stepRunId` correlation key.

### Sweep stamp v3

**Re-stamped at:** 2026-04-26 (same day as v2)
**Findings since v2 stamp:** 9 system-coherence gaps. 0 mechanical · 9 directional resolved inline (4 promoted to cross-spec invariants; 5 to per-flow contracts) · 0 false alarms.
**Cross-spec coherence verified:** all 6 specs re-pinned to invariants `e485807b`; per-flow contracts cite the corresponding § 7 invariant by number.
