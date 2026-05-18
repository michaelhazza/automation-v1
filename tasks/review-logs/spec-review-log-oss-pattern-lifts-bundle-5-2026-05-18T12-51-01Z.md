# Spec Review Log — oss-pattern-lifts-bundle — Iteration 5 (FINAL — cap)

**Spec:** `docs/superpowers/specs/2026-05-18-oss-pattern-lifts-bundle-spec.md`
**Iteration:** 5 / 5 (cap reached)
**Codex raw output:** `tasks/review-logs/_codex_oss-pattern-lifts-bundle_iter5_2026-05-18T12-51-01Z.txt`

## Findings (all mechanical Path B residue)

F1 §5.2 signature: missing optional `tx` param; "Opens a getOrgScopedDb transaction" wording. Fix: update signature + opening clause.

F2 §7.3 heading: still names reviewItems.ts. Fix: heading already updated in iter 4 but TOC entry or another heading missed. Verify.

F3 §8.4 contract: still says "completeWaitpoint via sendWithTx replaces enqueueWorkflowResume". Stale. Fix: re-clarify per-kind (oauth enqueues; approval doesn't).

F4 §7.3 create-side prose: still says "After completion, the existing workflow-resume handler reads the run..." — stale Path B miss. Fix: replace with "After completion, reviewService.approveItem continues the existing inline resumeActionCallAfterApproval path."

F5 §11 Execution Model table: says completeWaitpoint "enqueues resume job transactionally" and workflow-resume is triggered by completeWaitpoint for approval. Stale. Fix: per-kind notes.

F6 §15.1 Idempotency table: completeWaitpoint mechanism says "Returns already_completed if 0 rows" but §5.2 distinguishes already_completed vs RESUME_TOKEN_EXPIRED on 0-row. Fix: tighten mechanism wording.

F7 §14 Chunk 6 has `completeWaitpoint(...,tx)` overload but Chunk 2 owns the service. Fix: move the tx overload into Chunk 2.

F8 §18 self-consistency checks: stale "Unified queue-based resume" and "completion atomicity backed by sendWithTx" — replace with per-kind language.

## Rubric findings

None new.

## Counts

- Codex findings: 8
- Rubric findings: 0
- Mechanical accepted: 8
- Mechanical rejected: 0
- Directional resolved: 0
- AUTO-DECIDED: 0
- Reclassified → directional: 0
