# split-skill-analyzer — Phase 2 progress

**Branch:** `claude/split-skill-analyzer`
**Spec:** `tasks/builds/split-skill-analyzer/spec.md`
**Phase 1 status:** Spec pre-drafted + merged via PR #316 (2026-05-15). No standard `handoff.md` from Phase 1 — operator instructed to skip handoff restore.
**Coordinator entry:** in-flight adoption of feature-coordinator playbook by main session.

## Session log

### 2026-05-15T (Phase 2 start)

- Created feature branch `claude/split-skill-analyzer` from `origin/main` (76377549).
- TodoWrite skeleton emitted (12 items per feature-coordinator playbook).
- S1 branch-sync skipped — branch is at origin/main HEAD, no merge needed.
- Migration-number collision check: clean. Next free migration: `0359`.
- Loaded spec, architect agent contract, current-focus snapshot, recent tasks/todo.md.
- About to invoke architect with mandatory chunk-0 caller sweep brief.

## Environment snapshot

- last_chunk_committed: (none yet)
- head: 76377549 (origin/main)
- migration_count: 358
- captured_at: 2026-05-15T (build start)

## chatgpt-plan-review

- **Verdict:** APPROVED (2 rounds)
- **Findings:** 7 total auto-applied (Round 1: F1 fallback removal, F2 caller-migration out-of-scope, F3 todo.md closure deferred to finalisation, T1 db:generate → static greps, R8 spec patched in-flight; Round 2: F1 Decision 2 final-sentence aligned, T1 stale out-of-scope bullet removed)
- **Log:** `tasks/review-logs/chatgpt-plan-review-split-skill-analyzer-2026-05-15T02-50-03Z.md`
- **Plan-time decisions worth flagging at plan-gate:**
  1. SA4 worker (Chunk 13) lands BEFORE SA6 raw-db migration (Chunk 14) — flipped from spec §9 ordering. `getOrgScopedDb` requires the org-scoped tx that `createWorker` opens.
  2. Worker payload extended at both `boss.send` sites to include `organisationId`; null-resolver opt-out explicitly disallowed.
  3. First parent-EXISTS RLS policy in the codebase (template for future FK-only tenant tables).
  4. Spec §3 patched in-flight (was "0 callers", now "6 callers per Chunk 0 sweep result 2").

## REVIEW_GAP entries

(none yet)

## Doc Sync gate

### Verdicts (Step 6 — 2026-05-15)

| Doc | Verdict |
|-----|---------|
| `architecture.md` | yes (§ v2 bug-fix cycle: updated `executeApproved` path from monolith to sub-module at line 2751) |
| `docs/capabilities.md` | n/a: internal refactor with no capability surface change |
| `docs/integration-reference.md` | no — checked `skillAnalyzerService`, `skill_analyzer`, `getOrgScopedDb`; zero matches |
| `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` | n/a — no convention change; RLS patterns recorded in KNOWLEDGE.md |
| `CONTRIBUTING.md` | n/a — no suppression-policy change |
| `docs/frontend-design-principles.md` | n/a — no UI changes |
| `KNOWLEDGE.md` | yes (3 entries: FORCE RLS parent-EXISTS policy, inner db.transaction bypass, pre-fix grep discipline) |
| `docs/decisions/` | n/a — extending an established RLS pattern, not locking a new architectural choice |
| `docs/context-packs/` | n/a — no architecture.md anchor ID changes |
| `references/test-gate-policy.md` | n/a — no gate posture change |
| `references/spec-review-directional-signals.md` | n/a — not triggered |
| `docs/incident-response.md` | n/a — not triggered |
| `docs/testing-transition-plan.md` | n/a — not triggered |
| `.claude/FRAMEWORK_VERSION` / `.claude/CHANGELOG.md` | n/a — no framework-level change |
| `scripts/verify-*` | n/a — no gate added/removed/renamed |

## Compound Learning Feedback (Step 7a — 2026-05-15)

| # | Pattern | Source | Target enum | Proposal |
|---|---------|--------|-------------|---------|
| CL1 | FK-only tenant tables need parent-EXISTS RLS policy, not direct-column form | migration 0359 (PR #320) | pre-migration-review checklist | Add: "If the table has no direct `organisation_id` column but reaches org via an FK chain, write a parent-EXISTS policy on the immediate parent table (see `0359_skill_analyzer_results_rls.sql`)." |
| CL2 | Inner `db.transaction()` in route-called service methods bypasses FORCE RLS (new pool connection, no GUC) | `resolveWarning()` fix (PR #320 F1) | multi-tenant safety checklist | Add: "Grep service files for `db.transaction(` — every inner wrapper that touches a FORCE RLS table is a candidate bypass; replace with `getOrgScopedDb()`." |
| CL3 | Before writing any FORCE RLS fix, enumerate ALL raw `db.*` access sites to the table across the entire service tree | PR #320 F1+F4 two-round pattern | pre-fix-grep discipline | Add: "When adding FORCE RLS to table X: first run `grep -rn 'X' server/services/` to enumerate all service touch-points; fix ALL in one pass, not iteratively." |

## Closure proposals for tasks/todo.md (apply at finalisation once PR# known)

- SA1: Mark `[status:closed:pr:<num>]` — RLS migration 0359 adds org-isolation policy on skill_analyzer_results
- SA2: Mark `[status:closed:pr:<num>]` — skillAnalyzerServicePure refactored from 3727 LOC monolith to 64-LOC barrel + 20 sub-modules
- SA4: Mark `[status:closed:pr:<num>]` — boss.work converted to createWorker at server/index.ts
- SA6: Mark `[status:closed:pr:<num>]` — raw db.insert in persistence/results.ts migrated to getOrgScopedDb

## Chunk 15 caller sweep results

- Pure-file callers (unique source files, excl. barrel + sub-module internals): 26 (24 server/ + 2 scripts/)
- Impure-shell callers (unique source files, excl. barrel): 6
- boss.work count in server/index.ts: 4
- Pure barrel LOC: 64
- Impure barrel LOC: 78
