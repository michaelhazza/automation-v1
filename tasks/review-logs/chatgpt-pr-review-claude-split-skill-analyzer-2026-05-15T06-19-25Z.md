# chatgpt-pr-review — claude/split-skill-analyzer

## Session Info

| Field | Value |
|---|---|
| Branch | `claude/split-skill-analyzer` |
| PR | [#320](https://github.com/michaelhazza/automation-v1/pull/320) |
| Mode | manual |
| Started | 2026-05-15T06:19:25Z |
| Slug | `claude-split-skill-analyzer` |
| Spec deviations | none recorded in Phase 2 |
| Overall verdict | (pending) |

---

## Round 1

**Diff file:** [.chatgpt-diffs/pr320-round1-code-diff.diff](.chatgpt-diffs/pr320-round1-code-diff.diff) (code-only, 45 files, 572K)
**Full diff:** [.chatgpt-diffs/pr320-round1-diff.diff](.chatgpt-diffs/pr320-round1-diff.diff) (52 files, 688K)

### ChatGPT Feedback (raw)

Verdict: CHANGES REQUIRED. 2 blocking issues and 1 should-fix.
- F1 (Blocking): FORCE RLS breaks route-facing reads/mutations on skill_analyzer_results. getJob, setResultAction, bulkSetResultAction, updateAgentProposal, patchMergeFields, resetMergeToOriginal, resolveWarning, and warning batch paths still use raw db.
- F2 (Blocking): Bad relative import in results/merge.ts — `../../../../shared/skillParameters.js` should be `../../../shared/skillParameters.js`.
- F3 (Should-fix): Public Pure barrel surface widened by exported private helpers (normaliseHeading, splitH2Sections, GENERIC_BIGRAMS, isGenericBigram, extractDescriptionBigrams).

### Decisions Table

| ID | Title | Triage | Recommendation | Action | Rationale |
|---|---|---|---|---|---|
| F1 | FORCE RLS breaks route-facing skillAnalyzerResults accesses | technical | implement | Applied — migrated all 5 files (get.ts, setAction.ts, updateProposal.ts, merge.ts, warnings.ts) to getOrgScopedDb; removed inner db.transaction wrapper from resolveWarning | Verified: all files used raw db for skillAnalyzerResults; with migration 0359 FORCE RLS these would silently return 0 rows. Commit: `fix(skill-analyzer-rls): migrate all route-facing skillAnalyzerResults accesses to getOrgScopedDb` |
| F2 | Bad relative import in results/merge.ts | technical | reject | Rejected — diff-misread | Verified: `shared/skillParameters.ts` is at project root, not `server/shared/`. Path `../../../../shared/` from `server/services/skillAnalyzerService/results/` correctly resolves to root `shared/`. Typecheck passes confirms path is valid. |
| F3 | Pure barrel exports private helpers | technical | reject | Rejected — false positive | Verified: normaliseHeading/splitH2Sections used by collisions.ts; GENERIC_BIGRAMS/isGenericBigram/extractDescriptionBigrams used by both collisions.ts and validation.ts. All helpers are intra-tree shared and must be exported for sibling module use. export * pattern is established codebase convention. |

---

## Round 2

**Diff file:** [.chatgpt-diffs/pr320-round2-code-diff.diff](.chatgpt-diffs/pr320-round2-code-diff.diff) (code-only, 45 files, 572K — includes Round 1 F1 fix)

### ChatGPT Feedback (raw)

Verdict: One remaining blocker.
- F4 (Blocking): execute/approved.ts and execute/retry.ts still use raw db against skillAnalyzerResults — failResult(), success-result updates, retryClassification reads/updates, bulkRetryFailedClassifications scans.
- F2 re-confirmed safe (project-root shared/ path).
- F3 re-confirmed not worth blocking.

### Decisions Table

| ID | Title | Triage | Recommendation | Action | Rationale |
|---|---|---|---|---|---|
| F4 | execute/approved.ts + retry.ts raw db on skillAnalyzerResults | technical | implement | Applied — migrated 4 updates in approved.ts (failResult, skip-duplicate, mark-updated, mark-created) and 4 accesses in retry.ts (retryClassification read+update, bulkRetry readFailed+readRemaining) to getOrgScopedDb | Verified: all 8 access sites confirmed in live files; none previously migrated. Typecheck clean. Commit: `fix(skill-analyzer-rls): migrate execute/approved + execute/retry skillAnalyzerResults to getOrgScopedDb` |

---

## Final Summary

| Field | Value |
|---|---|
| Rounds completed | 2 |
| Findings total | 4 (F1, F2, F3, F4) |
| Applied | 2 (F1, F4) |
| Rejected | 2 (F2 — diff-misread; F3 — helpers are intra-tree exports) |
| Deferred | 0 |
| Overall verdict | APPROVED |

---

| Field | Value |
|---|---|
| Rounds completed | 2 |
| Findings total | 4 (F1, F2, F3, F4) |
| Applied | 2 (F1 across 5 files; F4 across 2 files) |
| Rejected | 2 (F2 diff-misread; F3 intra-tree exports are intentional) |
| Deferred | 0 |
| KNOWLEDGE.md entries added | (see Step 7) |
| Overall verdict | APPROVED |
