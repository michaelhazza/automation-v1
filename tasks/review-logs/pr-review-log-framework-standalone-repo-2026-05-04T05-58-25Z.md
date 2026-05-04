```pr-review-log
# PR review — framework-standalone-repo (Phase A: sync infrastructure)

**Files reviewed:**
- `setup/portable/manifest.json` (new)
- `setup/portable/sync.js` (new, ~1370 lines incl. comments)
- `setup/portable/SYNC.md` (new)
- `setup/portable/ADAPT.md` (Phase 6 added)
- `setup/portable/README.md` (updated for submodule + sync model)
- `setup/portable/package.json` (new — `"type": "commonjs"`)
- `setup/portable/tests/*.test.ts` (9 new test files)
- `setup/portable/.claude/CHANGELOG.md` (2.2.0 entry)
- `setup/portable/.claude/FRAMEWORK_VERSION` (bumped to 2.2.0)
- `setup/portable/.claude/agents/*.md` (10 modified — `[X]` → `{{X}}` format migration)
- `setup/portable/docs/frontend-design-principles.md`, `setup/portable/references/spec-review-directional-signals.md` (placeholder migration)
- `scripts/build-portable-framework.ts` (legacy-placeholder preflight scan added)
- `eslint.config.js` (added `setup/portable/**` to `ignores`)

**Reviewed at:** 2026-05-04T05:58:25Z

**Verdict:** CHANGES_REQUESTED (1 blocking, 5 strong)

---

## Blocking Issues

### B1. Build script's legacy-placeholder preflight will reject the current bundle (test fixtures contain `[PROJECT_NAME]`)

**Location:** `scripts/build-portable-framework.ts` lines 110-133 (`walkLegacy`) collide with `setup/portable/tests/substitute-write.test.ts` lines 182, 185.

**The collision:** `walkLegacy` recursively scans every `.md|json|js|ts|sh|txt` file under `setup/portable/` for legacy `[PROJECT_NAME]`-style placeholders. The `LEGACY_SCAN_EXEMPT` set (line 115) only exempts `CHANGELOG.md` and `README.md` by basename. The new test file `substitute-write.test.ts` deliberately contains `[PROJECT_NAME]` on lines 182 and 185 to assert that the substitution engine does NOT transform single-bracket form (i.e., scoping invariant from spec §4.5 rule 1). Running `npx tsx scripts/build-portable-framework.ts` against this branch will exit 1 with two `leftover legacy-format placeholder` errors before producing the zip.

**Recommended fix (pick one):**
1. Add `'tests'` to a new directory-exemption check inside `walkLegacy` — skip recursion when `e.isDirectory() && e.name === 'tests'`. Cleanest because the test fixture intent is "demonstrate the engine ignores legacy form" and that intent is best preserved by not scanning tests at all.
2. Exclude `tests/` from the zip entirely (likely the right call long-term — consumer repos do not need the framework's own test suite). Combine with option 1 by restructuring the bundle so tests live outside `setup/portable/` (e.g., `setup/portable-tests/`).
3. Switch the test fixtures to use a synthetic example token like `[EXAMPLE_TOKEN]`. Less ideal because `PROJECT_NAME` is the canonical demonstration of the placeholder-format invariant.

This issue blocks Phase B (lift to standalone repo) — the lift step cannot run until either the bundle builds cleanly or the lift bypasses the build script.

---

## Strong Recommendations

### S1. Agent-count inconsistency in `ADAPT.md` (19 vs 20)

**Location:** `setup/portable/ADAPT.md` lines 28 ("19 agent definitions"), 89 ("FULL (19)"), vs lines 57, 290 ("FULL (20)") and `setup/portable/README.md` line 34 ("20 agent definitions"). Actual count under `setup/portable/.claude/agents/`: 20. Build-script preflight (`scripts/build-portable-framework.ts` line 139) hard-codes `=== 20`.

**Fix:** Replace the two "19" instances in ADAPT.md (lines 28 and 89) with "20". Self-contained doc edit; no code impact.

### S2. "Already on latest" early-exit fires before unresolved-merge scan (spec ordering violation)

**Location:** `setup/portable/sync.js` line 1075 vs spec §4.5 step 0 (lines 430-433).

The spec's pseudocode declares startup-check (scan for `.framework-new`) as step 0 — runs FIRST. Implementation runs the version-equality short-circuit (step 5 in spec) at line 1075 before step 0's unresolved-merge scan at line 1081. If a target is "already on latest" but has stray `.framework-new` files (e.g., operator manually merged but never re-ran sync, OR a previous sync left them and the operator never resolved before the next version arrived but version stayed equal), sync silently exits 0 with no warning — violating the safety contract.

**Fix:** Move the unresolved-merge scan above the version-equality check at line 1075.

### S3. `--strict` exit message conflates "updates" and "customisations"

**Location:** `setup/portable/sync.js` line 1140.

When `--strict` exits 1 because `hasCustomised` is true, the printed message is `CHECK: framework has updates or customisations requiring attention.` But at this point in the control flow (line 1139), only `hasCustomised` has been used to gate the exit — `updatesAvailable` is checked at line 1143 separately. A user running `--strict` who sees this message cannot tell which condition fired.

**Fix:** Differentiate the two messages:
- Line 1140: `CHECK: framework has customisations requiring attention.`
- Line 1144: keep `CHECK: framework updates available (...)`.

### S4. Missing test — `--check` returns exit 0 with positive "up to date" assertion

**Location:** `setup/portable/tests/flags.test.ts` Test 8 (lines 296-313).

Test 8 verifies that `--check` after `--adopt` exits 0 and that combined output includes `"up to date"`. But the assertion uses substring match on combined stdout+stderr, and there is no separate assertion that:
- exit 0,
- stdout (NOT stderr) contains `framework is up to date (v2.2.0)` exactly,
- no customisations were inadvertently flagged.

**Suggested test (Given/When/Then):**
- **Given** a fresh target where `--adopt` ran cleanly and no managed file has been modified since,
- **When** `node sync.js --check` runs,
- **Then** exit code is 0 AND `stdout` contains the literal `"framework is up to date (v2.2.0)"` AND `stderr` is empty (no spurious WARN/ERROR lines).

Add to `flags.test.ts`. Author and run via `npx tsx setup/portable/tests/flags.test.ts` after authoring.

### S5. Missing test — manifest overlap-but-identical-config emits WARN to stderr

**Location:** `setup/portable/sync.js` line 232 emits a WARN when two manifest entries overlap with identical config (`hasIdentical` branch). No test in `tests/helpers.test.ts` asserts this WARN is emitted.

**Suggested test (Given/When/Then):**
- **Given** a manifest with two `managedFiles` entries pointing at the same expanded path with the same `mode`, `category`, and `substituteAt`,
- **When** `loadManifest(frameworkRoot)` is called,
- **Then** stderr receives a line matching `WARN: manifest path .* matched by 2 entries` AND `loadManifest` returns successfully (no throw, manifest object returned).

Add to `helpers.test.ts § loadManifest`. Author and run via `npx tsx setup/portable/tests/helpers.test.ts` after authoring.

### S6. Cross-file lint/typecheck blind spot — `setup/portable/**` is invisible to project tooling

**Location:** `eslint.config.js` line 8 adds `setup/portable/**` to `ignores`. Root `tsconfig.json` only includes `client/src`. Tests in `setup/portable/tests/*.test.ts` are TypeScript but live outside any tsconfig project. Net effect: no lint errors and no typecheck errors will EVER surface for `sync.js` or its tests via the standard project commands.

This is intentional (the bundle is opaque to the host project's tooling), but it has a real consequence: bugs that lint/tsc would catch in any other JS file will not be caught here — they will only surface when the test files are actually executed via `npx tsx`. Recommend documenting this explicitly in `setup/portable/README.md` (or a new `setup/portable/CONTRIBUTING.md`) so future contributors know to:
- run targeted tests for any sync.js change: `npx tsx setup/portable/tests/<file>.test.ts`,
- audit `sync.js` for type-safety manually since `tsc --checkJs` is not wired up.

Not blocking — the tests themselves are the safety net — but the gap should be acknowledged.

---

## Non-Blocking Improvements

### N1. `--check` dead-code branch — `!state` unreachable at line 1137

In `sync.js` line 1137: `if (!state || (state && state.frameworkVersion !== frameworkVersion)) updatesAvailable = true;` — the `!state` condition is unreachable because line 1115-1118 already exits if state is missing. Simplify to `if (state.frameworkVersion !== frameworkVersion) updatesAvailable = true;`.

### N2. `extractChangelogExcerpt` assumes newest-first ordering

`sync.js` line 1027-1041 walks the file top-down, sets `inRange=true` on `## newVersion`, sets `inRange=false` and `break`s on `## oldVersion`. If the changelog is ever reordered (oldest first), the function returns nothing silently. The current changelog convention is newest-first, so this works, but worth a one-line comment in the function header.

### N3. `mergeSettingsHooksBlock` complexity

Lines 806-908 are dense. The "all hooks in this framework group were collisions" branch (lines 840-859) duplicates project-group lookup logic that already exists below at lines 861-873. Consider extracting a helper. Functional today; readability improvement.

### N4. State-write atomicity contract not documented near `writeStateAtomic`

The atomic-state-write invariant is in spec §4.5 step 10 but no comment near `writeStateAtomic` (line 275-283) explains the broader contract.

### N5. `package.json` `"type": "commonjs"` rationale undocumented

Exists to override parent `package.json`'s `"type": "module"`. Future readers may not realise this. Either rename `sync.js` to `sync.cjs` or add a comment in README explaining why this file exists.

---

## Verdict line summary

**Verdict:** CHANGES_REQUESTED (1 blocking, 5 strong, 5 non-blocking)

The blocking issue (B1) is mechanical — the bundle's preflight rejects its own test fixtures. Fix is small. All other findings are non-mechanical recommendations or doc/test coverage gaps.
```
