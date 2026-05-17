# Wave 1 Env D — Phase 2 (BUILD) Handoff

**Slug:** `wave-1-cleanup-prevention`
**Branch:** `claude/wave-1-cleanup-prevention`
**PR:** [#317](https://github.com/michaelhazza/automation-v1/pull/317) — "wave-1: prevention + cleanup batch (Env D)"
**Build type:** Standard (mechanical doc/gate/package.json batch — light pipeline, no spec-coordinator, no feature-coordinator)
**Phase 2:** Inline build session 2026-05-15 — all ~30 items from `launch-prompt.md` implemented in two commits.
**Phase 3 entry:** This handoff. Reconstructed at Phase 3 finalisation entry on 2026-05-15T13:24:09Z.

---

## Reconstruction context

Light-pipeline build — no formal Phase 1 or Phase 2 coordinator. Operator authored the full item list directly in `tasks/builds/wave-1-cleanup-prevention/launch-prompt.md`. Phase 2 ran inline. `finalisation-coordinator` reconstructs this handoff at Phase 3 entry.

---

## What shipped

Single PR covering ~30 mechanical prevention + cleanup items across four origin tracks:

**package.json (2 items)**
- `pg: ^8.18.0` added to `optionalDependencies` (closes pre-v1 lockdown "Missing dep pg")
- `@playwright/test` moved from `dependencies` to `devDependencies`

**Gate baseline extension (1 item)**
- `scripts/.gate-baselines/with-org-tx-or-scoped-db.txt` extended to full server/services, server/jobs, server/lib, server/adapters scan (closes P15)

**Gate warning→error promotions (11 of 14 items)**
- 11 scripts flipped DEFAULT_EXIT_CODE 2→1; 3 reverted (verify-any-budget, verify-marker-budget, verify-duplicate-blocks failed on current main with no new violations — left as warning per launch-prompt policy)

**New gates authored (4 items)**
- `scripts/verify-fk-only-tenant-tables.sh` (Q2, Track A2) — seeded baseline
- `scripts/verify-agents-view-in-workflow-routes.sh` (Q6, Track A2) — seeded baseline
- `scripts/verify-no-direct-boss-work.sh` (R1, Track A3) — 16 entries in baseline
- `scripts/verify-org-id-source.sh` tightened (P1, Track A)

**Doc additions (10 items — append-only)**
- `architecture.md`: "Single org-id source" subsection
- `architecture.md`: "FK-scoped RLS pattern" with EXISTS template + IS NOT NULL/`<>''` guards
- `architecture.md`: "Canonical worker registration" subsection
- `DEVELOPMENT_GUIDELINES.md`: §8.38 (tick worker org context rule)
- `DEVELOPMENT_GUIDELINES.md`: §8.39 (routes never import from schema)
- `KNOWLEDGE.md`: 2 new patterns appended (FK-scoped RLS via parent-EXISTS; split god-file)
- `KNOWLEDGE.md`: 2 patterns confirmed already present from prior PRs (URL paths diverge; audit log refs stale)
- `docs/codebase-audit-framework.md`: Area 10 caps extended to `server/jobs/*`

**Run gate scripts included in `run-all-gates.sh`**
- `verify-fk-only-tenant-tables.sh`, `verify-agents-view-in-workflow-routes.sh`, `verify-no-direct-boss-work.sh` added

---

## Commits

| Commit | Summary |
|--------|---------|
| `91b915c4` | feat(wave-1): prevention + cleanup batch (Env D) |
| `d396ba74` | fix(wave-1): apply pr-reviewer findings |

---

## Review status entering Phase 3

| Review pass | Status |
|---|---|
| `spec-conformance` | skip — no spec (light-pipeline) |
| `pr-reviewer` | **DONE.** Ran inline; findings applied in `d396ba74`. |
| `reality-checker` | skip — Standard task class |
| `adversarial-reviewer` | skip — Standard task class; no security surface (no auth/RLS/schema changes) |
| `dual-reviewer` | skip — Standard task class per GRADED posture policy |
| `chatgpt-pr-review` | **To run in Phase 3 step 5 (user-requested).** |

---

## REVIEW_GAP entries

None. All reviewer skips are policy-not-applicable for a Standard task.

---

## Spec deviations

None. Light-pipeline build has no formal spec — all items shipped as specified in `launch-prompt.md`.

---

## Tasks/todo.md items to close on merge

Origin anchors to close:
- `[origin:audit:prevention:pg-dep]` — pg optionalDependency
- `[origin:audit:prevention:playwright-dev]` — playwright devDependency
- `[origin:audit:prevention:P15]` — with-org-tx baseline extension
- Gate promotions: all 11 successfully flipped gates
- `[origin:audit:prevention:Q2]` — verify-fk-only-tenant-tables
- `[origin:audit:prevention:Q6]` — verify-agents-view-in-workflow-routes
- `[origin:audit:prevention:R1]` — verify-no-direct-boss-work
- `[origin:audit:prevention:P1]` — verify-org-id-source tightening
- All 10 doc addition items (P5, Q3, R2, Q4, P4, Q5, R4, R6, NEEDS-DISCUSSION, R5)

---

## Phase 3 (FINALISATION)

**Status:** In progress — 2026-05-15T13:24:09Z
