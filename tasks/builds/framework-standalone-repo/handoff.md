# Handoff — framework-standalone-repo — Phase 1 → Phase 2

**Build slug:** `framework-standalone-repo`
**Branch (implementation):** `claude/framework-standalone-repo` (create fresh from main)
**Scope class:** Significant
**Spec:** `tasks/builds/framework-standalone-repo/spec.md` — Final
**Spec review:** chatgpt-spec-review APPROVED — 3 rounds, 31 findings, all closed (2026-05-04)
**Review log:** `tasks/review-logs/chatgpt-spec-review-framework-standalone-repo-2026-05-04T00-52-24Z.md`
**Phase 1 captured:** 2026-05-04

---

## What this builds

Lifts the Claude Code framework into its own GitHub repo (`claude-code-framework`) and introduces a git submodule + sync engine distribution model so framework improvements propagate to all consuming repos with a single command.

Core deliverables (Phase A only — see §10 of spec):
- `setup/portable/manifest.json` — file ownership declaration (mode: sync | adopt-only | settings-merge)
- `setup/portable/sync.js` — sync engine (~300 lines TypeScript, no external deps)
- `setup/portable/SYNC.md` — guided upgrade prompt for Claude
- Update `setup/portable/ADAPT.md` — add Phase 6 (record adoption state)
- Synthetic end-to-end tests: adopt + sync + customisation detection + merge flow

Phase B (lift to standalone GitHub repo) and Phase C (Automation OS self-adoption) come after Phase A is proven.

---

## Phase 1 decisions

| Decision | Resolution |
|----------|-----------|
| Framework dev location | Option B — Automation OS is a consumer; framework dev in a separate framework-repo checkout. Never edit generated files in Automation OS directly. |
| Public or private | Private initially; open-source after 2-3 repos stabilised. |
| CLI wrapper | Defer npm wrapper; ship --dry-run, --check, --strict, --doctor flags in v1. |
| Auto-commit | Invariant: sync.js never stages, commits, pushes, or deletes. |
| ADR ownership | Any docs/decisions/ file not in the manifest's explicit inclusion list is project-owned. |
| Branch handling | Option A — ship current spec on claude/evaluate-summonaikit-B89k3; Phase A implementation on a fresh branch. |
| Substitution format | `{{PLACEHOLDER_NAME}}` — double-brace, UPPER_SNAKE_CASE, canonical and non-natural-language. |
| Merge conflict resolution | v1: write `.framework-new` sibling only; no three-way merge file. |
| settings.json hook merge | Flat-merge contract: framework owns `.claude/hooks/*` entries; project wins on collision; framework-first ordering; unit-tested in `sync.test.ts`. |
| --adopt semantics | Non-destructive: file exists → compute hash + write state entry only; file missing → write + state entry. Safe for self-adoption where files are already in place. |

---

## Key spec sections for architect

- **§4.2** — `manifest.json` schema (modes, removedFiles, doNotTouch, glob expansion)
- **§4.4** — `.framework-state.json` schema (per-file lastApplied*, syncIgnore, customisedLocally as informational-only)
- **§4.5** — `sync.js` pseudocode (steps 0-11), flags table, substitution engine invariants
- **§4.6** — `.claude/settings.json` flat-merge contract
- **§5** — Adoption flow (ADAPT.md Phase 6 addition)
- **§6** — Sync flow (SYNC.md)
- **§7** — Customisation handling + .framework-new lifecycle
- **§8** — Migration plan (self-adoption on Automation OS)
- **§10** — Implementation phases (Phase A scope = what to build first)

---

## Branch note

The spec lives on `claude/evaluate-summonaikit-B89k3`. The implementation branch is separate: create `claude/framework-standalone-repo` from `main`. The spec file path is correct for both branches — feature-coordinator should read the spec from the working tree after checking out the implementation branch.

---

## Artefacts produced in Phase 1

- Spec: `tasks/builds/framework-standalone-repo/spec.md`
- Review log: `tasks/review-logs/chatgpt-spec-review-framework-standalone-repo-2026-05-04T00-52-24Z.md`
- This handoff: `tasks/builds/framework-standalone-repo/handoff.md`

---

## Phase 2 (FEATURE COORDINATION) — complete

**Captured:** 2026-05-04
**Full handoff document:** `tasks/builds/framework-standalone-repo/handoff-phase2.md` (sibling file — authoritative artefact, kept full-length to preserve build narrative; this section is the entry-guard marker for `finalisation-coordinator`).

**Branch-level review pass:**

| Reviewer | Verdict |
|---|---|
| spec-conformance | CONFORMANT (54/54 requirements) |
| pr-reviewer | CHANGES_REQUESTED → all blocking + chosen strong fixed in-branch |
| adversarial-reviewer | HOLES_FOUND → 2 confirmed-holes + 2 worth-confirming fixed in-branch |
| dual-reviewer | SKIPPED — Codex CLI unavailable (allowed per CLAUDE.md framework convention) |

**REVIEW_GAP:** Codex CLI unavailable → `dual-reviewer` skipped silently. Phase 3 `chatgpt-pr-review` is the primary second-opinion pass.

**Spec deviations** (both pre-approved at plan-review):
1. `sync.js` is JS-with-JSDoc (~1413 lines), not "TypeScript ~300 lines." Plan §1.1: no build step in framework repo.
2. `lastSubstitutionHash` is an additive optional field on FrameworkState (plan §1.11) to enforce the substitution-drift invariant. Forward-migrates pre-2.2.0 state.json transparently.

**G2 gates (integrated state):** lint 0 errors / typecheck clean / 113 targeted tests pass. Test gates run by CI per policy.

**Tier 2 deferred** to `tasks/todo.md` under two new sections — pr-reviewer S4/S5/N2-N7 + adversarial symlink-follow / shell-metacharacter / `--force` UX / state schema validation.

**Changed-file count:** ~24 files in working tree at handoff (16 modified + 8 untracked) — committed in four-commit grouping per `handoff-phase2.md` lines 139–151. Final branch HEAD recorded after Phase 3 launch.

---

## Phase 3 (FINALISATION) — complete

**PR number:** #257
**chatgpt-pr-review log:** `tasks/review-logs/chatgpt-pr-review-framework-standalone-repo-2026-05-04T07-05-51Z.md`
**spec_deviations reviewed:** yes (both pre-approved at plan-review: `sync.js` JS-with-JSDoc not TS; `lastSubstitutionHash` additive optional state field)

**Doc-sync sweep verdicts (per `docs/doc-sync.md`):**

| Doc | Verdict |
|-----|---------|
| KNOWLEDGE.md | yes (5 entries) |
| architecture.md | n/a — checked sync.js / setup/portable / FRAMEWORK_VERSION / portable_framework_tests / AutomationOS / assertWithinRoot; zero matches; build is internal-framework scope |
| docs/capabilities.md | n/a — no add/remove/rename of capability, skill, integration |
| docs/integration-reference.md | n/a — no integration behaviour change |
| CLAUDE.md / DEVELOPMENT_GUIDELINES.md | yes — `CLAUDE.md` § *Framework version* rewritten to surface canonical-vs-deployment distinction; DEVELOPMENT_GUIDELINES.md checked clean |
| CONTRIBUTING.md | n/a — no lint-suppression / contributor-conventions change |
| docs/frontend-design-principles.md | n/a — no UI patterns introduced |
| docs/spec-context.md | n/a — not a spec-review session |
| docs/decisions/ | no — version-authority pattern documented in KNOWLEDGE.md per `decisions/README.md` "KNOWLEDGE first, ADR if cited later" rule; promote later if recurring |
| docs/context-packs/ | n/a — `architecture.md` section anchors unchanged |
| references/test-gate-policy.md | no — checked `test:portable-framework` against forbidden list; not umbrella, not whole-repo scanner; consistent with "Targeted execution of unit tests authored for THIS change" allowed pattern |
| references/spec-review-directional-signals.md | n/a — not a spec-reviewer session |
| .claude/FRAMEWORK_VERSION + .claude/CHANGELOG.md | yes — portable advanced to 2.2.0 in Phase 2; portable CHANGELOG 2.2.0 entry extended at finalisation to record chatgpt-pr-review hardening additions; root deliberately stays at 2.1.0 (deployment marker) |

13 verdicts / 13 registered docs. 5 yes, 2 no (substantiated), 6 n/a (substantiated). Sweep complete.

**KNOWLEDGE.md entries added:** 5
1. Version authority for parallel framework artefacts (source canonical, deployment marker)
2. chatgpt-pr-review re-flagging applied fix in next round (distinct from existing re-raise / FP-rate entries)
3. TDD on adversarial-reviewer findings (write failing test from trace before fixing)
4. adversarial-reviewer escalates pr-reviewer nits (run adversarial outside auto-trigger surface for filesystem-write-from-external-data diffs)
5. Defence-in-depth path-containment (assert at expand time AND at write time)

**tasks/todo.md items removed:** 0 (build added 4 new deferred sections; no prior items closed by this build)

**ready-to-merge label applied at:** 2026-05-04T09:02:33Z

**Pre-merge condition:** wait for `portable_framework_tests` CI job (gate added in Round 2 commit `7540ed08`) plus the standard CI gates to pass on commit `b2fc8823` (or whatever the post-Phase-3 HEAD becomes). After CI green, merge via the GitHub UI; then set `tasks/current-focus.md` to `MERGED` (or `NONE`).

---

## Phase B + Phase C — complete (2026-05-17)

### Phase B (lift to standalone repo) — complete

- Standalone repo: `https://github.com/michaelhazza/claude-code-framework` (private).
- Default branch: `main` at commit `c69c4e14`.
- Tag: `v2.4.0`.
- Lift performed by `scripts/lift-framework-to-standalone-repo.sh` (git subtree split + push to main + tag).
- Bundle published at framework-repo root: `.claude/`, `docs/`, `references/`, `sync.js`, `manifest.json`, `ADAPT.md`, `SYNC.md`, `MIGRATION-FROM-COPY-PASTE.md`, `README.md`.

### Phase C (Automation OS self-adoption) — complete

**Sub-module mount:** `.claude-framework/` pinned to tag `v2.4.0` (commit `c69c4e14`).

**Preflight diff:** `scripts/framework-preflight-diff.mjs` (one-shot helper, deleted post-Phase-C). Findings — 29 CLEAN / 1 MISSING-DEPLOYED / 2 MISSING-BUNDLE / 19 DIFFERS. All 19 DIFFERS entries classified as bucket-A (intentional Automation-OS-specific overlay on a generic bundle: Vitest-specific test guidance in agent files, project-specific gate references in `references/test-gate-policy.md`, deployment-marker copy in `.claude/CHANGELOG.md`, project ADR index 0006-0024, project-specific hooks via settings-merge). **Zero bucket-B (backport-worthy) findings.** Full report retained at `tasks/builds/framework-standalone-repo/preflight-report.md`.

**Adoption (two-pass + state-repair):**
1. Pass 1 — `node .claude-framework/sync.js --adopt` catalogued 47 deployed files + wrote 1 new (`references/verification-commands.md` adopt-only template).
2. State repair — `scripts/framework-state-repair.mjs` (one-shot, deleted post-Phase-C) populated the substitution map (`PROJECT_NAME=Automation OS`, `PROJECT_DESCRIPTION=an AI agent orchestration platform`, `STACK_DESCRIPTION=React, Express, Drizzle ORM (PostgreSQL), and pg-boss for job scheduling`, `COMPANY_NAME=Synthetos`), aligned `lastAppliedHash` to the substituted-bundle hash, and realigned the 16 customised files (`customisedLocally: true`) so future framework upgrades write `.framework-new` siblings instead of overwriting customisations.

**Removed from working tree:**
- `setup/portable/` (~150 files — bundle now in submodule)
- `scripts/build-portable-framework.ts` (zip-build no longer used; framework repo is the artifact)
- `scripts/lift-framework-to-standalone-repo.sh` (lift complete; one-shot)
- `scripts/framework-preflight-diff.mjs` + `scripts/framework-state-repair.mjs` (one-shot helpers)
- `.github/workflows/ci.yml` — `portable_framework_tests` job (bundle CI runs in the framework repo)
- `package.json` — `test:portable-framework` npm script
- `eslint.config.js` — `setup/portable/**` ignore (swapped for `.claude-framework/**`)
- `scripts/verify-test-quality.sh` — `setup/portable/` exclusion swapped for `.claude-framework/` exclusion

**Updated:**
- `CLAUDE.md § Framework version` — points at `.claude-framework/` + `.claude/.framework-state.json`.
- `.claude/CHANGELOG.md § Version authority` — names the submodule as canonical; deployment marker semantics retained.

**Adoption state:** `.claude/.framework-state.json` (frameworkVersion `2.4.0`, adoptedFromCommit `c69c4e14`, substitutions populated, 16 files flagged `customisedLocally: true`).

**Validation:** `sync.js --check` exit 0 (`framework is up to date (v2.4.0)`). `npm run lint` 0 errors / 886 pre-existing warnings. `npm run typecheck` clean. `npm run build:server` clean. `validate-setup` agent — 0 critical, 0 Phase-C-introduced findings; 3 pre-existing drift items (ADR-0010 unindexed, `arch-guard.sh` unregistered, historical CHANGELOG prose — all predate this branch).

**Known sync.js UX limitation:** `--doctor` flags the 16 intentionally-customised files as `case (b) — merged-without-resync`. This is correct for the unintended-merge case but is a false positive for files customised by design. `--check` correctly returns clean. Tracked for the framework repo's backlog (no impact on Phase C completion).

**Phase D (first NEW target repo onboards) — pending.** See spec §10. The submodule pattern is now ready to consume in a real target repo.

---

## Phase 3 (FINALISATION) — Phase B + Phase C cycle — complete

**PR number:** #342
**chatgpt-pr-review log:** `tasks/review-logs/chatgpt-pr-review-framework-standalone-repo-2026-05-17T07-31-15Z.md`
**spec_deviations reviewed:** n/a — no new deviations for Phase B + Phase C; the two deviations recorded for Phase A (sync.js JS-with-JSDoc; lastSubstitutionHash additive field) shipped via PR #257 already.

**S2 branch sync:** branch was 68 commits behind `origin/main` (red-threshold drift); operator authorised `force`. Merge produced 2 conflicts; `tasks/current-focus.md` auto-resolved (ours per known-shape table); `.github/workflows/ci.yml` operator-resolved (took ours). Merge committed as `5b0f531f`. **Note:** the `--ours` resolution introduced a regression to `ci.yml` that chatgpt-pr-review Round 2 caught and fixed (see below).

**G4 regression guard:** PASS (lint 0 errors / typecheck clean).

**chatgpt-pr-review summary (2 rounds, APPROVED_AFTER_FIXES):**
- Round 1 — 5 findings (F1–F4 + T1), all rejected as false positives. ChatGPT misread `setup/portable/<path>` deletions as deletions of the active `<path>`. Active files verified via `ls` pre-triage.
- Round 2 — F5 Blocking: CI integration_tests regression from the Step 2 `--ours` ci.yml resolution. **Accepted + fixed** in commit `5871ffcc`: re-checked out main's ci.yml, surgically removed only the `Portable framework tests` step from `lint_and_typecheck`. All other main improvements restored (DATABASE_URL_TEST + synthetos_app non-superuser RLS test path; Session K consolidation; B.1–B.6 + E.6 grep gates; Spec B sandbox gates; Operator Backend gates).
- G3 re-verified PASS after F5 fix.

**Doc-sync sweep verdicts (per `docs/doc-sync.md`):**

| Doc | Verdict |
|-----|---------|
| `architecture.md` | n/a — grepped clean for setup/portable / portable_framework_tests / sync.js / .claude-framework / claude-code-framework |
| `docs/capabilities.md` | n/a: internal refactor with no capability surface change |
| `docs/integration-reference.md` | n/a — no integration behaviour change |
| `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` | yes (CLAUDE.md § Framework version) — updated in Phase C |
| `CONTRIBUTING.md` | n/a |
| `docs/frontend-design-principles.md` | n/a — no UI patterns introduced |
| `KNOWLEDGE.md` | yes (3 entries — see below) |
| `docs/spec-context.md` | n/a — not a spec-review session |
| `docs/decisions/` | no — submodule distribution model already decided in Phase A spec (PR #257); version-authority pattern lives in KNOWLEDGE.md per "KNOWLEDGE first, ADR if cited later" rule |
| `docs/context-packs/` | n/a — architecture.md section anchors unchanged |
| `references/test-gate-policy.md` | n/a — no umbrella command / local check / posture change |
| `references/spec-review-directional-signals.md` | n/a — not a spec-reviewer session |
| `docs/incident-response.md` | n/a |
| `docs/testing-transition-plan.md` | n/a |
| `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` | yes (CHANGELOG § Version authority) — updated in Phase C |
| `scripts/verify-*` (15 gates) | n/a — no gate added/removed/renamed; `scripts/verify-test-quality.sh` exclusion-path swap preserves gate posture exactly |

16 verdicts / 16 registered docs. 2 yes, 1 no (substantiated), 13 n/a (substantiated). Sweep complete.

**KNOWLEDGE.md entries added:** 3
1. `git checkout --ours` on a code-area conflict file rolls back ALL auto-merged improvements, not just the conflicted hunk.
2. ChatGPT diff path-prefix misreading when an in-repo bundle is lifted to an external source.
3. chatgpt-pr-review R2 with fresh context can surface real findings R1 missed entirely.

**Compound Learning Feedback proposals:** 3 rows emitted to `tasks/builds/framework-standalone-repo/progress.md § Compound Learning Feedback`. All `pending` — operator-decided post-merge. No `MERGE_READY` block.

**tasks/todo.md items removed:** 0 (build adds no new deferred items; the Phase A finalisation's 4 deferred sections remain open).

**ready-to-merge label applied at:** 2026-05-17T07:45:26Z

