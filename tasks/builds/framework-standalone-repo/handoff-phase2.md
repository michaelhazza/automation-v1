# Handoff — framework-standalone-repo — Phase 2 → Phase 3

**Build slug:** `framework-standalone-repo`
**Branch:** `claude/framework-standalone-repo`
**Scope class:** Significant
**Spec:** `tasks/builds/framework-standalone-repo/spec.md` — Final
**Plan:** `tasks/builds/framework-standalone-repo/plan.md`
**Phase 1 handoff:** `tasks/builds/framework-standalone-repo/handoff.md`
**Phase 2 captured:** 2026-05-04

---

## Table of contents

- What shipped (Phase A)
- Branch-level review pass
- G1 / G2 gates
- Working-tree state at handoff
- Recommended commit grouping
- Phase 3 entry conditions
- Candidate KNOWLEDGE.md patterns
- Open operator decisions for Phase 3
- Artefacts produced in Phase 2

---

## What shipped (Phase A)

The portable sync infrastructure that lifts the Claude Code framework into its own repo distribution model:

- `setup/portable/manifest.json` — file ownership declaration (modes: sync / adopt-only / settings-merge; `removedFiles`; `doNotTouch`).
- `setup/portable/sync.js` (~1413 lines, JS-with-JSDoc, no external deps) — sync engine implementing the 12-step pseudocode in spec §4.5, all 6 flags (`--adopt`, `--dry-run`, `--check`, `--strict`, `--doctor`, `--force`), atomic `.framework-state.json` writes (PID-suffixed tmp), structured `SYNC file=… status=…` log lines.
- `setup/portable/SYNC.md` — guided upgrade prompt for Claude (7+1 phases).
- `setup/portable/ADAPT.md` — Phase 6 added (record adoption state).
- `setup/portable/package.json` — `"type": "commonjs"`.
- `setup/portable/tests/` — 9 test files, **113 passing tests** (110 author-provided + 3 added during Phase 2 review-pass: S1 mixed-group settings-merge collision + 2 path-traversal rejection tests).
- `setup/portable/.claude/CHANGELOG.md` — v2.2.0 entry.
- `setup/portable/.claude/FRAMEWORK_VERSION` → `2.2.0`.
- `setup/portable/.claude/agents/*.md` (10 modified) — placeholder migration `[X]` → `{{X}}`.
- `setup/portable/docs/frontend-design-principles.md`, `setup/portable/references/spec-review-directional-signals.md` — placeholder migration.
- `scripts/build-portable-framework.ts` — legacy-placeholder preflight scan added.
- `eslint.config.js` — added `setup/portable/**` to `ignores` (sync.js is JS-with-JSDoc per spec §4.5).

Two intentional spec-vs-implementation deltas, both pre-approved at plan-review time and recorded in plan §1.1 / §1.11:

1. `sync.js` is JS-with-JSDoc (~1413 lines), not "TypeScript ~300 lines." Plan §1.1: no build step in framework repo; honours runtime contract `node sync.js`.
2. `lastSubstitutionHash` is an additive optional field on FrameworkState (plan §1.11) to enforce the substitution-drift invariant. Forward-migrates pre-2.2.0 state.json transparently.

Phase B (lift to standalone GitHub repo) and Phase C (Automation OS self-adoption) come **after** Phase A is proven.

---

## Branch-level review pass

| Reviewer | Verdict | Log |
|---|---|---|
| spec-conformance | **CONFORMANT** (54/54 requirements) | `tasks/review-logs/spec-conformance-log-framework-standalone-repo-2026-05-04T05-47-00Z.md` (committed `ade9267e`) |
| pr-reviewer | CHANGES_REQUESTED → all blocking + chosen strong fixed in-branch | `tasks/review-logs/pr-reviewer-log-framework-standalone-repo-2026-05-04T05-59-12Z.md` |
| adversarial-reviewer | HOLES_FOUND → 2 confirmed + 2 worth-confirming fixed in-branch | `tasks/review-logs/adversarial-review-log-framework-standalone-repo-2026-05-04T06-08-15Z.md` |
| dual-reviewer | **SKIPPED** — Codex CLI unavailable (allowed per CLAUDE.md framework convention) | n/a |

**REVIEW_GAP:** Codex CLI unavailable → dual-reviewer skipped silently. Phase 3 `chatgpt-pr-review` is the primary second-opinion pass.

**Adversarial-reviewer auto-trigger context:** the diff is NOT in the standard auto-trigger surface (no server/db/schema, server/routes, auth/permission services, middleware, RLS migrations, webhook handlers). Invoked manually because `sync.js` performs filesystem writes driven by manifest data. The investment paid off — adversarial caught two confirmed-holes that pr-reviewer rated as nits.

### Tier 1 fixes applied in-branch (9 fixes)

| # | Fix | Source | Location |
|---|---|---|---|
| 1 | Reverted drive-by edit (B2) — out of Phase A scope | pr-reviewer | `.claude/agents/feature-coordinator.md` (live copy restored) |
| 2 | Added S1 mixed-group settings-merge test | pr-reviewer | `setup/portable/tests/settings-merge.test.ts` |
| 3 | Fixed B1 — `mergeSettingsHooksBlock` no longer drops project's framework-owned hook in mixed groups (spec §4.6 rule 4 contract restored) | pr-reviewer | `setup/portable/sync.js` |
| 4 | Added path-traversal guard (`assertWithinRoot` helper) in `expandGlob` + 4 writers + 2 rejection tests | adversarial (confirmed-hole) + pr-reviewer S3 | `setup/portable/sync.js`, `setup/portable/tests/helpers.test.ts` |
| 5 | `execSync` → `spawnSync` for git calls (shell injection — confirmed-hole) | adversarial-reviewer | `setup/portable/sync.js` |
| 6 | Preserve framework non-hooks top-level keys in `mergeSettings` (latent gap; structurally unsafe for future evolution) | adversarial-reviewer | `setup/portable/sync.js` |
| 7 | Count `ownership-transferred` in `--check` (closes silent CI-gate gap) | adversarial-reviewer | `setup/portable/sync.js` |
| 8 | PID-suffix `.tmp` filename in `writeStateAtomic` (concurrent-process race) | adversarial-reviewer | `setup/portable/sync.js` |
| 9 | `lastSubstitutionHash` forward-migration on early-exit path (S2) | pr-reviewer | `setup/portable/sync.js` |

### Tier 2 deferred to `tasks/todo.md`

Routed to `tasks/todo.md` under two new sections (`## Deferred from pr-reviewer review — framework-standalone-repo (2026-05-04)` and `## Deferred from adversarial-reviewer review — framework-standalone-repo (2026-05-04)`):

- pr-reviewer: S4, S5, N2, N3, N4, N5, N6, N7.
- adversarial-reviewer: symlink-follow guard, substitution shell-metacharacter validation, `--force` replace-in-progress merge UX, `readState` schema validation.

---

## G1 / G2 gates

- **G1 (per-chunk):** lint + typecheck + targeted tests — passed throughout build.
- **G2 (integrated state):**
  - `npm run lint` → 0 errors (726 pre-existing warnings unrelated to this branch; `setup/portable/**` is intentionally excluded per spec §4.5).
  - `npm run typecheck` → clean (both root and server tsconfigs).
  - **Targeted tests for files changed:** all 113 tests pass across all 9 test files in `setup/portable/tests/`.
  - **Test gates (CI-only):** not run locally per CLAUDE.md test-gate policy.

---

## Working-tree state at handoff

The Phase A implementation has not yet been committed — per the operator's "no auto-commits from main session" preference, commits are explicit.

**Already committed on branch (ahead of `origin/main` by several commits at merge-base `faa0166f`):**

- `d45af711` — chore(spec): lock framework-standalone-repo spec + write Phase 1 handoff
- `ade9267e` — chore(spec-conformance): framework-standalone-repo — CONFORMANT (auto-committed by spec-conformance agent, pushed)
- (plus the prior spec-review commits)

**Uncommitted in working tree at Phase 2 close** (operator to commit before launching Phase 3):

```
M  eslint.config.js
M  scripts/build-portable-framework.ts
M  setup/portable/.claude/CHANGELOG.md
M  setup/portable/.claude/FRAMEWORK_VERSION
M  setup/portable/.claude/agents/{adversarial-reviewer,architect,audit-runner,finalisation-coordinator,hotfix,pr-reviewer,spec-conformance,spec-reviewer,triage-agent,validate-setup}.md
M  setup/portable/ADAPT.md
M  setup/portable/README.md
M  setup/portable/docs/frontend-design-principles.md
M  setup/portable/references/spec-review-directional-signals.md
M  tasks/builds/framework-standalone-repo/spec.md
M  tasks/review-logs/spec-conformance-log-framework-standalone-repo-2026-05-04T05-47-00Z.md
M  tasks/todo.md
?? setup/portable/SYNC.md
?? setup/portable/manifest.json
?? setup/portable/package.json
?? setup/portable/sync.js
?? setup/portable/tests/
?? tasks/builds/framework-standalone-repo/plan.md
?? tasks/builds/framework-standalone-repo/handoff-phase2.md  (this file)
?? tasks/review-logs/adversarial-review-log-framework-standalone-repo-2026-05-04T06-08-15Z.md
?? tasks/review-logs/pr-review-log-framework-standalone-repo-2026-05-04T05-58-25Z.md  (auto-captured fenced block; superseded; operator may delete)
?? tasks/review-logs/pr-reviewer-log-framework-standalone-repo-2026-05-04T05-59-12Z.md
```

---

## Recommended commit grouping

1. **`feat(framework): Phase A — portable sync engine + manifest + tests`**
   Implementation: `setup/portable/SYNC.md`, `setup/portable/manifest.json`, `setup/portable/package.json`, `setup/portable/sync.js`, `setup/portable/tests/`, `setup/portable/ADAPT.md`, `setup/portable/README.md`, `setup/portable/.claude/CHANGELOG.md`, `setup/portable/.claude/FRAMEWORK_VERSION`, `setup/portable/.claude/agents/*.md`, `setup/portable/docs/frontend-design-principles.md`, `setup/portable/references/spec-review-directional-signals.md`, `scripts/build-portable-framework.ts`, `eslint.config.js`. The in-branch B1 / path-traversal / shell-injection / mergeSettings / `--check` / atomic-write-race / `lastSubstitutionHash` fixes ride in the same commit because they mutate sync.js and tests/ which were untracked.

2. **`docs(framework-standalone-repo): plan + Phase 2 handoff`**
   `tasks/builds/framework-standalone-repo/plan.md`, `tasks/builds/framework-standalone-repo/handoff-phase2.md`.

3. **`chore(review): Phase 2 review-pass logs + Tier 2 deferred items`**
   `tasks/review-logs/pr-reviewer-log-...md`, `tasks/review-logs/adversarial-review-log-...md`, `tasks/review-logs/spec-conformance-log-...md` (post-commit metadata edit), `tasks/todo.md` (Tier 2 routing). Optionally delete `tasks/review-logs/pr-review-log-...T05-58-25Z.md` (superseded auto-capture).

4. **`docs(current-focus): framework-standalone-repo BUILDING → REVIEWING`**
   `tasks/current-focus.md` only. Smaller commit so the status transition is easy to spot in `git log`.

---

## Phase 3 entry conditions

Phase 3 (`finalisation-coordinator`) should be launched **only after**:

- [ ] Four commits above land on `claude/framework-standalone-repo`.
- [ ] Branch pushed to remote (operator decision; review agents already pushed `ade9267e`).
- [ ] No new uncommitted state in working tree (`git status --short` is empty).
- [ ] `current-focus.md` status is `REVIEWING` (set by Phase 2 wrap; this file).

Phase 3 will run: S2 branch sync against `origin/main`, G4 regression guard, PR existence check (open PR if none), `chatgpt-pr-review` rounds, full doc-sync sweep (capabilities.md, architecture.md, KNOWLEDGE.md, etc. — none currently expected to need updates given internal-framework scope), KNOWLEDGE.md pattern extraction (candidates listed below), `tasks/todo.md` cleanup, transition to `MERGE_READY` and apply `ready-to-merge` label.

---

## Candidate KNOWLEDGE.md patterns (Phase 3 to extract)

1. **TDD on adversarial findings:** the S1 test (mixed-group settings-merge collision) was written before the B1 fix and confirmed the bug existed (failing assertion: 0 A entries instead of 1). Without the test, the fix would have been "looks right" rather than provably correct. Pattern: when a reviewer trace describes a specific scenario, write the test from the trace verbatim before fixing.

2. **Adversarial-reviewer escalates pr-reviewer nits:** two pr-reviewer findings (path-traversal S3, shell-injection N1) became confirmed-holes when re-rated through the threat-model lens. Running adversarial-reviewer outside its auto-trigger surface paid off because the implementation was a filesystem sync engine — manifest is supply-chain-trust input, framework path is execution-context input. Pattern: if the diff includes filesystem writes driven by external data, run adversarial-reviewer manually even if not auto-triggered.

3. **`assertWithinRoot` defence-in-depth pattern:** rather than a single up-front guard in `expandGlob`, the same assertion is also placed in each writer. Cheap, prevents regressions if the guard is loosened later, and makes the invariant easy to audit.

4. **PID-suffix tmp filename for atomic writes:** the canonical write-tmp + rename pattern needs PID-uniquing in the tmp filename to be safe under concurrent processes (CI matrix, operator + Claude session simultaneously). One-character fix; one class of bugs eliminated.

---

## Open operator decisions for Phase 3

- **Two pr-review log files** in `tasks/review-logs/`: `pr-review-log-...T05-58-25Z.md` (smaller, auto-captured fenced block) and `pr-reviewer-log-...T05-59-12Z.md` (curated). Decide whether to delete the auto-captured one. Default recommendation: keep curated, delete auto-captured.
- **`spec-conformance-log-...md` post-commit metadata edit** (one line: `**Commit at finish:** ade9267e`) — agent added this after the auto-commit. Roll into commit 3.

---

## Artefacts produced in Phase 2

- Implementation: `setup/portable/{manifest.json,sync.js,SYNC.md,package.json,tests/,ADAPT.md (Phase 6),README.md,...}`
- Plan: `tasks/builds/framework-standalone-repo/plan.md`
- Review logs: `tasks/review-logs/{spec-conformance,pr-reviewer,adversarial-review}-log-framework-standalone-repo-*.md`
- This handoff: `tasks/builds/framework-standalone-repo/handoff-phase2.md`
