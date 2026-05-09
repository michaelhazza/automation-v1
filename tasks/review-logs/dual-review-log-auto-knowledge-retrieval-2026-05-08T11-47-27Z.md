# Dual Review Log — auto-knowledge-retrieval

**Files reviewed:** branch `auto-knowledge-retrieval` HEAD `b16cbf20`, diff against `origin/main` (98 files, +17848/-256). Iteration 1 ran via `codex review --base origin/main`; iteration 2 ran via `codex review --uncommitted` against the in-flight fixes.
**Iterations run:** 2/3
**Timestamp:** 2026-05-08T11:47:27Z
**Commit at finish:** 9662b8b7

---

## Iteration 1

Codex returned three findings.

### [ACCEPT] server/jobs/documentChunkEmbedJob.ts:44-48 — pre-tx read on FORCE-RLS table without `app.organisation_id`

Codex P1: the chunk-embed worker opts out of `createWorker`'s auto-org-tx (`resolveOrgContext: () => null`) and then runs a plain `db.select` against `reference_document_versions`. That table is FORCE RLS (migration 0229) with a policy that explicitly fail-closes when `current_setting('app.organisation_id', true)` is NULL or empty. Without setting the GUC, the SELECT returns zero rows, the `version_not_found` warn fires, the worker returns early, and the document never gets chunked or embedded — the `retrieval_version_id` pointer is never flipped, and the document is invisible to retrieval forever.

  Reason: real production-breaking bug. The adversarial-reviewer's "Additional observations" section (line 181 of the 11-30-00Z log) flagged this exact problem ("Under FORCE RLS with a non-superuser role these return zero rows, silently aborting the job"), but it was filed as an observation, not routed as an AKR-ADV-* item. The pr-reviewer round 1 did not catch it. Spec §1.5 #9 mandates the embedding API call run OUTSIDE any DB tx, but that does not preclude a separate short-lived read tx for the pre-embedding read — fixing this preserves the invariant.

### [ACCEPT — extended] server/jobs/documentReembedJob.ts:40, 107, 137 — same FORCE-RLS pre-tx read pattern (3 sites)

Same root cause as the chunk-embed finding, three sites in `documentReembedJob.ts`:
- L40: `db.select(...).from(referenceDocuments)` — `reference_documents` is FORCE RLS.
- L107: `db.select(...).from(referenceDocumentChunks)` — `reference_document_chunks` is FORCE RLS (migration 0289).
- L137: same table, second read.

  Reason: Codex flagged the chunk-embed instance and called it out as a class of bug ("This worker also opts out of org context but then reads FORCE-RLS tables..."); the reembed worker has the identical pattern. Adversarial-reviewer line 181 explicitly named both files. Fixing only one would leave the same bug live in the reembed path.

### [ACCEPT] server/jobs/documentPromotionFinaliseJob.ts:47-77 — FORCE-RLS reads under unguarded plain db

Codex P1: the promotion-finalise worker opts out of org context and reads `reference_documents` (FORCE RLS) and `document_promotion_audit` (FORCE RLS, migration 0294). The AKR-ADV-6 fix added explicit `eq(*, organisationId)` predicates as the tenant guard, but those predicates run AFTER the RLS policy filter — under FORCE RLS without the GUC set, the policy returns zero rows before the org predicate is even evaluated. The worker then throws `RETRIEVAL_VERSION_NOT_READY` indefinitely (5 retries), the durability flip never lands, and the file remains pruneable after expiry.

  Reason: real bug. The Codex P2 read on `executionFiles` is fine because that table is not RLS-protected (verified: it has no `organisation_id` column and is not in `RLS_PROTECTED_TABLES`); only the two FORCE-RLS reads need the GUC. Existing AKR-ADV-6 routing only addressed the missing org predicate, not the missing RLS context.

### [REJECT] server/services/retrievalService.ts:68-70 — retrieval pool omits scheduled-task and task-instance scope tiers

Codex P2: the candidate-pool UNION only ORs org, subaccount, and agent scope-link rows; scheduled-task and task-instance tier links are silently ignored.

  Reason: already routed as **AKR-CONF-5** in `tasks/todo.md` ("Five-tier candidate-pool UNION reduced to three tiers... scheduled-task and task-instance tiers are explicitly skipped (comment 'not available on agent_runs in v1')"). Per the dual-reviewer contract, skip findings that overlap an already-routed AKR-CONF-* item.

### Iteration 1 summary

Accepted 3 findings (Codex's 2 P1s plus the extended reembed-worker class-of-bug fix from Codex's framing). Rejected 1 finding as already routed.

Applied edits:
- `server/jobs/documentChunkEmbedJob.ts` — wrapped the `referenceDocumentVersions` content read in a short `db.transaction` that issues `SELECT set_config('app.organisation_id', $1, true)` before the SELECT. Embedding API call still runs outside any DB tx (spec §1.5 #9 preserved).
- `server/jobs/documentReembedJob.ts` — wrapped the eligible-docs scan and the two `processDocument` reads in their respective short org-scoped read txs. Combined the two `processDocument` reads into a single tx since both fire before any embedding I/O.
- `server/jobs/documentPromotionFinaliseJob.ts` — combined Steps 1 and 2 into a single short read tx that sets the GUC; updated the misleading top-of-handler comment to reflect the actual transaction strategy. Added `sql` to drizzle-orm imports.

Verified `npm run lint` (0 errors, 849 pre-existing warnings) and `npm run typecheck` (clean) post-edits.

## Iteration 2

Re-ran Codex with `--uncommitted` to validate the applied fixes.

Codex output verbatim: *"The changes correctly add short org-scoped transactions for FORCE RLS reads while preserving the invariant that embedding API calls happen outside database transactions. Server typechecking passes and no introduced correctness issues were found."*

No findings. Loop terminates per the "no findings" exit condition.

---

## Changes Made

- `server/jobs/documentChunkEmbedJob.ts` — wrapped pre-embedding `referenceDocumentVersions` read in a short org-scoped read tx; embedding I/O still runs outside any DB tx.
- `server/jobs/documentReembedJob.ts` — wrapped the eligible-docs scan (1 read) and the two `processDocument` chunk reads in short org-scoped read txs (one tx covering both `processDocument` reads since they fire back-to-back before embedding).
- `server/jobs/documentPromotionFinaliseJob.ts` — collapsed Steps 1+2 into one short org-scoped read tx with `set_config('app.organisation_id', $1, true)`; refreshed the worker-level comment that previously claimed "no RLS scoping needed"; added `sql` to drizzle-orm imports.

## Rejected Recommendations

- Codex P2 on `retrievalService.ts:68-70` (5-tier UNION reduced to 3 tiers): already captured as AKR-CONF-5 in `tasks/todo.md`. Per the dual-reviewer contract, findings overlapping a routed AKR-CONF-* / AKR-ADV-* / PR-REV-* item are skipped — the deferred-items system is the correct routing for spec-vs-impl divergences pending design resolution.

---

**Verdict:** APPROVED (2 iterations, 3 P1 RLS-context fixes applied across 3 worker files; 1 P2 finding rejected as already routed)
