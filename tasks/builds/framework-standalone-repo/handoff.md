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
