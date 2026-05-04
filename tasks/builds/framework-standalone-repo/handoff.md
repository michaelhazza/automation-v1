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
