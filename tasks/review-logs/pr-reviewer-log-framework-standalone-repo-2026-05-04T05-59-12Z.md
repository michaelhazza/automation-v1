# PR Review — framework-standalone-repo (Phase A)

**Branch:** `claude/framework-standalone-repo`
**Build slug:** `framework-standalone-repo`
**Diff base:** merge-base with `origin/main` is `faa0166f`
**Reviewed at HEAD:** `ade9267e` plus working-tree (uncommitted Phase A deliverables)
**Reviewed:** 2026-05-04T05:59:12Z

**Verdict:** CHANGES_REQUESTED — 2 blocking, 5 strong, 9 nits.

**Reviewer:** pr-reviewer (read-only, automated)

**Files reviewed (full set):**
sync.js (1369 lines), manifest.json, package.json, SYNC.md, ADAPT.md (Phase 6),
eslint.config.js, scripts/build-portable-framework.ts,
setup/portable/.claude/CHANGELOG.md, FRAMEWORK_VERSION,
all 9 files in setup/portable/tests/,
modifications to setup/portable/.claude/agents/*.md,
setup/portable/README.md,
setup/portable/docs/frontend-design-principles.md,
setup/portable/references/spec-review-directional-signals.md,
.claude/agents/feature-coordinator.md (drive-by — flagged as B2),
tasks/builds/framework-standalone-repo/spec.md and plan.md.

---

## Table of contents

- Blocking issues (B1, B2)
- Strong recommendations (S1-S5)
- Non-blocking improvements (N1-N9)
- Praise
- Suggested resolution order

---

## Blocking Issues (must fix before marking done)

### B1. settings-merge: project's framework-owned hook can be silently dropped in mixed groups

**File:** `setup/portable/sync.js` lines 826-873 (`mergeSettingsHooksBlock`)

**Scenario.** Framework declares hooks `[A, B]` under matcher `Write`. Project declares `[A, X]` (A is framework-owned per identity check; X is project-owned).

**Trace.**
- `projFwIdentitySet = {A}`.
- For framework group: `mergedHooks` filters out A (collision), keeps B. Length is 1, so the all-collision branch (line 840) is **not** taken.
- Line 860-867 (normal path): `projOwnedHooks = projGroup.hooks.filter(h => identity === null) = [X]`. **A is excluded — it has a non-null framework identity.**
- `finalHooks = [B, X]`. Project's A vanishes.

**Why this matters.** Spec §4.6 rule 4: "if a framework and project hook share the same command path under the same event: **project wins** (the framework's version of that entry is not written)." With this code, neither version is written when a sibling framework hook in the same group survives — A is dropped from both sides. Project loses any custom args, type, or co-located config it set on its A entry.

**Why tests miss it.** `settings-merge.test.ts` Rule 4 only covers the symmetric case where framework and project each have *exactly one* hook (the colliding one) — that path lands in the all-collisions branch (line 840-857) which does correctly preserve `projFwHooks`. The mixed-group case is unexercised.

**Fix.** In the normal-path branch, after computing `mergedHooks` (surviving framework hooks) and `projOwnedHooks`, also include `projFwHooks` (project-declared framework-owned hooks whose identity is in `projFwIdentitySet`). Rule 5 ordering says framework-first — so put `projFwHooks` adjacent to where their framework counterpart would have been, OR before `projOwnedHooks`. Concretely:

```js
const projFwHooks = projGroup
  ? (projGroup.hooks || []).filter(h => {
      const id = frameworkHookIdentity(h.command);
      return id !== null && projFwIdentitySet.has(id);
    })
  : [];
const finalHooks = [...mergedHooks, ...projFwHooks, ...projOwnedHooks];
```

Add a Strong test (S1 below) before fixing.

---

### B2. Drive-by edit to `.claude/agents/feature-coordinator.md` outside Phase A scope

**File:** `.claude/agents/feature-coordinator.md` (NOT the portable copy at `setup/portable/.claude/agents/feature-coordinator.md`)

`git status` shows the live agent file is modified, but no part of Phase A's spec/plan touches this file — Phase A is scoped to `setup/portable/` and `scripts/build-portable-framework.ts`.

CLAUDE.md § 6 surgical-changes rule: *"Every changed line should trace directly to the user's request. If it doesn't, revert it."* The live `.claude/agents/feature-coordinator.md` change does not trace to the framework-standalone-repo build slug.

**Fix.** Either (a) revert the modification to `.claude/agents/feature-coordinator.md` so the diff stays surgical, OR (b) if the change was deliberate framework dev (e.g. an improvement to be sync'd to the portable copy), backport it to `setup/portable/.claude/agents/feature-coordinator.md` and explain in the commit body why both copies are touched. Per spec §11.1 the rule is "framework dev happens in the framework repo" — the equivalent here is "framework dev happens in `setup/portable/`, not in the live `.claude/`." Either way, this branch should not silently mutate the internal copy.

---

## Strong Recommendations (should fix)

### S1. Missing test: settings-merge mixed-group collision (parent of B1)

**File:** `setup/portable/tests/settings-merge.test.ts` (new test case to add)

**Given** framework hooks `{ PreToolUse: [{ matcher: 'Write', hooks: [{command: 'node ${CLAUDE_PROJECT_DIR}/.claude/hooks/A.js'}, {command: 'node ${CLAUDE_PROJECT_DIR}/.claude/hooks/B.js'}] }] }`
**And** project hooks `{ PreToolUse: [{ matcher: 'Write', hooks: [{command: 'node ${CLAUDE_PROJECT_DIR}/.claude/hooks/A.js', extraField: 'projectValue'}, {command: 'node ./scripts/X.js'}] }] }`
**When** `mergeSettingsHooksBlock(fw, proj)` runs
**Then** the merged Write group MUST contain exactly three hooks `[A, B, X]`, the A entry MUST be the project's (preserving `extraField: 'projectValue'`), B preserved from framework, X preserved from project.

This test fails with the current implementation and will pass after B1 is fixed.

### S2. `lastSubstitutionHash` is never populated when state is already on latest version

**File:** `setup/portable/sync.js` line 1075-1078 (early "already on latest" exit)

When `state.frameworkVersion === frameworkVersion` and the state was written by a pre-2.2.0 sync (no `lastSubstitutionHash`), the early exit at 1077 returns without writing state.json. The forward-migration write at 1314-1322 never runs. The `lastSubstitutionHash` field stays absent indefinitely, weakening the drift-detection invariant on subsequent runs that *are* version bumps.

**Fix.** Before the early exit, if `ctx.state` exists, has `substitutions`, and lacks `lastSubstitutionHash`, write it via `writeStateAtomic`. Or simpler: drop the early exit entirely and let the file walk run — every file will classify as `skipped/already-on-version` (no writes), the file walk overhead is sub-second, and step 10 fills in the missing field. The cost is small for a much simpler invariant.

**Test (Given/When/Then):** Given a state.json with `frameworkVersion === framework-source FRAMEWORK_VERSION` and no `lastSubstitutionHash` field. When `node sync.js` runs (no flags). Then exit code 0 AND the post-run state.json contains `lastSubstitutionHash` matching `hashSubstitutions(state.substitutions)`.

### S3. Path-traversal not validated on manifest entries

**File:** `setup/portable/sync.js` `expandGlob` (line 78), all writers (`writeUpdated`, `writeNewFile`, `writeFrameworkNew`, `mergeSettings`)

If a (compromised or hand-edited) `manifest.json` declares an entry with `path: "../../etc/passwd"` or similar, `expandGlob` produces `"../../etc/passwd"`, and `path.join(targetRoot, "../../etc/passwd")` resolves outside `targetRoot`. Sync would happily write to it.

The framework repo is a trust boundary (the operator pulls + reviews submodule updates), and spec §9 already names this risk under "Security/trust of `sync.js`" — but a one-line guard removes the foot-gun without changing the trust model:

```js
// In each writer, after computing targetPath:
const resolved = path.resolve(targetPath);
if (!resolved.startsWith(path.resolve(targetRoot) + path.sep) && resolved !== path.resolve(targetRoot)) {
  throw new Error(`refusing to write outside target root: ${relativePath}`);
}
```

Cheap defence-in-depth. Not blocking because trust boundary already named, but worth a guard.

### S4. Crash mid-walk leaves files written but unrecorded

**File:** `setup/portable/sync.js` step 7 file walk + step 10 atomic state write

The atomic state write (line 1314-1322) happens once at the end. If the process is killed mid-walk after writing 5 of 19 files, on the next run those 5 files exist on disk but have no state entry, so `classifyFile` returns `new-file-no-state` with `targetExists: true` → in non-`--adopt` mode, sync writes `<path>.framework-new` for each, alarming the operator.

The spec invariant at line 504-505 says "interrupted syncs leave state at the previous version (re-running sync is always safe)." The current impl satisfies that invariant *for state.json* but introduces a noisy false-positive resolution path on disk. The spec says re-run is safe; in practice re-run produces 5 spurious `.framework-new` files.

**Fix options.** (a) Accept this cost and document it in SYNC.md troubleshooting ("if you see N untracked .framework-new files after a crash, run `sync.js --adopt` to rebaseline cleanly"). (b) Per-file state checkpoint via incremental atomic writes (heavier; not justified by current usage). I'd take option (a) — one extra paragraph in SYNC.md § Troubleshooting.

### S5. `validateSubstitutions` not run on first-run `--adopt`

**File:** `setup/portable/sync.js` lines 1201-1212

The validation at line 1203 only runs when `state` already exists. First-run `--adopt` initialises `ctx.state` after the file walk would normally validate, with `substitutions: {}` (line 1224). If the operator pre-populates state.json with bad substitutions (e.g. `PROJECT_NAME: "Acme {{COMPANY_NAME}}"` — recursive marker), validation runs because `state` is non-null at line 1201, then the check fires. Good for that case. But the documented Phase 6 in ADAPT.md instructs the operator to write a state.json with substitutions BEFORE running `--adopt`, so validation does run.

The gap is small — if someone runs `--adopt` with no pre-existing state.json AND pollutes substitutions later, they bypass validation for the initial run. Low impact; just ensure ADAPT.md Phase 6 stays the documented path. Consider running `validateSubstitutions(ctx.state.substitutions)` after the line 1219 init too, for symmetry.

---

## Non-Blocking Improvements

### N1. `execSync` shell quoting (line 323, 341)

`execSync(\`git -C "${frameworkRoot}" rev-parse HEAD\`)` works on Windows where double-quote is the standard quote, but breaks on POSIX if `frameworkRoot` contains a literal `"`. `frameworkRoot` is `path.resolve(__dirname)` so this is theoretical, but using `execFileSync('git', ['-C', frameworkRoot, 'rev-parse', 'HEAD'])` removes the issue with no readability cost.

### N2. `mergeSettings` malformed-JSON path (line 938-942)

When `target/.claude/settings.json` is malformed JSON (and not ENOENT), the warning prints, then the merge proceeds treating project hooks as `{}`. This silently overwrites a malformed-but-recoverable file. Consider exiting 1 with "fix or delete settings.json before re-running sync" — cheaper than recovery from a clobbered file.

### N3. `classifyForAdopt` mixes sync and async APIs

Lines 993, 1000, 1005 use `require('fs').existsSync` / `readFileSync` while the rest of writers use `fs.promises`. Functionally identical in classifier code, but it's the only place in sync.js that re-`require`s fs inline. Tiny consistency nit.

### N4. `writeNewFile` Branch 2 (target exists, no state) initialises `lastAppliedHash: ''`

Line 736: when sync writes `.framework-new` for an untracked-but-existing file, the state entry is created with `lastAppliedHash: ''`. On subsequent runs (after the operator merges), `classifyFile` will see `targetHash !== ''` and classify as `customised`, re-writing `.framework-new`. The operator has to fall back to `--adopt` rebaseline. Consider: (a) record the hash of the *current target* content here so the operator's "merge" (overwriting target with the merged content) produces a consistent state when sync re-runs; OR (b) document the path in SYNC.md.

### N5. `writeFrameworkNew` mtime heuristic (line 645-654)

The 5-second target-mtime > state-mtime check that emits `inline_check=hash_drift_no_priorMerge` is observability scaffolding. Useful but quiet — its meaning isn't surfaced to the operator. Consider promoting this to a stderr line at INFO level when it fires, or remove it in favour of `--doctor`'s case(b) check which covers the same scenario more cleanly.

### N6. `frameworkHookIdentity` and `isFrameworkOwnedCommand` duplicate the same regex + interpreter check

Lines 765 and 786. The shared logic could live in one helper that returns either `null` or the identity string; the boolean form (`isFrameworkOwnedCommand`) becomes `frameworkHookIdentity(cmd) !== null`. CLAUDE.md § 6 last bullet: "Never duplicate logic — if the same behaviour is needed in two or more places, extract it into a shared function." Minor — both functions are tested.

### N7. Spec §4.5 step 7.b2 (mode-change check) and impl mismatch

Spec says: when state recorded mode differs from manifest mode and new mode is `adopt-only`, mark `adoptedOwnership = true` and emit `ownership-transferred`. The impl in `classifyFile` (line 470-473) returns `ownership-transferred` whenever a state entry exists, mode is `adopt-only`, and `adoptedOwnership` is unset. It does *not* check that the *previous* recorded mode was `sync`. In practice all current adopt-only files in the manifest were always adopt-only at adoption time, so the missing comparison doesn't regress. But a future repo that adopted an earlier framework version (where the path was `sync`) and is now upgrading will hit this branch correctly. Just be aware: a fresh repo that adopts directly into adopt-only mode will *also* hit this branch on the second sync if `adoptedOwnership` wasn't set. Verify `writeNewFile` always sets `adoptedOwnership: true` for `adopt-only` entries on first write — it does (line 699, 720). Good.

### N8. `--check` exit-1 when state is on latest but customisations exist (without `--strict`)

Line 1143: `if (updatesAvailable) exit 1` runs first, so a clean repo on latest with customisations exits 0. Spec §4.5 flag table says "--check ... Does NOT fail on customised files — those are intentional." Match. No issue, just confirming.

### N9. `tasks/builds/framework-standalone-repo/plan.md` is untracked

plan.md is in the working tree as untracked but not in git status as committed. Ensure it gets committed with the same commit as the implementation so the plan-of-record persists.

---

## Praise

- The classifier-as-pure-function pattern (`classifyFile` returns a discriminated union) makes the file walk readable and testable — clean separation of decision from action.
- Spec §4.5 substitution invariants (placeholder format, scoping, idempotency, `.framework-new` substitution) are enforced in `validateSubstitutions` AND covered by `applySubstitutions` idempotency test (substitute-write.test.ts:173). Solid.
- Atomic state write via tmp+rename (line 275-283) plus the per-file structured log lines (`SYNC file=… status=…`) give CI a clean parser hook AND debugging trail.
- Forward-migration test for `lastSubstitutionHash` (flags.test.ts test 6) covers exactly the additive-state scenario the spec calls out as a pre-approved delta.
- The CRLF line-ending end-to-end test (e2e-sync.test.ts test 3) directly exercises the spec §9 risk row "false positives from line-ending differences." High-value.
- The `--adopt` pre-existing-files invariant test (e2e-adopt-invariants.test.ts test 1) confirms the spec line 516 contract — non-destructive cataloguing — with a real assertion (no `.framework-new` written anywhere). Hard to write, well-aimed.
- 110 passing tests for ~1369 lines of code is a strong ratio.
- `eslint.config.js` ignore of `setup/portable/**` is correct — sync.js is JS-with-JSDoc per spec §4.5, lints would fight the pattern.

---

## Suggested resolution order

1. **B2** — revert/justify the `.claude/agents/feature-coordinator.md` change.
2. **B1 + S1** — add the mixed-group test, watch it fail, fix `mergeSettingsHooksBlock`, watch it pass. Run only the new test file via `npx tsx setup/portable/tests/settings-merge.test.ts`.
3. **S2** — drop the early-exit OR add the forward-migration write before exit. Add the Given/When/Then test.
4. **S3** — add the path-resolve guard in writers.
5. **S4** — one-paragraph addition to SYNC.md § Troubleshooting.
6. **S5, N1-N9** — at the author's discretion before merge.
