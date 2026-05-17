# ChatGPT PR Review — wave-6-cleanup-batch

## Session Info

- **Branch:** `claude/wave-6-cleanup-batch`
- **PR:** [#346](https://github.com/michaelhazza/automation-v1/pull/346) — "wave-6: cleanup batch + stale-status sweep + v2-backlog absorption (Session Q)"
- **Mode:** manual
- **Started:** 2026-05-17T11:46:33Z
- **Build slug:** wave-6-cleanup-batch
- **Branch HEAD at session start:** `a1f5d79b`
- **Diff at session start:** 44 code files (64K) / 51 total files (124K)

## Phase 2 review summary (context for ChatGPT)

- spec-conformance: SKIPPED (no spec)
- adversarial-reviewer: HOLES_FOUND (1 closed, 2 backlogged)
- pr-reviewer R1: CHANGES_REQUESTED → B1+S1+S3 fixed, 5 backlogged
- dual-reviewer Codex: APPROVED (1 [ACCEPT] fix on OSI-DEF-7 UUID validation 500→400)
- pr-reviewer R2: APPROVED (RR-S1 regression test added, 2 backlogged)

## Rounds

### Round 1 — 2026-05-17T11:50:00Z

**Diff:** `.chatgpt-diffs/pr346-round1-code-diff.diff` (64K, 44 files)

**ChatGPT Feedback (raw):**

> I'll review the latest pasted PR markdown directly from the uploaded file and focus on whether the previous findings were properly fixed or if any new regression was introduced.
>
> Older uploaded files have expired, but I could inspect the latest uploaded PR diff.
>
> Additional finding:
>
> | ID | Severity | Finding |
> |----|----------|---------|
> | F1 | 🟡 Should-fix | definePruneJob now allowlists `= null`, but SQL `col = NULL` never behaves like `IS NULL`. This can silently make a prune job match nothing if a future caller uses the accepted shape. Disallow `= null` / `!= null` and require `IS NULL` / `IS NOT NULL` only. |
>
> Also worth confirming: the PR removes several default exports from shared React components. Make sure there are no remaining default imports outside the diff, otherwise typecheck will fail.
>
> Verdict: CHANGES_REQUESTED unless the `= null` case is intentionally supported despite the SQL semantics.

**Triage:**

| ID | Triage | Recommendation | Rationale |
|----|--------|----------------|-----------|
| F1 | technical | implement | SQL `col = NULL` evaluates to UNKNOWN, never TRUE. A caller writing `AND deleted_at = null` to "select soft-deleted rows" would silently match zero rows. The fix is mechanical — remove `null` from the literal alternation in the regex, force null checks through the existing `IS NULL` / `IS NOT NULL` branch. No production caller uses the broken shape today (`server/jobs/agentObservationsPruneJob.ts:32` uses `'AND pinned_at IS NULL'`; `server/jobs/sandboxLogsPruneJob.ts:37` uses `'OR is_active = false'`). Pure tightening, no breaking change. |
| Verification | technical | verify | Default-import sweep over the 7 converted components (Drawer, SortableTable, WorkspaceBadge, PendingHero, SparklineChart, HelpHint, NeedsAttentionRow): 0 remaining default imports anywhere in `client/src/`. Typecheck (G3 + G4) confirms clean. |

**Actions taken:**

- **F1 implemented** in commit (to be created):
  - `server/jobs/lib/definePruneJob.ts:55`: removed `null` from the literal alternation; expanded the error message to clarify "use IS NULL / IS NOT NULL for null checks".
  - `server/jobs/lib/__tests__/definePruneJob.test.ts`: moved `'AND deleted_at = null'` from `acceptedShapes` to `rejectedShapes`; added `'OR deleted_at != null'` + `'AND deleted_at <> null'` to the rejected matrix with an inline comment naming the chatgpt-pr-review R1 F1 origin.
  - Vitest: 14/14 pass; G3 clean (lint 0 errors, typecheck clean).

- **Default-import verification confirmed:** grep across `client/src/` for `import <Component> from` against each of the 7 converted components returned 0 matches. G4 typecheck already passed independently.

**Verdict for Round 1:** APPROVED with F1 implemented.

**Next-round diff:** `.chatgpt-diffs/pr346-round2-code-diff.diff` (will be regenerated after the F1 commit lands).

