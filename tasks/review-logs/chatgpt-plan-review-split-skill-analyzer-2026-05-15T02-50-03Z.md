# chatgpt-plan-review — split-skill-analyzer

**Date:** 2026-05-15
**Plan:** tasks/builds/split-skill-analyzer/plan.md
**Spec:** tasks/builds/split-skill-analyzer/spec.md
**Mode:** manual
**Build slug:** split-skill-analyzer
**Scope class:** Significant (Major-flavoured — 15 chunks, ~6,369 LOC, two-file split + RLS migration + worker conversion)

## Plan-time decisions surfaced to ChatGPT (operator briefing)

1. Spec-drift correction — spec §3 said "0 impure-shell callers"; architect's Chunk 0 sweep found 6 (1 route, 1 job handler, 4 smoke-test scripts). Plan records the correct count; spec patched in-flight during chatgpt-plan-review Round 1 (see Round 1 below).
2. Chunk ordering flip vs spec §9 — plan moves SA4 (worker conversion) to Chunk 13 and RLS+SA6 to Chunk 14. Reason: `getOrgScopedDb` requires an active org-scoped tx; `createWorker` is what opens it. Migrating raw-db writes before the worker conversion would throw `missing_org_context` on every Stage-6 write.
3. First parent-EXISTS RLS policy in the codebase — `skill_analyzer_results` has no direct `organisation_id` column; tenant key reached via `job_id` FK to `skill_analyzer_jobs`. Plan uses parent-EXISTS in both USING and WITH CHECK.
4. Worker payload extended at both `boss.send` sites — `createWorker`'s default resolver reads `organisationId` from payload; current payload is `{ jobId }`. Plan extends to `{ jobId, organisationId }` in `jobLifecycle/create.ts` and `jobLifecycle/resume.ts`.

---

## Round 1

**Operator feedback summary:** APPROVE with 3 should-fix items + 1 tightening + 1 spec patch (R8). All findings classified technical (plan internals + 1-line spec correction); auto-applied per operator triage.
**Findings:** 5 total (4 technical: F1, F2, F3, T1; 1 spec-patch: R8) — all auto-applied.

### Decisions

| # | Finding | Triage | Decision | Rationale |
|---|---|---|---|---|
| F1 | Chunk 13 `resolveOrgContext: () => null` fallback invalidates Chunk 14 — null-resolver path makes Stage-6 writes throw `missing_org_context`. | technical | ACCEPT | Operator-triaged: the fallback IS a contradiction with Chunk 14. Rewrote as "stop and revise the plan; do not proceed to Chunk 14 until the worker opens an org-scoped tx by another explicit mechanism." Null-resolver path explicitly disallowed. |
| F2 | Chunk 15 allows optional caller migration but AC requires unchanged 16/6 grep counts — any migration legitimately fails its own AC. | technical | ACCEPT | Operator-triaged: caller migration was always meant to be out of scope (Chunk 15 = verification + doc-sync). Removed the optional-migration sentence from "Files modified"; added "Not modified in this chunk (intentional)" block; added a deferred bullet in "Out of scope / deferred". AC text now reaffirms unchanged counts. |
| F3 | `tasks/todo.md` closure scheduled before PR number exists — builder would have to insert a placeholder or partially edit a finalisation-owned status. | technical | ACCEPT | Operator-triaged: PR-number placeholder is incoherent at builder time. Removed `tasks/todo.md` from Chunk 15 modified files. Added new AC: Chunk 15 records closure-text proposal in `progress.md` and PR description for SA1/SA2/SA4/SA6; `finalisation-coordinator` applies it once PR number is known. |
| T1 | `npm run db:generate` is a noisy verifier for an RLS-only hand migration outside Drizzle's tracked surface. | technical | ACCEPT | Operator-triaged: confirmed. Replaced `npm run db:generate` in Chunk 14 verification commands with five static grep checks: file existence, `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, `WITH CHECK`, `skill_analyzer_jobs` parent reference, and manifest entry in `rlsProtectedTables.ts`. Full `verify-rls-coverage.sh` / `verify-rls-protected-tables.sh` remain CI-only as already stated. |
| R8 | Pre-existing spec drift — spec §3 line 76 says "shows 0 external callers in a naive grep"; should say "shows 6 external callers per Chunk 0 sweep result 2" to prevent spec-conformance friction. | technical (spec patch) | ACCEPT | Operator-triaged: cheap 1-line correction prevents downstream spec-conformance friction. Patched spec.md line 76 in-flight. Spec §10 line 252 left as-is (correctly says "naive grep returns 0" and directs the architect to investigate — the architect's investigation IS the Chunk 0 sweep). Plan R8 risk entry updated to reflect the in-flight patch. |

### Changes applied

- `tasks/builds/split-skill-analyzer/plan.md`:
  - Chunk 13 "Fallback path" rewritten — null-resolver opt-out explicitly disallowed; only valid recovery is fixing the underlying conflict so `withOrgTx` opens around the handler.
  - Chunk 15 "Files modified" replaced — caller migration removed; `tasks/todo.md` removed; new "Not modified in this chunk (intentional)" block names the 16 + 6 callers that stay on barrels and points `tasks/todo.md` closure at `finalisation-coordinator`.
  - Chunk 15 AC rewritten — adds requirement to record closure-text proposal for SA1/SA2/SA4/SA6 in `progress.md` and the PR description; reaffirms unchanged grep counts; states `tasks/todo.md` is NOT edited.
  - Chunk 14 verification commands replaced — `npm run db:generate` swapped for five static greps; AC adds "static verification greps return non-empty results."
  - "Out of scope / deferred" — added two new bullets: caller-migration deferred to follow-up build; `tasks/todo.md` closure owned by `finalisation-coordinator`.
  - R8 risk entry rewritten — now describes the in-flight spec patch and notes no spec-conformance friction expected.
- `tasks/builds/split-skill-analyzer/spec.md` line 76 patched — "shows 0 external callers in a naive grep" replaced with "shows 6 external callers per Chunk 0 sweep result 2 (1 route, 1 job handler, 4 smoke-test scripts) — the surface is locked in `tasks/builds/split-skill-analyzer/plan.md § Chunk 0` and includes the `skillAnalyzerService` aggregate object (line 2614) plus 5 named-function imports."

---

## Round 2

**Operator feedback summary:** APPROVE with 1 should-fix (F1) + 1 tightening (T1). Both technical; auto-applied per operator triage ("final feedback, lock plan after this").
**Findings:** 2 total (2 technical: F1, T1) — both auto-applied.

### Decisions

| # | Finding | Triage | Decision | Rationale |
|---|---|---|---|---|
| F1 | Decision 2's final sentence still says "Option (b) is named in Chunk 13 as the fallback if (a) breaks the wrapper" — contradicts the corrected Chunk 13 fallback path that explicitly disallows the null-resolver opt-out. | technical | ACCEPT | Operator-triaged: stale builder guidance is a contradiction with Chunk 13's corrected fallback (Chunk 14 requires an active org-scoped tx for `getOrgScopedDb` — null-resolver path is not viable). Rewrote final sentence verbatim per ChatGPT's recommendation: "If the default resolver path fails, stop and revise the plan; the null-resolver opt-out is not a valid fallback for this build." |
| T1 | Out-of-scope still lists "spec.md amendment for the '0 callers' claim" as deferred, but R8 (Round 1) confirms it was patched in-flight. Stale bullet. | technical | ACCEPT | Operator-triaged: cleaner to remove the bullet entirely than to reword (the amendment shipped in Round 1; no longer relevant to out-of-scope). Bullet deleted from "Out of scope / deferred" section. |

### Changes applied

- `tasks/builds/split-skill-analyzer/plan.md`:
  - Architecture Notes — Decision 2 final sentence rewritten: "Option (b) is named in Chunk 13 as the fallback if (a) breaks the wrapper `runSkillAnalyzerJobWithIncidentEmission` for any reason." → "If the default resolver path fails, stop and revise the plan; the null-resolver opt-out is not a valid fallback for this build."
  - "Out of scope / deferred" — removed the bullet `"**`spec.md` amendment for the "0 callers" claim.** The plan records the correct count; the spec author may patch the spec separately. Plan does not block on it."` (now stale — the spec was patched in-flight during Round 1, per R8 in Round 1 above).

---

## Final Summary

**Verdict:** APPROVED
**Rounds:** 2
**Auto-applied:** 7 findings (Round 1: F1, F2, F3, T1, R8; Round 2: F1, T1)
**Operator-approved:** 0 findings
**Deferred to `tasks/todo.md`:** 0 findings
**Operator instruction:** "final feedback, lock plan after this" — session CLOSED at APPROVED after Round 2.
**Plan locked:** `tasks/builds/split-skill-analyzer/plan.md` — no Round 3.
