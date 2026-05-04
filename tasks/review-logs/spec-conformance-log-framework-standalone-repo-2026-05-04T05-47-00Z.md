# Spec Conformance Log

**Spec:** `tasks/builds/framework-standalone-repo/spec.md`
**Spec commit at check:** `d45af711abcfef56cc2f16a2725f367d9b1fdcda` (working-tree spec.md modifications also in changed-code set)
**Branch:** `claude/framework-standalone-repo`
**Base:** `75bfc6546537be388b3866db5172f3e6ec1064fa`
**Scope:** Phase A only — spec §4 (technical components), §5 (ADAPT.md Phase 6), §6 (SYNC.md), §7 (customisation), §10 (Phase A deliverables). Phases B and C out of scope per handoff + plan.
**Changed-code set:** 20 files + new `setup/portable/tests/` directory. Excludes the spec itself (it is the verification target).
**Run at:** 2026-05-04T05:47:00Z
**Commit at finish:** `ade9267e`

---

## Summary

- Requirements extracted:     54
- PASS:                       54
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 0
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** CONFORMANT — Phase A is a complete, faithful implementation of spec §4–§10's Phase A scope.

---

## Contents

A. Manifest (spec §4.2)
B. FrameworkState shape (spec §4.4)
C. sync.js engine — pseudocode steps (spec §4.5)
D. sync.js flags (spec §4.5 flags table)
E. Substitution invariants (spec §4.5)
F. Settings.json flat-merge (spec §4.6)
G. ADAPT.md Phase 6 (spec §5)
H. SYNC.md (spec §6)
I. Customisation handling (spec §7)
J. Phase A implementation deliverables (spec §10 Phase A)
X. Cross-cutting checks
Mechanical fixes applied
Directional / ambiguous gaps
Files modified by this run
Notes on intentional spec-vs-implementation deltas
Test execution summary
Next step

---

## A. Manifest (spec §4.2)

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| A1 | `setup/portable/manifest.json` exists | PASS | `setup/portable/manifest.json` (untracked, 32 lines) |
| A2 | Top-level `frameworkVersion` (semver) = `"2.2.0"` | PASS | `manifest.json:2` |
| A3 | Top-level `managedFiles` array | PASS | `manifest.json:3-23` |
| A4 | Top-level `removedFiles` array (empty for v2.2.0) | PASS | `manifest.json:24` |
| A5 | Top-level `doNotTouch` array (CLAUDE.md, KNOWLEDGE.md, architecture.md, DEVELOPMENT_GUIDELINES.md, tasks/**) | PASS | `manifest.json:25-31` |
| A6 | All spec-named managed entries present (10 sync + 4 adopt-only categories; plan §6.1 expanded to 19 distinct globs covering FRAMEWORK_VERSION + CHANGELOG.md too — additive superset) | PASS | All 19 entries present |
| A7 | Mode field uses closed enum `"sync" \| "adopt-only" \| "settings-merge"` | PASS | All entries match enum |
| A8 | substituteAt uses closed enum `"never" \| "adoption"` | PASS | All entries match enum |
| A9 | `.claude/settings.json` entry has `mode: "settings-merge"` | PASS | `manifest.json:6` |
| A10 | Adopt-only entries are exactly the four spec-named templates | PASS | `manifest.json:19-22` |

## B. FrameworkState shape (spec §4.4)

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| B1 | Top-level fields: `frameworkVersion`, `adoptedAt`, `adoptedFromCommit`, `profile`, `substitutions`, `files`, `syncIgnore` | PASS | `sync.js:23` JSDoc typedef + e2e-adopt asserts shape |
| B2 | Per-file entry has `lastAppliedHash`, `lastAppliedFrameworkVersion`, `lastAppliedFrameworkCommit`, `lastAppliedSourcePath`, `customisedLocally` | PASS | `sync.js:22` JSDoc + writeNewFile/writeUpdated populate all 5 |
| B3 | `customisedLocally` informational only (set by sync; not an operator control) | PASS | sync.js sets in writeFrameworkNew/writeNewFile; never read as a skip signal |
| B4 | `syncIgnore` is the sole opt-out mechanism | PASS | `sync.js:465-467` — only skip-via-list path |
| B5 | `lastSubstitutionHash` optional field (plan §1.11 amendment) | PASS | `sync.js:23` typedef; written at sync.js:1319 |

## C. sync.js engine — pseudocode steps (spec §4.5)

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| C0 | Step 0 — startup `.framework-new` scan; if any exist and not `--force`, exit 1 with structured error showing first 10 paths | PASS | `sync.js:1080-1090` ERROR + count + first 10 + truncate-remainder |
| C1 | Step 1 — state.json missing/unreadable AND not `--adopt` → exit 1 with explanatory error | PASS | `sync.js:1062-1066` |
| C2 | Step 2 — read manifest.json | PASS | `sync.js:1069` |
| C3 | Step 3 — expand globs lexicographically | PASS | `sync.js:135` (`Array.from(results).sort()`); expandManagedFiles deduplicates first-match |
| C4 | Step 4 — read FRAMEWORK_VERSION (new version) | PASS | `sync.js:1072` |
| C5 | Step 5 — state.frameworkVersion === new version → "already on latest" + exit 0 | PASS | `sync.js:1075-1078` |
| C6 | Step 6 — submodule clean check; uncommitted = exit 1; detached HEAD allowed | PASS | `sync.js:1053-1059` + `checkSubmoduleClean` (sync.js:339) |
| C7a | Step 7a — syncIgnore skip | PASS | `sync.js:465-467`, classified `skipped/syncIgnore` |
| C7b | Step 7b — adopt-only skip when state entry exists | PASS | `sync.js:476-481` |
| C7b2 | Step 7b2 — mode change check: sync→adopt-only triggers `ownership-transferred` | PASS | `sync.js:471-473` |
| C7c | Step 7c — settings-merge dispatch | PASS | `sync.js:484-486` → `mergeSettings` |
| C7d | Step 7d — new-file branches: target missing → write fresh + state entry; target exists no state → write `.framework-new` + customisedLocally=true | PASS | `sync.js:686-704` (missing); `sync.js:705-750` (exists) |
| C7e | Step 7e — read target, normalise (BOM, LF, trailing-whitespace, blank lines collapsed) | PASS | `sync.js:40-50` `normaliseContent` covers all four rules |
| C7f | Step 7f — sha256 compare to lastAppliedHash | PASS | `sync.js:504-506` |
| C7g | Step 7g — clean + already-on-version → skip; clean + version differs → write substituted, update state | PASS | `sync.js:506-511` (classify), `sync.js:593-624` (writeUpdated) |
| C7h | Step 7h — customised → write `.framework-new`, set customisedLocally=true, do NOT overwrite target | PASS | `sync.js:627-671` writeFrameworkNew |
| C7h-prior | Step 7h enrichment — overwriting prior `.framework-new` emits `prior_framework_new=replaced` | PASS | `sync.js:641-642` |
| C8 | Step 8 — removedFiles loop emits warn-only entries; never auto-deletes | PASS | `sync.js:1278-1289` |
| C9 | Step 9 — read CHANGELOG between old and new versions; on parse failure, warn + continue | PASS | `sync.js:1300-1312` extractChangelogExcerpt + try/catch |
| C10 | Step 10 — atomic state write via `.tmp` + rename | PASS | `sync.js:275-283` writeStateAtomic; called at sync.js:1321 |
| C11 | Step 11 — final report: N updated, M new, P customised, K removal warnings | PASS | `sync.js:1329-1331` (also `time=Xs` per plan §7) |
| C-INV-1 | INVARIANT: sync.js never stages, commits, pushes, or deletes files | PASS | grep-verified — no `git add/commit/push`; no `unlink/rmdir/rm` of target files |
| C-INV-2 | INVARIANT: structured per-file log line `SYNC file=<path> status=<status>` | PASS | `sync.js:390-396` `logFileOp` |

## D. sync.js flags (spec §4.5 flags table)

| # | Flag | Verdict | Evidence |
|---|---|---|---|
| D1 | `--adopt` (first-run + rebaseline; non-destructive when target exists) | PASS | `sync.js:1215-1231` (mode header), `classifyForAdopt` (988-1013), e2e-adopt-invariants test |
| D2 | `--dry-run` (no writes; classify only; emits `dry_run=true` on each affected line) | PASS | flags test asserts; sync.js sets `dry_run=true` at lines 622, 664, 703, 724, 747, 973 |
| D3 | `--check` (exit 0 if up-to-date; exit 1 if updates pending; customised does NOT cause exit 1) | PASS | `sync.js:1112-1149`; flags test asserts |
| D4 | `--strict` (as `--check` plus exit 1 on customisations) | PASS | `sync.js:1139-1142`; flags test asserts |
| D5 | `--doctor` (no writes; reports orphans, missing files, case (a) merge-in-flight, case (b) merged-without-resync, substitution drift) | PASS | `sync.js:1151-1198` covers all five cases |
| D6 | `--force` (skip startup `.framework-new` check + skip drift check) | PASS | `sync.js:1081, 552` |

## E. Substitution invariants (spec §4.5)

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| E1 | Placeholder format `{{NAME}}` only; other formats left alone | PASS | `sync.js:583` `result.split('{{${key}}}').join(value)` only matches double-brace; substitute-write test verifies `[X]`, `<X>`, `%X%` are untouched |
| E2 | Scoping: substitution runs only when `substituteAt !== "never"` | PASS | sync.js:599, 631, 678 — guard before applySubstitutions |
| E3 | Idempotency: no value contains `{{`; validated at sync start, exits with named-key error on failure | PASS | `validateSubstitutions` (sync.js:526-539) |
| E4 | Substitution applied to `.framework-new` writes (post-substitution view) | PASS | `sync.js:631-633` writeFrameworkNew applies same logic |
| E5 | Empty substitution map → non-blocking warning, sync continues | PASS | `sync.js:534-538` |

## F. Settings.json flat-merge (spec §4.6)

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| F1 | Rule 1: framework owns entries whose command's first token resolves under `.claude/hooks/` | PASS | `isFrameworkOwnedCommand` (sync.js:764-771) + `frameworkHookIdentity` (784-791); both check `${CLAUDE_PROJECT_DIR}/.claude/hooks/` and bare `.claude/hooks/`; both also handle interpreter prefix (`node`, `sh`, `bash`) |
| F2 | Rule 2: replace-in-place by command identity; framework entry kept once | PASS | `mergeSettingsHooksBlock` builds projFwIdentitySet then filters; settings-merge test passes |
| F3 | Rule 3: project hooks coexist | PASS | `sync.js:861-864` includes projOwnedHooks |
| F4 | Rule 4: collision → project wins | PASS | `sync.js:836-837` skips framework entry when identity matches projFwIdentitySet |
| F5 | Rule 5: framework entries first (declared order), then project entries | PASS | `sync.js:866-867` `[...mergedHooks, ...projOwnedHooks]` |
| F6 | Rule 6: top-level keys preserved (permissions, env, etc.) | PASS | `sync.js:952` `{ ...projectSettings, hooks: mergedHooks }` |
| F7 | Rule 7 (plan §6 addition): non-removing — orphaned framework hooks stay as project-owned + WARN line + counts in removal-warning tally | PASS | `sync.js:885-901`; settings-merge test "Rule 7" passes |
| F8 | Hash tracking: state entry `lastAppliedHash` = hash of merged file output | PASS | `sync.js:954-956, 962-964` |

## G. ADAPT.md Phase 6 (spec §5)

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| G1 | New Phase 6 appended to ADAPT.md | PASS | `ADAPT.md:163` `## 11. Phase 6 — Record adoption state` |
| G2 | Phase 6 in Contents/TOC | PASS | `ADAPT.md:17` |
| G3 | Phase 6 instructs running `node .claude-framework/sync.js --adopt` | PASS | `ADAPT.md:225` |
| G4 | Phase 6 ends with framework-dev-location rule (don't edit generated files in target; edit framework repo, sync back) | PASS | `ADAPT.md:257-272` "Important: framework dev location" |
| G5 | Verification: `--doctor` runs and confirms clean | PASS | `ADAPT.md:237-241` |
| G6 | Substitutions migrated to `{{...}}` format in Phase 2 substitution table + § 3 operator-inputs table | PASS | `ADAPT.md:50-55` + 100-104 |

## H. SYNC.md (spec §6)

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| H1 | `setup/portable/SYNC.md` exists | PASS | Untracked file, 172 lines |
| H2 | Header includes operator-paste prompt | PASS | `SYNC.md:5-11` |
| H3 | Phase 0 — confirm prerequisites (state.json, submodule reachable, clean tree) | PASS | `SYNC.md:15-23` |
| H4 | Phase 1 — diff versions (equal/lower/higher branches) | PASS | `SYNC.md:27-34` |
| H5 | Phase 2 — read changelog (Highlights/Breaking/Added/Changed) | PASS | `SYNC.md:37-49` |
| H6 | Phase 3 — dry-run sync | PASS | `SYNC.md:53-60` |
| H7 | Phase 4 — run sync | PASS | `SYNC.md:64-72` |
| H8 | Phase 4a — substitution-drift rebaseline branch (per plan §1.11 + §6 enrichment) | PASS | `SYNC.md:87-97` |
| H9 | Phase 5 — walk pending merges (read both, suggest, apply, delete `.framework-new`, re-run sync) | PASS | `SYNC.md:101-120` |
| H10 | Phase 6 — verify with `--doctor` | PASS | `SYNC.md:124-141` |
| H11 | Phase 7 — commit (operator manual; sync never auto-commits) | PASS | `SYNC.md:145-157` |
| H12 | Cross-references match actual file paths (`.claude-framework/.claude/FRAMEWORK_VERSION`, `.claude/.framework-state.json`, `.claude-framework/.claude/CHANGELOG.md`) | PASS | All paths grep-verified |
| H13 | README.md mentions SYNC.md after adoption flow | PASS | `setup/portable/README.md:73-77` "Upgrading from a previous framework version" |
| H14 | README.md "What ships" table lists SYNC.md, manifest.json, sync.js | PASS | `README.md:51-53` |

## I. Customisation handling (spec §7)

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| I1 | Detection: hash mismatch with lastAppliedHash flags as customised | PASS | `sync.js:512-514` |
| I2 | Resolution: write `.framework-new` sibling (substituted), leave target untouched, log "MANUAL MERGE" | PASS | `sync.js:656-670` |
| I3 | No auto three-way merge (deferred per spec) | PASS | sync.js writes only `.framework-new`; no merge attempt |
| I4 | `syncIgnore[]` is sole opt-out (no other operator control) | PASS | `sync.js:465-467` |
| I5 | `customisedLocally` is informational, set automatically by sync | PASS | sync.js sets it in writeFrameworkNew/writeNewFile; only `syncIgnore` controls skip |

## J. Phase A implementation deliverables (spec §10 Phase A)

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| J1 | `setup/portable/manifest.json` — file ownership declaration | PASS | A1-A10 above |
| J2 | `setup/portable/sync.js` — sync engine, no external deps | PASS | 1369 lines (larger than spec's "~300" but plan §1.1 noted; pure-Node, no deps; CommonJS form for `node sync.js` consumption) |
| J3 | `setup/portable/SYNC.md` — upgrade walkthrough prompt | PASS | H1-H14 |
| J4 | `setup/portable/ADAPT.md` Phase 6 — record adoption state | PASS | G1-G6 |
| J5 | Synthetic e2e tests: adopt + sync + customisation + merge flow | PASS | 4 e2e files: adopt (3 tests), sync (3 tests), merge (3 tests), adopt-invariants (2 tests) — 11 total e2e tests, all pass |
| J6 | Update `setup/portable/README.md` to describe submodule + sync model | PASS | `README.md:73-77` (Upgrading section) + `README.md:51-53` (What ships additions) + `README.md:26-28` (placeholder format note) |
| J7 | FRAMEWORK_VERSION bumped to 2.2.0 | PASS | `setup/portable/.claude/FRAMEWORK_VERSION` content = `2.2.0` |
| J8 | CHANGELOG.md entry for v2.2.0 with Highlights / Added / Changed / Fixed | PASS | `setup/portable/.claude/CHANGELOG.md:35-55` |
| J9 | All targeted tests pass | PASS | 110 tests across 9 test files; 0 failures (see Test execution summary) |
| J10 | `npm run lint` clean (0 errors) | PASS | 726 warnings, 0 errors. Eslint config ignores `setup/portable/**` (eslint.config.js:8) |
| J11 | `npm run typecheck` clean | PASS | exits 0 |
| J12 | sync.js JSDoc-typecheckable via `tsc --noEmit --allowJs --checkJs` | PASS | clean (only unrelated repo-wide diagnostic for `@types/diff`'s `Intl.Segmenter`) |

## X. Cross-cutting checks

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| X1 | Placeholder format migrated from `[NAME]` to `{{NAME}}` across 14 source files (plan chunk 1) | PASS | grep `\[(PROJECT_NAME\|PROJECT_DESCRIPTION\|STACK_DESCRIPTION\|COMPANY_NAME)\]` returns no hits in agent files / docs / references; exempt files (CHANGELOG.md, README.md) intentionally retain the old name in explanatory prose |
| X2 | `scripts/build-portable-framework.ts` preflight scan detects legacy-format placeholders | PASS | scripts/build-portable-framework.ts:114-133 LEGACY_PLACEHOLDER_NAMES check + LEGACY_SCAN_EXEMPT for CHANGELOG.md/README.md |
| X3 | Cross-platform path handling — forward slash internal, OS-native at filesystem boundary | PASS | sync.js uses `path.join` for fs ops; manifest paths and state.json keys are forward-slash; e2e-sync.test.ts CRLF test confirms cross-platform hashing |
| X4 | Atomic state.json write (.tmp + rename) | PASS | sync.js:275-283 + helpers.test.ts round-trip / partial-write tests |

## Mechanical fixes applied

None — implementation is conformant out of the gate.

## Directional / ambiguous gaps (routed to tasks/todo.md)

None.

## Files modified by this run

None — verification only; no edits applied.

## Notes on intentional spec-vs-implementation deltas (already documented in plan)

Plan §1.1 explicitly flagged two spec-amendment items as "future spec edits, not part of any chunk":

1. **TypeScript → JavaScript-with-JSDoc.** Spec §4.5 says "TypeScript, ~300 lines"; implementation is JavaScript with JSDoc-annotated types, ~1369 lines. The plan justified this in §1.1 (avoids build step in framework repo; honours `node sync.js` runtime contract). Known accepted divergence — not a conformance gap.
2. **`lastSubstitutionHash` field.** Plan §1.11 added it for substitution-drift mitigation. Implementation correctly forward-migrates pre-2.2.0 state.json (skip drift check on first run, persist hash, drift detection active from second run — covered by flags.test.ts "Forward migration" test). Backwards compatible.

The size delta on sync.js (1369 vs ~300) reflects the comprehensive Phase A surface (six flags, settings-merge, drift detection, --doctor diagnostics, JSDoc docs); plan §3 sized cumulative chunks at 300+ lines of feature logic plus helpers.

## Test execution summary

All targeted tests pass via `npx tsx`:

```
helpers.test.ts              — 37 tests, 9 suites,  pass (125ms)
walk-classify.test.ts        — 12 tests, 10 suites, pass (68ms)
substitute-write.test.ts     — 17 tests, 7 suites,  pass (124ms)
settings-merge.test.ts       — 15 tests, 11 suites, pass (62ms)
flags.test.ts                — 18 tests, 16 suites, pass (12.2s)
e2e-adopt.test.ts            —  3 tests, pass (1.04s)
e2e-sync.test.ts             —  3 tests, pass (2.27s)
e2e-merge.test.ts            —  3 tests, pass (4.03s)
e2e-adopt-invariants.test.ts —  2 tests, pass (1.75s)
─────────────────────────────────────────────────────────────────
Total: 110 tests across 9 files, 0 failures
```

Repo-level gates: `npm run lint` clean (0 errors, 726 unrelated warnings), `npm run typecheck` clean.

## Next step

**CONFORMANT** — Phase A is fully aligned with the spec; no mechanical fixes required, no directional gaps detected. Proceed to `pr-reviewer`.

The implementation faithfully covers every concrete requirement in spec §4–§7 + §10 Phase A:
- manifest.json schema and content match §4.2 exactly.
- state.json shape matches §4.4 (with the additive `lastSubstitutionHash` field flagged at plan-review time, forward-migrated correctly).
- sync.js executes all 12 pseudocode steps (steps 0–11) per §4.5; all 6 flags implemented per the §4.5 table.
- Substitution engine honours all 4 spec invariants + the empty-map warn enrichment.
- settings.json flat-merge implements all 6 spec rules + plan's Rule 7 (non-removing).
- ADAPT.md Phase 6 added; framework-dev-location rule documented.
- SYNC.md walks all 7+1 phases with the Phase 4a drift-rebaseline branch.
- 110 tests pass; lint and typecheck clean.
