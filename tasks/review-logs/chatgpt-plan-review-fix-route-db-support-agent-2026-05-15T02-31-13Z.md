# chatgpt-plan-review — fix-route-db-support-agent

**Date:** 2026-05-15
**Plan:** tasks/builds/fix-route-db-support-agent/plan.md
**Spec:** tasks/builds/fix-route-db-support-agent/spec.md
**Build slug:** fix-route-db-support-agent
**Branch:** claude/fix-route-db-support-agent
**Task class:** Standard
**Mode:** manual

## Pre-accepted plan-gate decisions

Operator has already approved (do NOT re-surface as questions if ChatGPT raises them):

- Q1 — Delegate to existing `supportInboxService.ts` (deliberate spec-deviation vs §1.2/§5; DRY).
- Q2 — Gate baseline cleanup is a no-op (baseline empty; spec §6.4 vacuously satisfied).
- Q3 — F5 option β (conditional `hasOrgPermission(AGENTS_VIEW)` inside default branch; `ownerScope=user` unguarded).

If ChatGPT raises any of these as open questions, auto-reject as duplicate per operator memory.

---

## Round 1 — 2026-05-15

**Verdict:** APPROVE with 2 should-fix + 2 tightenings. Construction not blocked; tighten before chunk 1.

**Findings triage:**

| # | Title | Category | Severity | Triage | Action |
|---|---|---|---|---|---|
| F1 | Chunk 5 test contract for AGENTS_EDIT + default scope is ambiguous | B (Contracts) | SHOULD-FIX | TECHNICAL | Auto-applied — Chunk 5 test table rewritten to enumerate all permission states (none / AGENTS_VIEW only / AGENTS_EDIT only / both). The AGENTS_EDIT-only row codifies the no-implication invariant: expected 403. |
| F2 | Chunk 6 says `tasks/todo.md` is modified but body says finalisation owns the edit | D (Chunk sizing / contract) | SHOULD-FIX | TECHNICAL | Auto-applied — removed `tasks/todo.md` from Chunk 6 file inventory; added to "Files NOT modified". Closure text is now recorded inline in `progress.md` under `## Closure text for finalisation-coordinator`. Acceptance criterion rewritten. |
| T1 | Strengthen Chunk 1 acceptance around scoped `where` composition | C (Primitives-reuse) | TIGHTENING | TECHNICAL | Auto-applied — added explicit acceptance criterion: `activeOnly` composes with, never replaces, existing org/subaccount scoping; new test must run with subaccount-scoped principal and assert no sibling-subaccount leakage. |
| T2 | Chunk 4 static grep should include all DB-layer imports | B (Contracts) | TIGHTENING | TECHNICAL | Auto-applied — added broader `grep -nE "from '\.\./\.\./db\|db\.(select\|insert\|update\|delete)"` check to Chunk 4 acceptance. Note that `getOrgScopedDb` is NOT imported in the route (lives inside the service). |

**User-facing findings:** none. All four were mechanical/technical plan edits.

**Duplicates auto-rejected:** none — ChatGPT correctly respected the pre-accepted Q1/Q2/Q3 trio and the two flagged context items (makePrincipal behaviour-delta, F5 mixed-pattern).

**Plan file state:** updated in-branch (uncommitted). Diff confined to:
- §8 Chunk 1 acceptance criteria (T1)
- §8 Chunk 4 acceptance criteria (T2)
- §8 Chunk 5 test table (F1)
- §8 Chunk 6 files modified + acceptance (F2)
- §5 Files NOT modified (F2 addition)

---

## Round 2 — 2026-05-15

**Verdict:** APPROVE — all four Round 1 fixes (F1, F2, T1, T2) confirmed resolved. One optional tightening surfaced.

**Findings triage:**

| # | Title | Category | Severity | Triage | Action |
|---|---|---|---|---|---|
| T3 | Chunk 2 intermediate-state guard for async makePrincipal | B (Contracts) | OPTIONAL | TECHNICAL | Applied — added acceptance criterion to Chunk 2: every `makePrincipal` call site updated to `await` the async principal resolver, including the still-unmigrated PATCH handler; PATCH must typecheck with new async signature before its DB work is delegated in Chunk 3. |

**User-facing findings:** none.

**Duplicates auto-rejected:** none — ChatGPT confirmed F1/F2/T1/T2 all resolved; Q1/Q2/Q3 pre-accepted trio respected throughout.

**Plan file state:** APPROVED. Diff confined to:
- §8 Chunk 2 acceptance criteria (T3)
- frontmatter status: DRAFT → APPROVED

**Session closed.** Proceed to plan-gate (Step 5).
