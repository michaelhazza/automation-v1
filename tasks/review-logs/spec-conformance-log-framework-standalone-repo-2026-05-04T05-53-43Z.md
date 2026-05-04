# Spec Conformance Log

**Spec:** `tasks/builds/framework-standalone-repo/spec.md`
**Spec commit at check:** `d45af711abcfef56cc2f16a2725f367d9b1fdcda` (last commit touching the spec)
**Branch:** `claude/framework-standalone-repo`
**Base:** `75bfc6546537be388b3866db5172f3e6ec1064fa` (merge-base with main)
**Scope:** Phase A only — in-tree sync infrastructure under `setup/portable/`. Phases B and C out of scope per the build's plan.
**Plan:** `tasks/builds/framework-standalone-repo/plan.md`
**Run at:** 2026-05-04T05-53-43Z

> **Note on prior log.** A prior spec-conformance run for this build was logged at `tasks/review-logs/spec-conformance-log-framework-standalone-repo-2026-05-04T05-47-00Z.md` (commit `ade9267e`) by an earlier session, marking the branch CONFORMANT (54/54). This run is the one requested by the operator just now. It re-verifies independently and reaches a different verdict: NON_CONFORMANT (29/31, two directional gaps). The delta between the two runs is documented in §7 below.

---

## Contents

1. Summary
2. Files modified by this run
3. Requirements extracted (full checklist)
4. Mechanical fixes applied
5. Directional / ambiguous gaps (routed to tasks/todo.md)
6. Next step
7. Reconciliation with prior run (commit `ade9267e`)

---

## 1. Summary

- Requirements extracted:     31
- PASS:                       29
- MECHANICAL_GAP → fixed:      0
- DIRECTIONAL_GAP → deferred:  2
- AMBIGUOUS → deferred:        0
- OUT_OF_SCOPE → skipped:      0

**Verdict:** NON_CONFORMANT (2 directional gaps — see §5)

> Both gaps are minor. One is an undefined-algorithm spec item that needs a human design call (rename-detection heuristic in §4.5 step 8). The other is an artefact of test inputs intentionally containing legacy-format strings, which the build-portable preflight scan does not exempt — fix requires choosing an exemption strategy the spec does not prescribe.

**Changed-code set scope.** Verification was scoped to: new + modified files under `setup/portable/`, plus `scripts/build-portable-framework.ts`, plus the spec / plan / handoff artefacts under `tasks/builds/framework-standalone-repo/`. The branch contains an earlier merge from the agentic-commerce build; those files are not part of Phase A and are not in scope.

---

## 2. Files modified by this run

None. No mechanical fixes applied — both gaps are DIRECTIONAL.

---

## 3. Requirements extracted (full checklist)

| # | Spec § | Requirement | Verdict |
|---|--------|-------------|---------|
| 1 | §4.2 | `manifest.json` schema with `frameworkVersion`, `managedFiles`, `removedFiles`, `doNotTouch` and the 19 entries spec lists | PASS |
| 2 | §4.5 step 0 | Startup `.framework-new` scan; exit 1 with structured error + first-10 truncation when N>10 | PASS |
| 3 | §4.5 step 1 | state.json missing → exit 1 with named error pointing at `--adopt`/`--doctor` | PASS |
| 4 | §4.5 steps 2-3 | Read `manifest.json`, expand globs in lexicographic order (deterministic, cross-platform) | PASS |
| 5 | §4.5 steps 4-5 | Read framework version; if `state.frameworkVersion === current`, print "already on latest" + exit 0 | PASS |
| 6 | §4.5 step 6 | Submodule cleanliness check; uncommitted → error; detached HEAD allowed with warning | PASS |
| 7 | §4.5 steps 7a-7c | syncIgnore skip / adopt-only skip / settings-merge dispatch | PASS |
| 8 | §4.5 step 7d | New-file branches: target-missing → write fresh; target-exists-no-state → write `.framework-new` | PASS |
| 9 | §4.5 steps 7e-7h | Read target → normalise → hash compare → classify clean/customised → write or `.framework-new` | PASS |
| 10 | §4.5 step 7b2 | Mode-change check: if recorded mode differs and new mode is `adopt-only` → mark `adoptedOwnership = true`, emit `ownership-transferred` | PASS |
| 11 | §4.5 step 8 | `removedFiles` reporting (warn-only, never auto-delete) + rename-detection INFO log | DIRECTIONAL_GAP |
| 12 | §4.5 step 9 | CHANGELOG excerpt printing between old → new version with parse-failure WARN fallback | PASS |
| 13 | §4.5 step 10 | Atomic state write via `.tmp` + rename | PASS |
| 14 | §4.5 step 11 | End-of-run report: N updated, M new, P customised, K removal warnings (+ `time=Xs` per plan) | PASS |
| 15 | §4.5 substitution invariants 1-4 | `{{PLACEHOLDER}}` format, scoped to `substituteAt !== "never"`, idempotency pre-condition enforced, `.framework-new` substituted same as clean writes | PASS |
| 16 | §4.6 + plan rule 7 | Settings.json flat-merge: framework-owned identity by command first-token referencing `.claude/hooks/`, replace-in-place, project preserved, project-wins on collision, framework-first ordering, top-level keys preserved, non-removing | PASS |
| 17 | §4.5 flag `--adopt` | First-run mode AND substitution-rebaseline mode; mode-disambiguation INFO header | PASS |
| 18 | §4.5 flag `--dry-run` | Classify pass with no writes; every per-file log line has `dry_run=true` | PASS |
| 19 | §4.5 flag `--check` | Exit 0 if up-to-date; exit 1 if updates pending; customised does NOT cause exit 1 | PASS |
| 20 | §4.5 flag `--strict` | As `--check` plus exit 1 if any file is customised | PASS |
| 21 | §4.5 flag `--doctor` | No writes; detect orphaned state entries, missing target files, case (a) and case (b) of customisation, substitution drift | PASS |
| 22 | §4.5 flag `--force` | Skip startup `.framework-new` scan AND skip substitution-drift check | PASS |
| 23 | §4.5 INVARIANT | sync.js never stages, commits, pushes, or deletes files | PASS |
| 24 | §6 | `SYNC.md` operator-prompt + 7 phases (prereqs / diff versions / changelog / dry-run / sync / merges / verify / commit) | PASS |
| 25 | §5 Phase 6 | ADAPT.md gains Phase 6 (record adoption state) | PASS |
| 26 | §10 Phase A | Synthetic e2e tests: adopt + sync + customisation + merge | PASS |
| 27 | §10 Phase A | `.claude/FRAMEWORK_VERSION` bumped to 2.2.0 | PASS |
| 28 | §10 Phase A | `.claude/CHANGELOG.md` 2.2.0 entry with Highlights/Breaking/Added/Changed/Fixed | PASS |
| 29 | §10 Phase A | `setup/portable/README.md` describes the submodule + sync model | PASS |
| 30 | §4.5 invariant 1 | Placeholder format migration `[X]` → `{{X}}` across 14 source files in `setup/portable/` | PASS |
| 31 | plan §1.11 | `lastSubstitutionHash` drift detection and forward-migration | PASS |

### Evidence pointers (PASSes; one line each, by REQ #)

- **REQ #1** — `setup/portable/manifest.json:1-32`; entries match spec §4.2 1:1.
- **REQ #2** — `setup/portable/sync.js:1080-1090`; truncation at `:1084-1087`.
- **REQ #3** — `sync.js:1063-1066`.
- **REQ #4** — `sync.js:1069` (loadManifest); `sync.js:135` (`Array.from(...).sort()` for lexicographic order); `sync.js:435-448` (expandManagedFiles dedupes in manifest order).
- **REQ #5** — `sync.js:1072` (read), `sync.js:1075-1078` (compare + exit 0).
- **REQ #6** — `sync.js:1053-1059` (caller); `sync.js:339-350` (helper allows non-git as clean for synthetic-test mode).
- **REQ #7** — `sync.js:464-486` (classifyFile branches), `sync.js:1240-1252` (walk dispatch), `sync.js:916-975` (mergeSettings).
- **REQ #8** — `sync.js:673-751` (writeNewFile); status `new` for missing target (`:704`); status `customised extra={reason=untracked-pre-existing}` for tracked-existing (`:747`).
- **REQ #9** — `sync.js:495-515` (classifyFile clean/customised), `sync.js:592-624` (writeUpdated), `sync.js:626-671` (writeFrameworkNew); normalisation funnelled through `hashContent(normaliseContent(raw))` consistently.
- **REQ #10** — `sync.js:469-473` (classifyFile detects mode change), `sync.js:1243-1248` (walk dispatch sets `adoptedOwnership`).
- **REQ #12** — `sync.js:1300-1312` (read + extract + print + warn-on-failure), `sync.js:1027-1041` (extractChangelogExcerpt).
- **REQ #13** — `sync.js:1315-1322` (caller), `sync.js:275-283` (writeStateAtomic helper writes `.tmp` then `fs.rename`).
- **REQ #14** — `sync.js:1324-1331`; format matches spec, plus the plan's `time=Xs` enrichment.
- **REQ #15** — Format: `sync.js:579-586` (applySubstitutions only matches `{{KEY}}`); scoping: `:599-601`, `:631-633`, `:678-680`; idempotency check: `:526-539`; `.framework-new` substitution: `:631-634`.
- **REQ #16** — `sync.js:764-771` (isFrameworkOwnedCommand handles bare path AND interpreter+path forms — `node ${CLAUDE_PROJECT_DIR}/.claude/hooks/x.js`); `sync.js:806-909` (mergeSettingsHooksBlock implements rules 2-5); `sync.js:952` (top-level keys preserved via spread); `sync.js:885-901` (rule 7: warns on orphaned framework hooks, never deletes).
- **REQ #17** — `sync.js:1215-1231` (mode header), `sync.js:988-1013` (classifyForAdopt), `sync.js:707-725` (writeNewFile catalogues existing target without overwriting in adopt mode).
- **REQ #18** — `sync.js:622, 664, 703, 724, 747, 973` (each writer emits `dry_run=true` extra when `flags.dryRun`); state.json write guarded by `if (!flags.dryRun)` at `:1315`.
- **REQ #19** — `sync.js:1112-1149`.
- **REQ #20** — `sync.js:1135, 1139-1142`.
- **REQ #21** — `sync.js:1151-1198`; covers all five anomaly classes.
- **REQ #22** — `sync.js:1081` (skip merge scan), `sync.js:552` (drift check returns clean when force).
- **REQ #23** — grep on sync.js confirms no `git add/commit/push/reset/checkout` — only read-only `git rev-parse HEAD` and `git status --porcelain`. No `fs.unlink/rm/rmdir` of operator content.
- **REQ #24** — `setup/portable/SYNC.md:1-171`; all 7 phases present + Phase 4a (substitution rebaseline) + Troubleshooting block.
- **REQ #25** — `setup/portable/ADAPT.md:163-272` (Phase 6 with `--adopt`, verify via `--doctor`, commit step, framework-dev-location rule); Contents block at top updated to include Phase 6 (line 17).
- **REQ #26** — `setup/portable/tests/e2e-adopt.test.ts` (3 passing), `e2e-sync.test.ts` (3 passing — includes CRLF cross-platform check), `e2e-merge.test.ts` (3 passing — covers customisation detection + .framework-new + manual merge + `--doctor` case (b)). Bonus: `e2e-adopt-invariants.test.ts`. All confirmed locally via `npx tsx`.
- **REQ #27** — `setup/portable/.claude/FRAMEWORK_VERSION` reads `2.2.0`.
- **REQ #28** — `setup/portable/.claude/CHANGELOG.md:35-55`.
- **REQ #29** — `setup/portable/README.md:51-53` (What ships lists manifest/sync.js/SYNC.md), `:73-77` (Upgrading section), `:26-28` (placeholder format note).
- **REQ #30** — grep confirms zero `[PROJECT_NAME]`-style hits in `.claude/agents/`, `docs/`, `references/`; 40 `{{...}}` hits across the bundle. Remaining `[X]` occurrences in CHANGELOG.md / README.md / `tests/*.test.ts` are intentional (CHANGELOG and README documenting the migration; test files using legacy format as deliberate negative inputs the substitution engine must leave alone).
- **REQ #31** — `sync.js:148-152` (hashSubstitutions: keys-sorted JSON.stringify), `sync.js:551-566` (checkSubstitutionDrift returns clean when hash absent — forward migration; throws on mismatch unless `--adopt`/`--force`), `sync.js:1316-1321` (state write persists new hash).

---

## 4. Mechanical fixes applied

None. No requirement met the strict MECHANICAL_GAP bar (spec explicitly names the missing item AND the fix is a direct addition AND no design choice involved).

---

## 5. Directional / ambiguous gaps (routed to tasks/todo.md)

### REQ #11 — §4.5 step 8 rename-detection INFO log not implemented

The spec text in §4.5 step 8 says:

> Check: if a removed path and a newly-written path share the same directory + similar filename: Print: "INFO: possible rename detected — old: <removed-path>, new: <new-path>"

The implementation in `setup/portable/sync.js:1278-1289` handles `removedFiles` (warn-only, conforms) but does NOT implement the rename-detection check.

**Why DIRECTIONAL, not MECHANICAL:** the spec does not define the "similar filename" algorithm — Levenshtein? prefix match? token-set similarity? Any choice locks in semantics the spec did not pin down. A wrong default (e.g. flagging unrelated renames in a busy directory) would either generate noise or miss real renames.

**Suggested approach:** before fixing, decide which rename-detection heuristic to use (suggest: same directory + filename Levenshtein distance ≤ 3, OR a shared filename stem). Then add a check in the removed-files loop. Alternatively, defer to Phase B and amend the spec to remove the requirement (Phase A is in-tree-only; rename-detection has low ROI when no live customer is on the framework yet).

### REQ-extra (plan Chunk 1 verification) — `scripts/build-portable-framework.ts` preflight scan fails on intentional test-input legacy placeholders

Plan Chunk 1's verification command (`npx tsx scripts/build-portable-framework.ts # expect: exit 0`) currently exits 1:

```
PREFLIGHT FAILED:
  - leftover legacy-format placeholder in tests\substitute-write.test.ts: found "[PROJECT_NAME]" — migrate to "{{PROJECT_NAME}}"
```

The hits are in `setup/portable/tests/substitute-write.test.ts` lines that test the substitution engine ignores non-`{{...}}` formats:

```ts
const content = '{{PROJECT_NAME}} and [PROJECT_NAME] and <PROJECT_NAME>\n';
assert.equal(result, 'Acme and [PROJECT_NAME] and <PROJECT_NAME>\n');
```

These are intentional negative-test fixtures. The fix is to teach `scripts/build-portable-framework.ts:114-122` to exempt either `tests/**` wholesale or specifically files matching `**/*.test.{ts,js}`.

**Why DIRECTIONAL, not MECHANICAL:** the spec doesn't say which exemption pattern to use. Three reasonable choices:

1. Exempt `tests/**` entirely (simplest; matches existing CHANGELOG/README exemption pattern).
2. Add a content-level escape mechanism (e.g. a `// build-preflight-skip` comment recognised by the scanner).
3. Move the test fixture into a non-`.ts` file (e.g. read the literal from a fixture text file).

Each has different blast-radius implications for future work and is a design choice the spec/plan does not prescribe.

**Suggested approach:** add `tests/` to a path-prefix exclusion list in the legacy-placeholder walk (mirrors the existing filename-set exemption for `CHANGELOG.md` / `README.md`). One-line addition. Path-prefix exclusion is consistent with how the build script currently structures exemptions and avoids inventing escape syntax.

---

## 6. Next step

**NON_CONFORMANT** — 2 directional gaps must be addressed before merge. See `tasks/todo.md` under "Deferred from spec-conformance review — framework-standalone-repo (2026-05-04)".

The Phase A delivery is otherwise tight: 29/31 PASSes including all spec.§4.5 steps + flags, the full §4.6 settings-merge contract (with the plan's added "non-removing" rule 7), `SYNC.md` 7 phases, `ADAPT.md` Phase 6, version bump, CHANGELOG, README, placeholder migration, and 9 test files (37 helper unit tests + 11 e2e tests confirmed passing locally via `npx tsx`).

Both gaps are minor. Neither blocks the lift-to-standalone-repo move (Phase B). They can be:
- **Fixed before merge** — 5–10 minutes of work each, documented above.
- **Deferred to Phase B** — if the operator concurs the rename-detection ROI is low pre-public-launch and the build-portable script is being retired anyway when `setup/portable/` lifts out of this repo.

After mechanical/directional fixes, run `pr-reviewer` on the changed-code set.

---

## 7. Reconciliation with prior run (commit `ade9267e`)

A prior spec-conformance run by an earlier session, logged at `tasks/review-logs/spec-conformance-log-framework-standalone-repo-2026-05-04T05-47-00Z.md`, produced verdict **CONFORMANT** (54/54 PASS). This run produces verdict **NON_CONFORMANT** (29/31).

The two runs do not contradict on substance — they diverge on what counted as a checked requirement.

| Concern | Prior run (54 reqs, CONFORMANT) | This run (31 reqs, NON_CONFORMANT) |
|---|---|---|
| Rename-detection in §4.5 step 8 | Not enumerated as its own requirement | Enumerated; flagged as DIRECTIONAL_GAP |
| `scripts/build-portable-framework.ts` preflight passing | Logged as PASS based on inspection of the script's exemption list (CHANGELOG.md, README.md), not on actually executing the script | Confirmed by execution: preflight exits 1 because `tests/substitute-write.test.ts` contains intentional legacy-format negative-test inputs that are not exempted |

The prior log was authored before the test files contained those fixtures, OR the prior run did not execute the script. Either way, this run's evidence (live execution showing exit code 1 with the named offending file) is what drives the gap classification here.

The prior run's CONFORMANT verdict on the other 29 requirements is corroborated by this run's independent re-verification.

