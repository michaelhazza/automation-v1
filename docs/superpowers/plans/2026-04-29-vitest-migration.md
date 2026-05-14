# Vitest Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Automation OS unit-test layer from the bash-driven `tsx`-per-file runner to a single Vitest pipeline, cutting CI runtime from 10–25 minutes to under 3 minutes while consolidating three assertion patterns into one.

**Architecture:** Six executable phases (0 → 6) plus a hard precondition (CI must exist and be green). Phases 0–4 keep the bash runner alive alongside Vitest for dual-run verification; Phase 5 is the cutover; Phase 6 codifies conventions and removes footguns. Cross-phase invariants I-1 through I-10 (named in the spec § 6) hold throughout — every commit and quarantine references them by ID.

**Tech Stack:** Vitest 2.x (`vitest`, `@vitest/coverage-v8`), TypeScript 5.x with `moduleResolution: 'bundler'`, Node 20, existing `tsconfig.json` paths and aliases preserved. No new framework dependencies (no RTL, no MSW, no supertest — explicitly out of scope per spec § 2).

**Source spec:** [`docs/test-migration-spec.md`](../../test-migration-spec.md). Read it before starting any phase. The readiness report it cites lives at [`docs/ci-readiness-report.md`](../../ci-readiness-report.md).

---

## Runbook shortcut

Quick-reference for executors. Full details in each phase section.

| Phase | Entry command | Stop condition |
|-------|--------------|----------------|
| Phase 0 | `bash scripts/run-all-unit-tests.sh 2>&1 \| tee docs/pre-migration-test-snapshot.txt` | All files pass; SHA recorded |
| Phase 1 | `npm install --save-dev vitest@^2.1.0 @vitest/coverage-v8@^2.1.0` | 277 files discovered; zero MISMATCH rows in parity doc |
| Phase 2 | `bash scripts/check-batch.sh tasks/builds/vitest-migration/phase2-batch-NN.txt phase2` | 6 batches green; zero legacy imports; escalations ≤ 5 |
| Phase 3 | `bash scripts/check-batch.sh tasks/builds/vitest-migration/phase3-batch-NN.txt phase3` | ~22 batches green; global dual-run match; zero free-standing top-level stmts |
| Phase 4 | `npx vitest run` (parallel) + 10-run stress | 10 consecutive clean; quarantines ≤ 13; env vars reconciled |
| Phase 5 | `git tag vitest-pre-cutover` → repoint scripts → delete bash runner → push → wait for CI green | CI unit layer < 5 min; all legacy patterns gone |
| Phase 6 | Per-task cleanup commits | All exit gates satisfied; quarantine audit passes |

**Rebase cadence:** Rebase to `main` at every phase boundary (or daily if `main` is moving fast). After each rebase, re-run `npx vitest run` against the converted-so-far file set and confirm zero regressions before continuing.

**CI-only commands:** `npm test`, `npm run test:gates`, `npm run test:qa`, and any `scripts/run-all-*.sh` gate/QA umbrella are forbidden in local agent sessions per `CLAUDE.md § "Test gates are CI-only"`. This plan calls the unit runner directly (`bash scripts/run-all-unit-tests.sh`) for baseline capture only, which is an explicit migration carve-out for a one-time pre-migration snapshot. All full-pipeline verification (`npm test`) happens by pushing to the migration branch and reading CI output.

---

## Table of contents

1. Hard precondition (CI workflow)
2. File structure overview
3. Phase 0: Baseline capture
4. Phase 1: Vitest scaffolding
5. Phase 2: `node:test` migration (~52 files)
6. Phase 3: Handwritten harness migration (~215 files + 2 outliers)
7. Phase 4: Enable parallelism and stress-test
8. Phase 5: Cutover and CI re-tune
9. Phase 6: Cleanup, conventions, footguns, coverage
10. Cross-phase invariants reference (I-1 … I-10)
11. Self-review checklist

---

## 1. Hard precondition: CI workflow exists and is green

The spec § 4 Phase 0 opens with "CI must exist and be green before this phase begins." Today, `.github/workflows/` does not exist (verified during plan authoring on branch `claude/add-github-actions-ci-1Ldda`, which is currently bringing CI up).

**Do not start Phase 0 until all of these are true:**

- `.github/workflows/ci.yml` is committed on `main`.
- A CI run on `main` exits zero on the same Node 20 environment Phase 0 will use.
- The CI env block contains at minimum: `DATABASE_URL`, `JWT_SECRET`, `EMAIL_FROM`, `NODE_ENV=test` (per readiness report § 4).

If any of the above is false, STOP. The migration is blocked on the CI bring-up branch landing first. Surface this to the user; do not attempt Phase 0 against a missing or red CI.

---

## 2. File structure overview

Files this migration creates, modifies, or deletes. Each entry maps to the phase that owns the change.

**Created:**
- `vitest.config.ts` — Phase 1
- `docs/test-fixtures-inventory.md` — Phase 1
- `docs/pre-migration-test-snapshot.txt` — Phase 0 (full stdout + per-file outcomes)
- `docs/pre-migration-test-snapshot.json` — Phase 0 (machine-readable companion, anchors I-3b)
- `tasks/builds/vitest-migration/test-count-parity.md` — Phase 1, updated in Phase 3
- `tasks/builds/vitest-migration/vitest-discovery-baseline.json` — Phase 1 (output of `vitest list --reporter=json`, source of truth for I-3a)
- `tasks/builds/vitest-migration/dual-run-consistency.md` — Phases 2–3
- `tasks/builds/vitest-migration/escalations.md` — Phases 2–3 (migration-fatigue friction file)
- `tasks/builds/vitest-migration/parallel-stress-results.md` — Phase 4
- `tasks/builds/vitest-migration/progress.md` — created in Phase 0, updated every session per CLAUDE.md § 12
- `.nvmrc` — Phase 6

**Modified:**
- `package.json` — Phases 1, 5, 6
- `vitest.config.ts` — Phases 4, 6
- `docs/testing-conventions.md` — Phase 6 (full rewrite of assertion + skip-gate sections)
- `docs/testing-structure-Apr26.md` — Phase 6 (snapshot updated to Vitest-based runtime)
- `.github/workflows/ci.yml` — Phase 5 (timeout 45 → 15, env additions if any)
- `docs/ci-setup.md` — Phase 5 (runtime expectations)
- Every `*.test.ts` file in the unit layer — Phases 2, 3, 6

**Deleted:**
- `scripts/run-all-unit-tests.sh` — Phase 5
- The handwritten test helpers inlined in each `*.test.ts` (removed per-file in Phase 3)
- `package.json`'s `playbooks:test` script — Phase 6 (contingent on Vitest-coverage audit)

**Moved (Phase 6):**
- `shared/lib/parseContextSwitchCommand.test.ts` → `shared/lib/__tests__/parseContextSwitchCommand.test.ts`
- `server/services/scopeResolutionService.test.ts` → `server/services/__tests__/scopeResolutionService.test.ts`

**Untouched (per spec § 2 non-goals):**
- All 54 `scripts/verify-*.sh` files
- `scripts/run-all-gates.sh`, `scripts/run-all-qa-tests.sh`, `scripts/migrate.ts`, `scripts/seed.ts`, `scripts/run-trajectory-tests.ts`
- `worker/`, `tools/mission-control/`, `migrations/`, `drizzle.config.ts`, `tests/trajectories/`

---

## 3. Phase 0: Baseline capture

Capture pass/fail/skip outcomes per file under the current bash runner. These snapshots are the oracle for invariants I-3 (test-count parity) and I-4 (dual-run consistency). Phase 0 changes no source code.

### Task 0.1: Create the migration build directory and progress doc

**Files:**
- Create: `tasks/builds/vitest-migration/progress.md`

- [ ] **Step 1: Create the directory and progress file**

```bash
mkdir -p tasks/builds/vitest-migration
```

Create `tasks/builds/vitest-migration/progress.md` with:

```markdown
# Vitest Migration — Session Progress

Current phase: Phase 0 — baseline capture.

Spec: docs/test-migration-spec.md
Plan: docs/superpowers/plans/2026-04-29-vitest-migration.md

## Environment

Node: (fill in from `node --version`)
npm: (fill in from `npm --version`)
Phase 0 baseline commit SHA: (fill in after Phase 0 commit — used to detect .test.ts drift)

## Decisions log

(append as the migration proceeds; one bullet per non-trivial decision with date)

## Session handoff notes

(update before /compact or stepping away; what was done, what's next)
```

After creating the file, immediately capture and fill in the environment block:

```bash
node --version
npm --version
```

Record both into the `## Environment` section before the first commit.

- [ ] **Step 2: Commit**

```bash
git add tasks/builds/vitest-migration/progress.md
git commit -m "test(vitest-migration): seed migration progress doc (Phase 0)"
```

### Task 0.2: Capture full stdout snapshot under the bash runner

**Files:**
- Create: `docs/pre-migration-test-snapshot.txt`

- [ ] **Step 0: Read the bash runner and document its output format**

Before running anything, open `scripts/run-all-unit-tests.sh` and identify the exact per-file outcome line shape (e.g. `PASS <path>`, `[PASS] <path>`, a unicode checkmark, etc.). Record the regex into the snapshot file so that Task 0.3's parser references the same pattern:

```bash
head -60 scripts/run-all-unit-tests.sh
```

Look for the lines that `echo` or `printf` PASS/FAIL/SKIP results. Note the exact prefix. If the format is anything other than `^(PASS|FAIL|SKIP) `, update every occurrence of that grep pattern in Tasks 0.3 and 0.4 to match. This step takes 60 seconds and prevents silent empty `## Per-file outcomes` sections if the script has evolved.

- [ ] **Step 1: Run the bash unit runner and tee the output**

Run on the same Node 20 environment CI uses. This invokes the unit runner directly — not `npm test` (which chains gates + QA + unit and is CI-only per CLAUDE.md).

```bash
node --version  # must print v20.x; switch via nvm if needed
bash scripts/run-all-unit-tests.sh 2>&1 | tee docs/pre-migration-test-snapshot.txt
echo "runner exit: $?"
```

The exit code must be zero. If the runner exits non-zero, triage each failing test **before proceeding**: fix it, or delete it with rationale in `tasks/todo.md` (I-5). Do not proceed to Task 0.3 until the runner exits zero and every failure is accounted for.

- [ ] **Step 2: Verify the snapshot lists per-file outcomes**

```bash
grep -E "^(PASS|FAIL|SKIP) " docs/pre-migration-test-snapshot.txt | head
```

Expected: each line names a `*.test.ts` file path. If the format differs from what Step 0 documented, fix the grep pattern before continuing.

- [ ] **Step 3: Commit**

```bash
git add docs/pre-migration-test-snapshot.txt
git commit -m "test(vitest-migration): capture pre-migration test snapshot (Phase 0, I-3 baseline)"
```

After this commit: copy the SHA into `tasks/builds/vitest-migration/progress.md`'s `## Environment` block under "Phase 0 baseline commit SHA". This SHA is used in Phase 2 to detect whether any `.test.ts` file changed since the baseline was captured.

### Task 0.3: Parse per-file outcomes into the snapshot's structured section

**Files:**
- Modify: `docs/pre-migration-test-snapshot.txt` (append `## Per-file outcomes` section)

- [ ] **Step 1: Append the per-file outcomes section**

Append a `## Per-file outcomes` section to the snapshot listing each test file as `<path>\t<pass|fail|skip>`. Generate from the bash runner output:

```bash
{
  echo ""
  echo "## Per-file outcomes"
  echo ""
  grep -E "^(PASS|FAIL|SKIP) " docs/pre-migration-test-snapshot.txt \
    | awk '{ printf "%s\t%s\n", $2, tolower($1) }' \
    | sort
} >> docs/pre-migration-test-snapshot.txt
```

- [ ] **Step 2: Append the outliers section**

The bash runner does not discover `shared/lib/parseContextSwitchCommand.test.ts` or `server/services/scopeResolutionService.test.ts` (its glob requires `__tests__/`). Document them under a separate heading so they are visible in the snapshot but not mistaken for files the bash runner actually ran:

```bash
{
  echo ""
  echo "## Outliers (discovered by Vitest only)"
  echo ""
  echo "shared/lib/parseContextSwitchCommand.test.ts	0"
  echo "server/services/scopeResolutionService.test.ts	0"
} >> docs/pre-migration-test-snapshot.txt
```

The trailing `0` is the `testCount` field — both files are top-level scripts with no `test()` wrapper today (Phase 3 wraps them).

- [ ] **Step 3: Commit**

```bash
git add docs/pre-migration-test-snapshot.txt
git commit -m "test(vitest-migration): add per-file outcomes section to snapshot (Phase 0)"
```

### Task 0.4: Generate the machine-readable JSON companion

**Files:**
- Create: `docs/pre-migration-test-snapshot.json`

- [ ] **Step 1: Write the generation script inline and run it**

Run from the repo root:

```bash
node --input-type=module -e '
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const txt = readFileSync("docs/pre-migration-test-snapshot.txt", "utf8");
const outcomeMap = new Map();
for (const line of txt.split("\n")) {
  const m = line.match(/^(\S+\.test\.ts)\t(pass|fail|skip)$/);
  if (m) outcomeMap.set(m[1], m[2]);
}

// Excluded top-level dirs must mirror vitest.config.ts's exclude list exactly.
const EXCLUDED_DIRS = new Set([
  "node_modules", "dist", ".git", "coverage",
  "tools", "worker", "migrations", ".github", ".claude",
]);

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (entry.endsWith(".test.ts")) files.push(full.replace(/\\/g, "/"));
  }
  return files;
}
const allTestFiles = walk(".");

const entries = allTestFiles.map(file => {
  const src = readFileSync(file, "utf8");
  const testCount =
    (src.match(/\btest\s*\(/g) || []).length +
    (src.match(/\bdescribe\s*\(/g) || []).length;
  const outcome = outcomeMap.get(file) ?? "not-discovered";
  return { file, outcome, testCount };
});

writeFileSync(
  "docs/pre-migration-test-snapshot.json",
  JSON.stringify(entries, null, 2) + "\n"
);
console.log(`Wrote ${entries.length} entries`);
'
```

Expected output: `Wrote 277` (275 discovered + 2 outliers). If the count differs from 277, investigate before committing — either a test file was added/deleted since the spec was written, or the walker is missing a directory.

- [ ] **Step 2: Sanity-check the JSON**

```bash
node -e 'const d = JSON.parse(require("fs").readFileSync("docs/pre-migration-test-snapshot.json", "utf8")); console.log("total:", d.length, "outliers:", d.filter(e => e.outcome === "not-discovered").length, "passing:", d.filter(e => e.outcome === "pass").length)'
```

Expected:
- `total: 277`
- `outliers: 2` (the two known not-discovered files)
- `passing:` close to 275 minus any pre-existing failures triaged in Task 0.2

If `outliers` is anything other than 2, the snapshot is incomplete — revisit Task 0.3 step 2.

- [ ] **Step 3: Commit**

```bash
git add docs/pre-migration-test-snapshot.json
git commit -m "test(vitest-migration): add machine-readable snapshot JSON (Phase 0, I-3b baseline)"
```

### Task 0.5: Verify gate and QA layers via CI

**Files:** none modified.

`npm run test:gates` and `npm run test:qa` are CI-only commands (CLAUDE.md § "Test gates are CI-only"). Verify them by pushing to the migration branch and reading CI output.

- [ ] **Step 1: Push the Phase 0 commits and wait for CI**

```bash
git push origin <migration-branch>
```

Wait for the CI run to complete (the `ci.yml` workflow added during CI bring-up). The run exercises gates + QA + unit in one pass. Do not proceed until CI is green.

- [ ] **Step 2: Triage CI failures before continuing**

If CI exits non-zero, triage each failure:
- Gate or QA layer failure: fix the underlying issue (these layers are not being migrated — a pre-existing failure blocks the migration baseline).
- Unit layer failure: fix or delete with rationale + `tasks/todo.md` entry per I-5.

Do not start Phase 1 until CI is fully green.

- [ ] **Step 3: Update progress doc**

Append to `tasks/builds/vitest-migration/progress.md` under `## Decisions log`:

```markdown
- YYYY-MM-DD: Phase 0 baseline captured. Bash runner: <pass-count>/<total> passing.
  Outliers: 2 (parseContextSwitchCommand.test.ts, scopeResolutionService.test.ts).
  CI green (SHA: <phase0-sha>). Proceeding to Phase 1.
```

Replace `YYYY-MM-DD` with the actual date and fill in the counts. Commit the progress update.

```bash
git add tasks/builds/vitest-migration/progress.md
git commit -m "test(vitest-migration): Phase 0 complete — baseline green, CI green"
```

### Phase 0 exit gate

All of the following are required before starting Phase 1:

- `docs/pre-migration-test-snapshot.txt` exists and lists per-file outcomes using the format verified in Task 0.2 Step 0.
- `docs/pre-migration-test-snapshot.json` exists with 277 entries (275 + 2 outliers).
- CI is green on the migration branch (gates + QA + unit all pass).
- `tasks/builds/vitest-migration/progress.md` has the Phase 0 baseline commit SHA recorded in `## Environment`.
- `tasks/builds/vitest-migration/progress.md` records pass-count, outlier count, and CI status.

**Snapshot drift guard:** If any `*.test.ts` file changes after the Phase 0 commit SHA (e.g., a PR lands during the migration), the Phase 0 JSON snapshot is stale. Before starting any batch in Phase 2 or 3, run:

```bash
git diff <phase0-sha>..HEAD --name-only -- '*.test.ts'
```

If this prints any paths, re-run Task 0.2 Steps 1–3 and Task 0.4 against the current HEAD before continuing. The snapshot is the I-3 oracle — a stale oracle silently breaks parity checks.

If any failed test was deleted (not fixed), a `tasks/todo.md` entry must exist linking the deletion commit and naming the follow-up. I-5 (no silent test deletions) is enforced from Phase 0 onward.

---

## 4. Phase 1: Vitest scaffolding

Add Vitest as a dev dependency, configure it to discover the existing test files unmodified, and run it in single-fork (sequential) mode alongside the bash runner. No `*.test.ts` files are touched in this phase.

### Task 1.1: Install Vitest and the v8 coverage provider

**Files:**
- Modify: `package.json` (devDependencies)
- Modify: `package-lock.json` (regenerated by `npm install`)

- [ ] **Step 1: Install the dev dependencies**

```bash
npm install --save-dev vitest@^2.1.0 @vitest/coverage-v8@^2.1.0
```

Use the latest 2.x at execution time; pin both packages to the same minor version to avoid mismatch warnings.

- [ ] **Step 2: Verify install**

```bash
npx vitest --version
```

Expected: `vitest/2.1.x`. Anything else (3.x, 1.x) means npm picked up an unexpected version — re-pin and reinstall.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "test(vitest-migration): add vitest@2.x and coverage-v8 (Phase 1)"
```

### Task 1.2: Create `vitest.config.ts` with single-fork settings and pre-emptive quarantine

**Files:**
- Create: `vitest.config.ts`

- [ ] **Step 1: Write the initial config**

Create `vitest.config.ts` at the repo root:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
    },
  },
  test: {
    include: [
      '**/__tests__/**/*.test.ts',
      'shared/lib/parseContextSwitchCommand.test.ts',
      'server/services/scopeResolutionService.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tools/mission-control/**',
      'worker/**',
    ],
    env: {
      JWT_SECRET: 'ci-throwaway-jwt-secret',
      EMAIL_FROM: 'ci@automation-os.local',
      NODE_ENV: 'test',
    },
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    poolMatchGlobs: [
      ['scripts/__tests__/build-code-graph-watcher.test.ts', 'forks'],
    ],
    testTimeout: 30_000,
  },
});
```

Notes:
- The `@` alias matches `tsconfig.json` so client tests using `@/...` resolve identically to runtime Vite.
- The two outlier paths in `include` are explicit because they live outside `__tests__/`. Phase 6 removes these entries after the files move.
- `DATABASE_URL` is intentionally absent from the `env` block — it flows from the runtime environment (CI workflow `env:` or local shell). Tests that need it self-skip via `skipIf` (Phase 2/3 conversion).
- `poolMatchGlobs` pre-pins `build-code-graph-watcher.test.ts` to forked execution per R-M6. Phase 4 will keep this entry permanent.

### Task 1.3: Add the quarantine comment to `build-code-graph-watcher.test.ts`

**Files:**
- Modify: `scripts/__tests__/build-code-graph-watcher.test.ts` (top of file)

- [ ] **Step 1: Add a `tasks/todo.md` entry first**

Append to `tasks/todo.md` under `## Test infrastructure hygiene` (create the heading if it doesn't exist):

```markdown
### TI-001: Make build-code-graph-watcher.test.ts parallel-safe
- File: scripts/__tests__/build-code-graph-watcher.test.ts
- Quarantine date: YYYY-MM-DD (replace at write time)
- Owner: unowned
- Reason: spawns `tsx scripts/build-code-graph.ts` subprocesses, holds the
  singleton lock at `references/.watcher.lock`, takes up to 120 s, and is
  destructive of in-flight watcher state. Pinned to single-fork to prevent
  collisions with any other test that touches the same lock or filesystem
  paths.
- Goal: refactor the test so its filesystem and subprocess effects are
  scoped to a temp directory + injected lock path, then remove the
  `poolMatchGlobs` entry and the `// @vitest-isolate` comment.
- Linked invariant: I-6 (quarantine contract with expiry pressure).
```

The entry ID `TI-001` is referenced in the file's quarantine block.

- [ ] **Step 2: Add the four-field quarantine comment**

Add at the top of `scripts/__tests__/build-code-graph-watcher.test.ts`, immediately after any leading file-level comment but before any `import`:

```ts
// @vitest-isolate
// reason: spawns tsx subprocesses, holds references/.watcher.lock singleton,
//         destructive of in-flight watcher state, runtime up to 120s
// date: YYYY-MM-DD
// owner: unowned
// follow-up: tasks/todo.md TI-001
// review_after: YYYY-MM-DD (30 days from date)
```

Replace `YYYY-MM-DD` with the actual ISO date. All four fields are mandatory per R-M1; the Phase 6 documentation audit will fail any quarantine missing one.

- [ ] **Step 3: Commit**

```bash
git add scripts/__tests__/build-code-graph-watcher.test.ts tasks/todo.md vitest.config.ts
git commit -m "test(vitest-migration): scaffold vitest.config and pre-emptively quarantine build-code-graph-watcher (Phase 1, R-M6, I-6)"
```

### Task 1.4: Add the `test:unit:vitest` script entry

**Files:**
- Modify: `package.json` (scripts)

- [ ] **Step 1: Add the entry**

Add to the `scripts` block of `package.json`, immediately after `"test:unit"`:

```json
"test:unit:vitest": "vitest run"
```

Do NOT touch the existing `"test:unit": "bash scripts/run-all-unit-tests.sh"`. The two runners coexist until Phase 5.

- [ ] **Step 2: Verify both runners are wired**

```bash
npm run test:unit -- --help 2>&1 | head -3
npm run test:unit:vitest -- --help 2>&1 | head -3
```

Expected: the first prints bash-runner usage (or the unit runner's own help), the second prints Vitest's CLI help.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "test(vitest-migration): add test:unit:vitest script (Phase 1)"
```

### Task 1.5: First Vitest discovery run (no test conversions yet)

**Files:** none modified.

- [ ] **Step 1: Run Vitest in discovery + execute mode**

```bash
npm run test:unit:vitest 2>&1 | tee /tmp/vitest-phase1-first-run.log
```

Expected outcomes:
- All 277 files are discovered (275 + 2 outliers).
- Many files will FAIL at this stage:
  - **Handwritten files** (`function test(name, fn)` pattern): Vitest sees zero registered tests because the file defines its own runner. These FAIL or are empty — expected.
  - **`node:test` files**: import `test` from `'node:test'`, not from `'vitest'`, so Vitest has no registered tests for them either — also expected.
  - Both categories surface inline `process.exit(1)` summary blocks as failures.
- This is acceptable. Phase 1 only verifies *discovery*, not *execution parity*. The dual-run consistency check (I-4) starts in Phase 2.

If the run fails with import-resolution errors (R-M3), fix them per-file as they surface. Common shape: a `.ts` file imported with no extension; add the `.js` suffix per the codebase convention.

If the run fails with module-load env errors (R-M2), add the missing variable to the `env` block in `vitest.config.ts` with a throwaway value. Record each addition in `tasks/builds/vitest-migration/progress.md`.

**TypeScript pipeline check (Vitest ≠ tsx):** Vitest uses its own ESBuild-based TypeScript transformer, which may have different strictness than `tsx`. After this run, verify no new type errors appear:

```bash
npx tsc --noEmit 2>&1 | head -40
```

If errors appear that did NOT exist before this phase (compare against `main` with `git stash` if needed), investigate whether they are caused by `vitest.config.ts`'s TypeScript settings. Adjust the `esbuild` block in `vitest.config.ts` if needed. Do not proceed to Phase 2 with unresolved TS errors.

- [ ] **Step 2: Persist the discovery baseline**

```bash
mkdir -p tasks/builds/vitest-migration
npx vitest list --reporter=json > tasks/builds/vitest-migration/vitest-discovery-baseline.json
```

The output is a per-file array of registered test names. This is the I-3a authoritative baseline — every subsequent count check compares against it.

- [ ] **Step 3: Sanity-check the discovery file count**

```bash
node -e 'const d = JSON.parse(require("fs").readFileSync("tasks/builds/vitest-migration/vitest-discovery-baseline.json", "utf8")); const files = new Set(); (Array.isArray(d) ? d : d.files || []).forEach(e => files.add(e.file || e.path || e.filepath)); console.log("Vitest sees", files.size, "files");'
```

Expected: `277`. If lower:
- Compare the file list against `docs/pre-migration-test-snapshot.json` to find the missing files.
- Most likely cause: `vitest.config.ts`'s `include` pattern misses a directory. Fix the pattern, re-run, confirm 277.
- Do not commit the baseline JSON if the count is wrong — the I-3a oracle would be permanently miscalibrated.

- [ ] **Step 4: Commit the baseline**

```bash
git add tasks/builds/vitest-migration/vitest-discovery-baseline.json
git commit -m "test(vitest-migration): capture Vitest discovery baseline 277 files (Phase 1, I-3a)"
```

### Task 1.6: Author the fixture inventory

**Files:**
- Create: `docs/test-fixtures-inventory.md`

- [ ] **Step 1: Identify shared fixture modules**

Search for files that match the fixture pattern (under `__tests__/fixtures/` or imported by ≥2 test files):

```bash
find . -type d -name fixtures -not -path "*/node_modules/*" -not -path "*/dist/*" 2>/dev/null
```

The spec's known floor is three modules:
- `server/services/__tests__/fixtures/loadFixtures.ts`
- `server/services/__tests__/fixtures/fakeWebhookReceiver.ts`
- `server/services/__tests__/fixtures/fakeProviderAdapter.ts`

For each, list importers:

```bash
grep -rl "from.*loadFixtures" --include="*.ts" .
grep -rl "from.*fakeWebhookReceiver" --include="*.ts" .
grep -rl "from.*fakeProviderAdapter" --include="*.ts" .
```

- [ ] **Step 2: Write the inventory**

Create `docs/test-fixtures-inventory.md` with one entry per fixture. Use this exact shape:

```markdown
# Test fixtures inventory

Shared test utilities used by ≥2 test files in the unit layer. Generated
during Phase 1 of the Vitest migration; updated whenever a new shared
fixture is introduced.

## server/services/__tests__/fixtures/loadFixtures.ts

Returns a stable `Fixtures` object: 1 org, 2 subaccounts, 1 agent, 2 links,
1 task, 1 user, 3 review-code methodology output samples.

Importers:
- (list each file from the grep above)

## server/services/__tests__/fixtures/fakeWebhookReceiver.ts

Boots a localhost HTTP server on an OS-assigned port (parallel-safe by
construction). Records every request. Supports overrides for status,
latency, drop-connection.

Importers:
- (list each file)

## server/services/__tests__/fixtures/fakeProviderAdapter.ts

Produces an LLM provider adapter with response / error / latency overrides.
Registers via `registerProviderAdapter` with a `restore()`-in-finally
contract. R-M1 suspect: global registry mutation.

Importers:
- (list each file)
```

If `find` surfaces additional `fixtures/` directories (for example under `server/lib/__tests__/`), add a section per fixture using the same shape.

- [ ] **Step 3: Commit**

```bash
git add docs/test-fixtures-inventory.md
git commit -m "docs(vitest-migration): add test fixture inventory (Phase 1)"
```

### Task 1.7: Run the test-count parity check

**Files:**
- Create: `tasks/builds/vitest-migration/test-count-parity.md`

- [ ] **Step 1: Compute per-file deltas between Vitest discovery and grep**

Generate the parity report inline:

```bash
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";

const grep = JSON.parse(readFileSync("docs/pre-migration-test-snapshot.json", "utf8"));
const vitest = JSON.parse(readFileSync("tasks/builds/vitest-migration/vitest-discovery-baseline.json", "utf8"));

const grepMap = new Map(grep.map(e => [e.file, e.testCount]));
const vitestMap = new Map();
const entries = Array.isArray(vitest) ? vitest : vitest.files || [];
for (const e of entries) {
  const path = (e.file || e.path || e.filepath || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!path) continue;
  const tests = e.tasks || e.tests || [];
  vitestMap.set(path, tests.length);
}

const all = new Set([...grepMap.keys(), ...vitestMap.keys()]);
let match = 0, delta = 0, mismatch = 0;
const lines = [];
for (const f of [...all].sort()) {
  const g = grepMap.get(f) ?? 0;
  const v = vitestMap.get(f) ?? 0;
  let status;
  if (g === v) { status = "MATCH"; match++; }
  else if (g === 0 && v > 0) { status = "OUTLIER (Vitest only)"; delta++; }
  else if (Math.abs(g - v) <= Math.max(1, g * 0.1)) { status = "WHITELISTED DELTA"; delta++; }
  else { status = "MISMATCH"; mismatch++; }
  lines.push(`${f}\tgrep:${g}\tvitest:${v}\t${status}`);
}

const out =
  `# Test-count parity (Phase 1)\n\n` +
  `Compares grep-derived testCount (docs/pre-migration-test-snapshot.json)\n` +
  `against Vitest discovery (tasks/builds/vitest-migration/vitest-discovery-baseline.json).\n\n` +
  `Summary: MATCH=${match}, DELTA/OUTLIER=${delta}, MISMATCH=${mismatch}\n\n` +
  `## Per-file\n\n` +
  lines.join("\n") + "\n";

writeFileSync("tasks/builds/vitest-migration/test-count-parity.md", out);
console.log(`MATCH=${match}, DELTA=${delta}, MISMATCH=${mismatch}`);
'
```

- [ ] **Step 2: Triage MISMATCH entries**

Open `test-count-parity.md`. For each `MISMATCH` line, name the cause inline (replace `MISMATCH` with `WHITELISTED DELTA: <reason>`). Common benign causes:
- Nested `test()` inside `describe()` (grep sees both, Vitest counts only registered tests).
- Conditionally registered tests behind `if (...) test(...)`.
- Helper wrappers that internally call `test()`.

If the cause is not benign (e.g. a file that grep says has tests but Vitest sees zero), STOP. The discovery `include` pattern likely misses the file — fix `vitest.config.ts` and re-run Task 1.5 step 2 + Task 1.7.

Phase 1 is not complete until every line is `MATCH`, `WHITELISTED DELTA`, or `OUTLIER (Vitest only)`. Zero `MISMATCH` rows allowed.

- [ ] **Step 3: Commit**

```bash
git add tasks/builds/vitest-migration/test-count-parity.md
git commit -m "test(vitest-migration): record Phase 1 test-count parity (I-3a + I-3b)"
```

### Task 1.8: Verify the bash runner is still intact

**Files:** none modified.

- [ ] **Step 1: Run the bash runner directly**

```bash
bash scripts/run-all-unit-tests.sh 2>&1 | tail -5
echo "exit: $?"
```

Expected: `exit: 0`. Phase 1 only added `vitest.config.ts` and a new script entry; the bash runner and all test files are untouched.

- [ ] **Step 2: Update progress doc and commit**

Append to `tasks/builds/vitest-migration/progress.md`:

```markdown
- YYYY-MM-DD: Phase 1 complete. Vitest discovers 277 files in single-fork mode.
  Parity check: MATCH=<n>, DELTA=<n>, MISMATCH=0. Bash runner unchanged.
  Quarantine: build-code-graph-watcher.test.ts (TI-001).
  TypeScript pipeline: no new errors vs baseline.
```

```bash
git add tasks/builds/vitest-migration/progress.md
git commit -m "test(vitest-migration): Phase 1 complete — Vitest scaffolded, discovery baseline locked (I-3a)"
```

### Phase 1 exit gate

- `vitest.config.ts` exists with single-fork pool and pre-emptive quarantine override.
- `npm run test:unit:vitest` discovers all 277 files.
- `tasks/builds/vitest-migration/vitest-discovery-baseline.json` is committed (I-3a baseline).
- `tasks/builds/vitest-migration/test-count-parity.md` shows zero MISMATCH rows.
- `docs/test-fixtures-inventory.md` enumerates every shared fixture.
- `bash scripts/run-all-unit-tests.sh` still exits zero.
- `npx tsc --noEmit` shows no new errors vs the pre-migration baseline.
- `tasks/todo.md` has the TI-001 entry for `build-code-graph-watcher.test.ts`.
- **Rebase check:** `git diff <phase0-sha>..HEAD --name-only -- '*.test.ts'` returns empty (no test files drifted during Phase 1).

---

## 5. Phase 2: `node:test` migration (~52 files)

Convert the 52 files using `node:test` + `node:assert/strict` to Vitest. The conversion is largely mechanical because Vitest's `test()` API matches `node:test`'s signature.

### Task 2.1: Build the Phase 2 file list

**Files:**
- Create: `tasks/builds/vitest-migration/phase2-files.txt`

- [ ] **Step 1: Generate the file list deterministically**

```bash
mkdir -p tasks/builds/vitest-migration
grep -rl --include="*.test.ts" "from ['\"]node:test['\"]" \
  --exclude-dir=node_modules --exclude-dir=dist \
  --exclude-dir=tools --exclude-dir=worker \
  | sort > tasks/builds/vitest-migration/phase2-files.txt

wc -l tasks/builds/vitest-migration/phase2-files.txt
```

Expected: `52`. If the count differs from the spec's stated 52:
- A new `node:test` file may have landed since the spec was written. Add it to the list and proceed.
- A `node:test` file may have already been migrated. Note in `progress.md` and adjust the total.
- Do not silently accept a different count — record the divergence.

- [ ] **Step 2: Split into batches of 10**

```bash
split -l 10 -d --additional-suffix=.txt \
  tasks/builds/vitest-migration/phase2-files.txt \
  tasks/builds/vitest-migration/phase2-batch-
ls tasks/builds/vitest-migration/phase2-batch-*.txt
```

Expected: 6 files, `phase2-batch-00.txt` through `phase2-batch-05.txt` (the last has 2 files since 52 = 5 × 10 + 2).

- [ ] **Step 3: Commit**

```bash
git add tasks/builds/vitest-migration/phase2-files.txt tasks/builds/vitest-migration/phase2-batch-*.txt
git commit -m "test(vitest-migration): enumerate Phase 2 node:test file list (52 files, 6 batches)"
```

**Batch file immutability:** Once committed, batch files are immutable. Do not edit them mid-run to add, remove, or reorder files. If the split needs correction, create a new set of batch files and commit them before running any batch. `check-batch.sh` enforces this — it will stop if the batch file has uncommitted changes.

### Task 2.2: Initialize the dual-run consistency log and escalations file

**Files:**
- Create: `tasks/builds/vitest-migration/dual-run-consistency.md`
- Create: `tasks/builds/vitest-migration/escalations.md`

- [ ] **Step 1: Seed the dual-run log**

```markdown
# Dual-run consistency (Phases 2 and 3)

Compares per-file outcomes between the bash runner (`bash scripts/run-all-unit-tests.sh`)
and Vitest (`npx vitest run <files...>`) for every batch in Phases 2 and 3.

Format: one line per file per batch.
`<path> bash:<pass|fail|skip> vitest:<pass|fail|skip> match:<yes|no>`

Spot-checks (I-4b): `spot-check: <file>::<test-name> verified`.

## Phase 2

(populated per batch)

## Phase 3

(populated per batch)

## Phase 3 final global comparison

(populated at end of Phase 3 per § 4 Phase 3 deliverable 10)
```

Write to `tasks/builds/vitest-migration/dual-run-consistency.md`.

- [ ] **Step 2: Seed the escalations log**

```markdown
# Phase 2/3 escalations (migration-fatigue friction point)

Per spec § 4 Phase 2 deliverable 7's "migration-fatigue rule": any batch
that introduces a WHITELISTED DELTA in test-count parity OR an unresolved
dual-run mismatch MUST stop and surface to the user before the next batch.

**Hard cap: 5 entries combined across Phases 2 and 3.** If this file
exceeds 5 entries, the executing session pauses and surfaces the running
list to the user with the systemic question: "is the conversion plan
sound, or is something repeatedly going wrong?"

Format per entry:
- Date, batch ID
- File(s) affected
- What was whitelisted or what mismatched
- Why
- User acknowledgement (timestamp + decision)

(empty)
```

Write to `tasks/builds/vitest-migration/escalations.md`.

- [ ] **Step 3: Commit**

```bash
git add tasks/builds/vitest-migration/dual-run-consistency.md tasks/builds/vitest-migration/escalations.md
git commit -m "test(vitest-migration): seed dual-run and escalations logs (Phase 2 prep, I-4)"
```

### Task 2.3: Convert Batch 0 (10 files) — canonical batch loop

This task is the template. Tasks 2.4–2.8 repeat the same loop for batches 1–5; for those, follow the same steps with the appropriate batch file.

**Automation shortcut:** After completing steps 2–5 (conversion + process.exit triage + env assertions), run `scripts/check-batch.sh` to execute the verification + logging steps automatically:

```bash
bash scripts/check-batch.sh tasks/builds/vitest-migration/phase2-batch-00.txt phase2
```

The script covers steps 1, 5, 5a, 6, 7a, 7b (RE-RUN detection, Vitest run, 0-test check, legacy grep, dual-run comparison, escalations cap check). If it exits 0, the batch is safe to commit. Steps 7 (spot-check) and 8 (commit) are still manual.

**Files:**
- Modify: 10 `*.test.ts` files listed in `tasks/builds/vitest-migration/phase2-batch-00.txt`
- Modify: `tasks/builds/vitest-migration/dual-run-consistency.md` (append batch results)

- [ ] **Step 1: Capture pre-batch bash-runner outcomes**

For each file in the batch, the Phase 0 JSON snapshot is the baseline IF the file has not been edited since Phase 0. Use the SHA recorded in `tasks/builds/vitest-migration/progress.md` `## Environment`:

```bash
PHASE0_SHA=$(grep "Phase 0 baseline commit SHA" tasks/builds/vitest-migration/progress.md | awk '{print $NF}')
for f in $(cat tasks/builds/vitest-migration/phase2-batch-00.txt); do
  if [ -n "$(git rev-list "${PHASE0_SHA}..HEAD" -- "$f" 2>/dev/null)" ]; then
    echo "RE-RUN NEEDED: $f"
  fi
done
```

If any file shows `RE-RUN NEEDED`, run the bash runner against just those files and capture per-file outcomes. Otherwise, read pre-batch outcomes from `docs/pre-migration-test-snapshot.json`.

- [ ] **Step 2: Apply the mechanical conversion to each file**

For each file in the batch, perform the conversions per spec § 4 Phase 2 deliverables 2–6. Reference tables (verbatim from spec):

**Imports:**

| Before | After |
|--------|-------|
| `import test from 'node:test'` | `import { test } from 'vitest'` |
| `import { test } from 'node:test'` | `import { test } from 'vitest'` |
| `import assert from 'node:assert/strict'` | `import { expect } from 'vitest'` |
| `import { strict as assert } from 'node:assert'` | `import { expect } from 'vitest'` |
| `import { mock } from 'node:test'` | `import { vi } from 'vitest'` |
| `import { beforeEach, afterEach, describe } from 'node:test'` | `import { beforeEach, afterEach, describe } from 'vitest'` |

**Assertion conversion table (full, from spec § 4 Phase 2 deliverable 3):**

| `node:assert` | Vitest |
|---------------|--------|
| `assert(x, msg)` | `expect(x, msg).toBeTruthy()` |
| `assert.ok(x)` | `expect(x).toBeTruthy()` |
| `assert.equal(a, b)` | `expect(a).toBe(b)` |
| `assert.strictEqual(a, b)` | `expect(a).toBe(b)` |
| `assert.notEqual(a, b)` | `expect(a).not.toBe(b)` |
| `assert.notStrictEqual(a, b)` | `expect(a).not.toBe(b)` |
| `assert.deepEqual(a, b)` | `expect(a).toEqual(b)` |
| `assert.deepStrictEqual(a, b)` | `expect(a).toStrictEqual(b)` |
| `assert.notDeepEqual(a, b)` | `expect(a).not.toEqual(b)` |
| `assert.notDeepStrictEqual(a, b)` | `expect(a).not.toStrictEqual(b)` |
| `assert.throws(fn)` | `expect(fn).toThrow()` |
| `assert.throws(fn, /regex/)` | `expect(fn).toThrow(/regex/)` |
| `assert.throws(fn, ErrorClass)` | `expect(fn).toThrow(ErrorClass)` |
| `assert.doesNotThrow(fn)` | `expect(fn).not.toThrow()` |
| `assert.rejects(promise)` | `await expect(promise).rejects.toThrow()` |
| `assert.rejects(promise, /regex/)` | `await expect(promise).rejects.toThrow(/regex/)` |
| `assert.doesNotReject(promise)` | `await expect(promise).resolves.not.toThrow()` |
| `assert.match(str, /regex/)` | `expect(str).toMatch(/regex/)` |
| `assert.notMatch(str, /regex/)` | `expect(str).not.toMatch(/regex/)` |
| `assert.fail(msg)` | `expect.fail(msg)` |
| `assert.ifError(err)` | `if (err) throw err` |

**Mock translation:**

| `node:test` mock | Vitest |
|------------------|--------|
| `mock.method(obj, 'key', impl)` | `vi.spyOn(obj, 'key').mockImplementation(impl)` |
| `mock.fn()` | `vi.fn()` |
| `mock.fn(impl)` | `vi.fn(impl)` |
| `(fn as any).mock.calls` | `(fn as any).mock.calls` (same shape) |
| `mock.restoreAll()` | `vi.restoreAllMocks()` |
| `t.mock.method(...)` (test-scoped) | `vi.spyOn(...)` + `afterEach(() => vi.restoreAllMocks())` |

**Skip-gate translation:**

| Pattern | Vitest replacement |
|---------|-------------------|
| `if (SKIP) { console.log(...); process.exit(0); }` at top of file | Wrap entire file's tests in `describe.skipIf(SKIP)('...', () => { ... })` |
| `test('name', { skip: SKIP }, fn)` | `test.skipIf(SKIP)('name', fn)` |
| `if (!process.env.DATABASE_URL) { process.exit(0); }` | `const SKIP = !process.env.DATABASE_URL;` then wrap tests in `describe.skipIf(SKIP)(...)` |

The dynamic-import-after-skip-check pattern is preserved unchanged: imports happen inside `test()` bodies, not at module top-level.

- [ ] **Step 3: Per-file `process.exit` triage (spec § 4 Phase 2 deliverable 8)**

For each file in the batch, grep for `process.exit` BEFORE editing:

```bash
for f in $(cat tasks/builds/vitest-migration/phase2-batch-00.txt); do
  grep -Hn "process\.exit" "$f" || true
done
```

For each match, classify and act:

- `process.exit(0)` after a skip-gate condition (top of file) → convert per the skip-gate table above.
- `process.exit(1)` in a trailing summary block (`if (failed > 0) process.exit(1)`) → delete entirely. Vitest reports failures itself.
- `process.exit(0)` or `process.exit(1)` in any other position (mid-test, inside a callback) → STOP. Do not auto-convert. Flag for manual review under R-M4's side-effect invariant. Either rewrite to confine the early exit to a single test body or quarantine under R-M1's contract (write a TI-NNN follow-up in `tasks/todo.md`).

- [ ] **Step 4: Per-file env-absence assertion (I-8a)**

For each file in the batch, grep for branches on env-var absence:

```bash
for f in $(cat tasks/builds/vitest-migration/phase2-batch-00.txt); do
  grep -Hn "process\.env\.\w\+ === undefined\|!process\.env\." "$f" || true
done
```

For each match, add an explicit `expect(process.env.X).toBeUndefined()` assertion at the top of the relevant test (or in `beforeAll`) so the dependency is documented per I-8a.

- [ ] **Step 5: Run Vitest on the converted batch**

```bash
npx vitest run $(cat tasks/builds/vitest-migration/phase2-batch-00.txt | tr '\n' ' ') 2>&1 | tee /tmp/vitest-phase2-batch-00.log
```

Every file must pass. If any fails:
- Diagnose: most failures at this stage are conversion bugs (wrong matcher, missing `await` on `rejects.toThrow`).
- Fix and re-run.
- Do not commit a batch with any failing file.

The raw log at `/tmp/vitest-phase2-batch-NN.log` is the per-batch observability artifact. Record the path in `progress.md` if any batch requires debugging later.

- [ ] **Step 5a: Hard check — no file may register 0 tests**

```bash
npx vitest list --reporter=json $(cat tasks/builds/vitest-migration/phase2-batch-00.txt | tr '\n' ' ') \
  | node -e '
    let s=""; process.stdin.on("data",c=>s+=c);
    process.stdin.on("end",()=>{
      const d=JSON.parse(s);
      const entries=Array.isArray(d)?d:d.files||[];
      const zeros=entries.filter(e=>(e.tasks||e.tests||[]).length===0);
      if(zeros.length>0){
        console.error("HARD STOP: files with 0 registered tests:", zeros.map(e=>e.file||e.path).join(", "));
        process.exit(1);
      }
      console.log("all files register >0 tests");
    });
  '
```

Any file with 0 registered tests after conversion is a silent test loss — one of the most common migration bugs. STOP and investigate before continuing. Common causes: leftover `function test(...)` shadowing the Vitest import, or a file still using `node:test` imports that slipped through.

- [ ] **Step 6: Per-batch dual-run consistency check (I-4a)**

For each file, compare bash outcome (Step 1) against Vitest outcome (Step 5). Append to `tasks/builds/vitest-migration/dual-run-consistency.md` under `## Phase 2` with one line per file:

```text
### Phase 2 batch 0 (YYYY-MM-DD)
<path> bash:pass vitest:pass match:yes
... (one line per file)
```

**Mismatch rules:** Any of the following is `match:no` and requires investigation before the batch commits:
- `bash:pass` → `vitest:fail`
- `bash:fail` → `vitest:pass` (conversion changed semantics)
- `bash:skip` → `vitest:pass` (skip condition dropped)
- `bash:skip` → `vitest:fail` (skip condition dropped AND conversion broken)
- `bash:pass` → `vitest:skip` (unexpected skip introduced)

Only `pass↔pass`, `fail↔fail`, and `skip↔skip` are valid `match:yes`.

- [ ] **Step 7: Deep-equality spot-check (I-4b)**

If this batch converted any of `assert.deepEqual` → `toEqual`, `assert.deepStrictEqual` → `toStrictEqual`, or `assert.throws(fn, /regex/)` → `toThrow(/regex/)`, pick at least one converted assertion and:

1. Note the original assertion location.
2. Deliberately break the asserted value (add a stray field, change a number, mutate the regex). Make the change in your working tree, do not commit it.
3. Run `npx vitest run <that-file>` and confirm it fails with a meaningful diff.
4. Revert the deliberate break.
5. Append to the dual-run log: `spot-check: <file>::<test-name> verified`.

If the test still passes despite the deliberate break, the conversion silently weakened the assertion. Investigate and fix.

- [ ] **Step 7a: Grep gate — no legacy patterns may survive**

```bash
for f in $(cat tasks/builds/vitest-migration/phase2-batch-00.txt); do
  if grep -qE "from ['\"]node:test['\"]|from ['\"]node:assert" "$f"; then
    echo "LEGACY IMPORT: $f"
  fi
done
```

Expected: no output. If any file still has `node:test` or `node:assert` imports, the conversion was incomplete. Fix before committing.

- [ ] **Step 7b: Check escalations cap BEFORE committing**

If any file in the batch produced an escalation (whitelisted parity delta, unresolved dual-run mismatch, or file routed to `tasks/todo.md` for R-M4 manual review), append the entry to `tasks/builds/vitest-migration/escalations.md` NOW, before committing. Check the count:

```bash
grep -c "^- " tasks/builds/vitest-migration/escalations.md || echo 0
```

If the count exceeds 5 (combined across Phases 2 and 3), STOP — surface the running list to the user with the systemic question: "Is the conversion plan sound, or is something repeatedly going wrong?" Do not commit until acknowledged.

- [ ] **Step 8: Commit the batch**

```bash
git add $(cat tasks/builds/vitest-migration/phase2-batch-00.txt | tr '\n' ' ') tasks/builds/vitest-migration/dual-run-consistency.md tasks/builds/vitest-migration/escalations.md
git commit -m "test: migrate 10 node:test files to vitest (Phase 2 batch 0/5, I-4)"
```

### Tasks 2.4 to 2.8: Convert Batches 1–5

Repeat Task 2.3's full loop (steps 1–8) for each remaining batch:

- [ ] **Task 2.4:** Batch 1 (`phase2-batch-01.txt`)
- [ ] **Task 2.5:** Batch 2 (`phase2-batch-02.txt`)
- [ ] **Task 2.6:** Batch 3 (`phase2-batch-03.txt`)
- [ ] **Task 2.7:** Batch 4 (`phase2-batch-04.txt`)
- [ ] **Task 2.8:** Batch 5 (`phase2-batch-05.txt`, final batch — 2 files)

Each batch is its own commit. Reference the I-4 invariant in commit messages.

After each batch: check `tasks/builds/vitest-migration/escalations.md`. If it exceeds 5 entries (combined across Phases 2 and 3), STOP per spec § 4 Phase 2 deliverable 1's escalation upper bound — surface to user with the systemic question.

### Task 2.9: Phase 2 exit verification

**Files:** none modified.

- [ ] **Step 1: Run Vitest against all Phase 2 files**

```bash
npx vitest run $(cat tasks/builds/vitest-migration/phase2-files.txt | tr '\n' ' ')
```

Expected: every file passes. Total registered tests should be approximately the sum of pre-conversion testCounts for these 52 files.

- [ ] **Step 2: Verify zero `process.exit` survivors**

```bash
for f in $(cat tasks/builds/vitest-migration/phase2-files.txt); do
  if grep -q "process\.exit" "$f"; then
    echo "SURVIVOR: $f"
  fi
done
```

Expected: no output. Any surviving `process.exit` should already be a documented quarantine (`tasks/todo.md` entry + `// @vitest-isolate` comment with the four-field contract). Cross-check survivors against the quarantine list.

- [ ] **Step 3: Verify zero `node:test` imports survive**

```bash
for f in $(cat tasks/builds/vitest-migration/phase2-files.txt); do
  if grep -q "from ['\"]node:test['\"]\|from ['\"]node:assert" "$f"; then
    echo "NOT MIGRATED: $f"
  fi
done
```

Expected: no output.

- [ ] **Step 4: Update progress doc**

Append to `tasks/builds/vitest-migration/progress.md`:

```markdown
- YYYY-MM-DD: Phase 2 complete. 52 node:test files migrated across 6 batches.
  Dual-run consistency: <n> match:yes / 0 match:no.
  Escalations: <n>/5 (cap is 5).
  Quarantines added in this phase: <list TI-NNN entries or "none">.
```

```bash
git add tasks/builds/vitest-migration/progress.md
git commit -m "test(vitest-migration): Phase 2 complete — node:test migration, all 52 files green under Vitest"
```

### Phase 2 exit gate

- All ~52 `node:test` files pass under `test:unit:vitest` in single-fork mode.
- Each batch landed as a separate, mechanical commit; diff is reviewable.
- Dual-run consistency log shows `match:yes` for every file (I-4a) plus at least one I-4b spot-check per batch where applicable.
- `process.exit(0)` and `process.exit(1)` are gone from every converted file (or the file is documented as quarantined).
- `node:test` and `node:assert` imports are gone from every converted file.
- Escalations log is at or below 5 entries; user has acknowledged each.

---

## 6. Phase 3: Handwritten harness migration (~215 files + 2 outliers)

The largest phase. ~215 files use the handwritten `function test(...)` + custom `assert` / `assertEqual` pattern. Plus the two outliers (`parseContextSwitchCommand.test.ts`, `scopeResolutionService.test.ts`) which have NO `test()` wrapper at all — they need wrapping per R-M8 before they produce valid Vitest tests.

### Task 3.1: Build the Phase 3 file list

**Files:**
- Create: `tasks/builds/vitest-migration/phase3-files.txt`

- [ ] **Step 1: Generate the handwritten file list**

The handwritten pattern is identified by `function test(` declared in the file (the file defines its own runner). Phase 2 already removed all `node:test` files; the remaining `*.test.ts` files in the unit layer are either handwritten-pattern or already-Vitest (none are; Phase 2 didn't touch the handwritten ones).

```bash
# All test files in unit-layer scope
find . -name "*.test.ts" \
  -not -path "*/node_modules/*" -not -path "*/dist/*" \
  -not -path "*/tools/*" -not -path "*/worker/*" \
  | sort > /tmp/all-test-files.txt

# Exclude Phase 2 files (already migrated)
sort tasks/builds/vitest-migration/phase2-files.txt > /tmp/phase2-sorted.txt
comm -23 /tmp/all-test-files.txt /tmp/phase2-sorted.txt \
  > tasks/builds/vitest-migration/phase3-files.txt

wc -l tasks/builds/vitest-migration/phase3-files.txt
```

Expected: ~217 (215 handwritten + 2 outliers). Match against the spec's stated 277 - 52 = 225, then minus already-Vitest files (none expected) = ~217 (the spec says ~215 handwritten + 2 outliers = 217). If the count differs by more than ±5, investigate before proceeding.

- [ ] **Step 2: Split into batches of 10**

```bash
split -l 10 -d --additional-suffix=.txt \
  tasks/builds/vitest-migration/phase3-files.txt \
  tasks/builds/vitest-migration/phase3-batch-
ls tasks/builds/vitest-migration/phase3-batch-*.txt | wc -l
```

Expected: ~22 batches.

- [ ] **Step 3: Move the two outliers to the LAST batch**

The outliers need special wrapping (R-M8) and should not block the mechanical conversion of the bulk. Open the last batch file and verify it contains:
- `shared/lib/parseContextSwitchCommand.test.ts`
- `server/services/scopeResolutionService.test.ts`

If they ended up in earlier batches, manually relocate them into the final batch (and pad earlier batches if needed). Commit the file split.

```bash
git add tasks/builds/vitest-migration/phase3-files.txt tasks/builds/vitest-migration/phase3-batch-*.txt
git commit -m "test(vitest-migration): enumerate Phase 3 handwritten file list (~217 files, ~22 batches)"
```

**Batch file immutability:** Same rule as Phase 2 — batch files are immutable once committed. `check-batch.sh` will stop if a batch file has uncommitted changes.

### Task 3.2: Convert one Phase 3 batch — canonical loop

This task is the template. The batch loop is the same as Phase 2's Task 2.3 with three additions.

**Automation shortcut:** After completing steps 2–4 (conversion, process.exit triage, env assertions), run:

```bash
bash scripts/check-batch.sh tasks/builds/vitest-migration/phase3-batch-NN.txt phase3
```

The script covers steps 1, 6, 6a, 7, 8a, 8b. If it exits 0, the batch is safe to commit. Steps 4b (test naming audit), 5 (manual review list), 8 (spot-check), 9 (integration side-effect grep), and 10 (commit) are still manual.

1. The conversion shape changes (delete handwritten harness, add Vitest imports).
2. Worked example below.
3. Manual review list captures non-mechanical files.

**Files (per batch):**
- Modify: 10 `*.test.ts` files listed in `tasks/builds/vitest-migration/phase3-batch-NN.txt`
- Modify: `tasks/builds/vitest-migration/dual-run-consistency.md`

- [ ] **Step 1: Capture pre-batch bash-runner outcomes**

Same as Phase 2 Task 2.3 step 1 — read from `docs/pre-migration-test-snapshot.json` IF the file is unchanged since Phase 0; otherwise run the bash runner against just the batch.

- [ ] **Step 2: Apply the standard handwritten conversion to each file**

For each file in the batch:

**Delete:**
- The `let passed = 0; let failed = 0` counters at the top of the file.
- The handwritten `function test(name: string, fn: () => void) { ... }` declaration.
- The handwritten `function assert(cond: unknown, message: string) { ... }` and any `function assertEqual<T>(...)` declarations.
- Any custom `function runTest(...)`, `function assertFailedWithRule(...)`, etc. Note these in the manual review list (Step 5) — they may need per-call inlining or extraction into a shared helper.
- The trailing `console.log(...)` summary block.
- The trailing `if (failed > 0) process.exit(1);` line.

**Add (at top, after any leading comments):**
```ts
import { test, expect } from 'vitest';
```

If the file uses `describe`/`beforeAll`/`afterAll`/`beforeEach`/`afterEach`, add them to the import.

**Per-call replacement:**

| Handwritten | Vitest |
|-------------|--------|
| `assert(cond, msg)` | `expect(cond, msg).toBeTruthy()` |
| `assertEqual(actual, expected, label)` | `expect(actual).toEqual(expected)` (use `toStrictEqual` only if the original needed prototype-strict equality; default is `toEqual` because the handwritten helper uses JSON-stringify deep equality which treats undefined as missing) |
| `assertEqual<T>(actual, expected, label)` | `expect(actual).toEqual(expected)` (same default) |

**Worked example** (verbatim from spec § 4 Phase 3 deliverable 3):

Before:
```ts
import { processContextPool } from '../runContextLoaderPure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

test('processes an empty pool', () => {
  const result = processContextPool([], { maxTokens: 1000 });
  assertEqual(result.eager.length, 0, 'no eager sources');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

After:
```ts
import { test, expect } from 'vitest';
import { processContextPool } from '../runContextLoaderPure.js';

test('processes an empty pool', () => {
  const result = processContextPool([], { maxTokens: 1000 });
  expect(result.eager.length).toBe(0);
});
```

(Note: `assertEqual(result.eager.length, 0, ...)` translates to `expect(result.eager.length).toBe(0)` — `toBe` for primitives, `toEqual` for objects/arrays.)

- [ ] **Step 3: Per-file `process.exit` triage**

Same as Phase 2 Task 2.3 step 3. The handwritten harness almost always ends with `if (failed > 0) process.exit(1);` — this is the canonical "delete entirely" case. Mid-test `process.exit` calls require manual review and likely a TI-NNN follow-up.

- [ ] **Step 4: Per-file env-absence assertion (I-8a)**

Same as Phase 2 Task 2.3 step 4.

- [ ] **Step 4b: Test naming audit (per batch)**

For every `test(...)` call written or preserved in this batch, the name must describe observable behaviour, not implementation. Rename on sight:

| Reject | Replace with |
|--------|-------------|
| `'test 1'`, `'should work'`, `'test case A'` | `'returns empty array when pool has no sources'` |
| `'assertEqual works'` | `'strict equality check matches identical objects'` |
| `'processContextPool'` (function name only) | `'processContextPool trims overflowing sources to fit maxTokens'` |

This costs 30 seconds per file. A migration with 215 well-named tests beats one with 215 `'test 1..N'` entries.

- [ ] **Step 5: Manual review list**

Append to the batch's commit message body any file where the conversion was NOT mechanical. Examples to expect:

- Files with custom assertion helpers like `assertFailedWithRule(rule, fn)` — wrap in a local helper at the top of the converted file rather than expanding inline if used >2 times.
- Files with custom test wrappers like `runTest(name, opts, fn)` that take additional arguments (timeout, retries) — translate per the test wrapper's intent: `test(name, { timeout: opts.timeout }, fn)`.
- Files where the handwritten `test()` accepts an `async` function but the harness does not `await` it — this is an actual bug. Convert as a fix (not just a translation) and call this out in the commit message body.

The manual review list in the commit body is the audit trail for non-mechanical changes. Reviewers can audit those files specifically.

- [ ] **Step 6: Run Vitest on the converted batch**

```bash
npx vitest run $(cat tasks/builds/vitest-migration/phase3-batch-NN.txt | tr '\n' ' ') 2>&1 | tee /tmp/vitest-phase3-batch-NN.log
```

Every file must pass.

- [ ] **Step 6a: Hard check — no file may register 0 tests (same as Phase 2 Step 5a)**

```bash
npx vitest list --reporter=json $(cat tasks/builds/vitest-migration/phase3-batch-NN.txt | tr '\n' ' ') \
  | node -e '
    let s=""; process.stdin.on("data",c=>s+=c);
    process.stdin.on("end",()=>{
      const d=JSON.parse(s);
      const entries=Array.isArray(d)?d:d.files||[];
      const zeros=entries.filter(e=>(e.tasks||e.tests||[]).length===0);
      if(zeros.length>0){
        console.error("HARD STOP: 0-test files:", zeros.map(e=>e.file||e.path).join(", "));
        process.exit(1);
      }
      console.log("all files register >0 tests");
    });
  '
```

- [ ] **Step 7: Per-batch dual-run consistency check (I-4a)**

Same as Phase 2 Task 2.3 step 6, appending under `## Phase 3` in the dual-run log. The same mismatch rules apply: `skip→pass`, `skip→fail`, `pass→skip` are all `match:no` requiring investigation.

- [ ] **Step 8: Deep-equality spot-check (I-4b) when applicable**

Same as Phase 2 Task 2.3 step 7. The handwritten harness's `assertEqual` uses JSON-stringify deep equality; when converting to `toEqual`, spot-check at least one assertion per batch by deliberately breaking the asserted value.

- [ ] **Step 8a: Grep gate — no handwritten harness patterns may survive**

```bash
for f in $(cat tasks/builds/vitest-migration/phase3-batch-NN.txt); do
  if grep -qE "function test\(name|function assert\(cond|let passed = 0|let failed = 0" "$f"; then
    echo "LEGACY HARNESS: $f"
  fi
done
```

Expected: no output.

- [ ] **Step 8b: Check escalations cap BEFORE committing**

Same as Phase 2 Task 2.3 step 7b — check the count in `escalations.md` before the commit; stop if > 5.

- [ ] **Step 9: Integration-file side-effect grep (R-M4 enforcement)**

If the batch contains any `*.integration.test.ts` or `integration.test.ts` file, after rewriting the skip-gate scan for free-standing top-level statements:

```bash
for f in $(grep -E "integration\.test\.ts$" tasks/builds/vitest-migration/phase3-batch-NN.txt); do
  echo "=== $f ==="
  # Lines that aren't blank, comments, imports, declarations, or test wrappers
  grep -nv -E "^\s*$|^\s*(//|/\*|\*)|^(import |const |let |var |function |describe|test|beforeAll|beforeEach|afterAll|afterEach|export|interface |type |class )|^\s*\}" "$f" || true
done
```

Two cases:
- No flagged statements: pass.
- Any flagged statement: review individually. Confirmed-benign cases (cosmetic top-level `console.log`) are still moved into a `beforeAll` or deleted; goal is zero free-standing top-level statements per I-7a.

- [ ] **Step 10: Commit the batch**

```bash
git add $(cat tasks/builds/vitest-migration/phase3-batch-NN.txt | tr '\n' ' ') tasks/builds/vitest-migration/dual-run-consistency.md tasks/builds/vitest-migration/escalations.md
git commit -m "test: migrate 10 handwritten files to vitest (Phase 3 batch NN/M, I-4)

## Manual review

(list any non-mechanical conversions or 'none')
"
```

### Tasks 3.3 to 3.N: Convert all Phase 3 batches except the last (outliers)

Repeat Task 3.2's full loop for each `phase3-batch-NN.txt` except the final batch (which contains the outliers).

- [ ] **Tasks 3.3 to 3.(N-1):** Convert handwritten batches in order. Each batch is its own commit referencing I-4.

### Task 3.N: Convert the outlier batch (R-M8)

The two outliers (`parseContextSwitchCommand.test.ts`, `scopeResolutionService.test.ts`) require special handling.

**Files:**
- Modify: `shared/lib/parseContextSwitchCommand.test.ts`
- Modify: `server/services/scopeResolutionService.test.ts`
- Modify: `tasks/builds/vitest-migration/dual-run-consistency.md`

- [ ] **Step 1: Inspect each outlier**

```bash
cat shared/lib/parseContextSwitchCommand.test.ts
cat server/services/scopeResolutionService.test.ts
```

Both are top-level scripts that call `assert.deepStrictEqual` (or similar) directly with no `test()` wrapper.

- [ ] **Step 2: Wrap each top-level assertion block in a `test(...)` call**

For each file:

1. Add at the top: `import { test, expect } from 'vitest';`
2. Create **one `test()` per logical case** — not one test per file. If two adjacent assertions describe different scenarios (e.g. "valid input" vs "missing field"), they belong in two separate `test()` blocks. The first failing `expect` short-circuits a test; if all assertions are in one test, later failures are invisible.
3. Name each test after the observable behaviour: `'parses /switch <subaccount-slug> form'`, `'rejects malformed input with a descriptive error'`.
4. Convert each `assert.*` call per the Phase 2 assertion table.
5. Delete any trailing `console.log` / `process.exit` / counter cleanup.

Both files stay in their current location for now; Phase 6 moves them under `__tests__/`.

- [ ] **Step 3: Run Vitest on both outliers**

```bash
npx vitest run shared/lib/parseContextSwitchCommand.test.ts server/services/scopeResolutionService.test.ts
```

Both must pass and report `> 0` registered tests (their pre-conversion `testCount` was 0; now they have at least 1 each).

- [ ] **Step 4: Update the dual-run log**

Append under `## Phase 3` in `tasks/builds/vitest-migration/dual-run-consistency.md`:

```text
### Phase 3 batch N — outliers (YYYY-MM-DD)
shared/lib/parseContextSwitchCommand.test.ts bash:not-discovered vitest:pass match:N/A
server/services/scopeResolutionService.test.ts bash:not-discovered vitest:pass match:N/A
note: outliers were silently skipped by the bash runner pre-migration; Vitest now discovers them. R-M8 wrap is the migration's first execution of these tests.
```

- [ ] **Step 5: Commit**

```bash
git add shared/lib/parseContextSwitchCommand.test.ts server/services/scopeResolutionService.test.ts tasks/builds/vitest-migration/dual-run-consistency.md
git commit -m "test: wrap two outliers in test() blocks (Phase 3 final batch, R-M8, I-3a)"
```

### Task 3.N+1: End-of-phase global dual-run (I-4a, last cheap check before bash deletion)

**Files:**
- Modify: `tasks/builds/vitest-migration/dual-run-consistency.md` (append global comparison section)

- [ ] **Step 1: Run the bash runner against the full suite**

```bash
bash scripts/run-all-unit-tests.sh 2>&1 | tee /tmp/phase3-final-bash.log
```

- [ ] **Step 2: Run Vitest against the full suite with JSON reporter**

```bash
npx vitest run --reporter=json 2>/tmp/phase3-final-vitest-stderr.log > /tmp/phase3-final-vitest.json
echo "vitest exit: $?"
```

Using `--reporter=json` here is mandatory — the text reporter output is fragile to parse (encoding, symbol changes, locale). JSON is the deterministic source.

- [ ] **Step 3: Compare per-file outcomes across the full suite**

```bash
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";

const bashLog = readFileSync("/tmp/phase3-final-bash.log", "utf8");
const vitestJson = JSON.parse(readFileSync("/tmp/phase3-final-vitest.json", "utf8"));

const bashOutcomes = new Map();
for (const line of bashLog.split("\n")) {
  const m = line.match(/^(PASS|FAIL|SKIP)\s+(\S+\.test\.ts)\b/);
  if (m) bashOutcomes.set(m[2], m[1].toLowerCase());
}

// Parse Vitest JSON output deterministically
const vitestOutcomes = new Map();
for (const suite of vitestJson.testResults || []) {
  const file = (suite.name || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!file.endsWith(".test.ts")) continue;
  const hasFail = (suite.status === "failed") ||
    (suite.assertionResults || []).some(r => r.status === "failed");
  const allSkipped = (suite.assertionResults || []).every(r => r.status === "pending");
  vitestOutcomes.set(file, hasFail ? "fail" : allSkipped ? "skip" : "pass");
}

const allFiles = new Set([...bashOutcomes.keys(), ...vitestOutcomes.keys()]);
const lines = ["### Phase 3 final global comparison (YYYY-MM-DD)"];
let mismatch = 0;
let bashSkipCount = 0; let vitestSkipCount = 0;
for (const f of [...allFiles].sort()) {
  const b = bashOutcomes.get(f) ?? "not-discovered";
  const v = vitestOutcomes.get(f) ?? "not-discovered";
  if (b === "skip") bashSkipCount++;
  if (v === "skip") vitestSkipCount++;
  // Valid matches: pass↔pass, fail↔fail, skip↔skip, not-discovered→pass (outliers)
  const valid = (b === v) || (b === "not-discovered" && v === "pass");
  if (!valid) mismatch++;
  lines.push(`${f} bash:${b} vitest:${v} match:${valid ? "yes" : "no"}`);
}
lines.push("");
lines.push(`Summary: mismatches=${mismatch}, bash-skips=${bashSkipCount}, vitest-skips=${vitestSkipCount}`);
console.log(`mismatches: ${mismatch}, bash-skips: ${bashSkipCount}, vitest-skips: ${vitestSkipCount}`);
writeFileSync("/tmp/phase3-final-comparison.md", lines.join("\n") + "\n");
'
```

- [ ] **Step 3a: Skip rate check**

From the comparison output above, read `bash-skips` and `vitest-skips`. If `vitest-skips > bash-skips + 5`, STOP — skip logic was silently broadened during migration (env-var handling, `describe.skipIf` wrapping a wider scope than the original `if-exit`). Investigate the files with `vitest:skip` that had `bash:pass` and narrow the skip condition before continuing.

- [ ] **Step 4: Resolve any mismatch before continuing**

If `mismatches: 0` AND skip rate is acceptable (Step 3a), append the comparison to `tasks/builds/vitest-migration/dual-run-consistency.md` under `## Phase 3 final global comparison`. Phase 3 is complete.

If mismatches > 0, STOP. This is cross-file semantic drift accumulated across the phase — a test in one batch became silently dependent on a fixture mutation introduced in another. Investigate, fix, re-run the global comparison. Phase 3 is not complete until this comparison shows full match. **This is the last opportunity to catch bash-vs-Vitest divergence before the bash runner is deleted in Phase 5.**

- [ ] **Step 5: Re-run the test-count-parity check**

The two outliers now have `testCount > 0`. Re-run the parity script from Task 1.7 step 1, this time recording into a new section of `test-count-parity.md`:

```bash
# (re-use the inline node script from Task 1.7 step 1 but write to a temp file)
# Then append the output as a new section "## Phase 3 (post-outlier wrap)"
```

The total registered-test count must still match (modulo the outliers gaining `> 0`). Update `tasks/builds/vitest-migration/test-count-parity.md` and commit.

- [ ] **Step 6: Commit**

```bash
git add tasks/builds/vitest-migration/dual-run-consistency.md tasks/builds/vitest-migration/test-count-parity.md tasks/builds/vitest-migration/progress.md
git commit -m "test(vitest-migration): Phase 3 complete — handwritten + outliers migrated, global dual-run match (I-3a, I-4a)"
```

### Phase 3 exit gate

- All ~215 handwritten files pass under `test:unit:vitest`.
- Both outliers wrapped in `test()` blocks and pass.
- The "manual review" list in commit messages is empty or each entry has been resolved.
- Dual-run consistency log shows `match:yes` for every per-batch entry (I-4a) AND the end-of-phase global comparison shows full match.
- I-4b spot-checks recorded for every batch where deep-equality conversions occurred.
- Integration-file side-effect grep returns zero flagged statements across all integration files (I-7a).
- `test-count-parity.md` updated with post-Phase-3 numbers, still MATCH or fully WHITELISTED.

---

## 7. Phase 4: Enable parallelism and stress-test

Switch Vitest from single-fork to parallel threads pool, cap worker concurrency, and stress-test for flakiness. This is where R-M1 (shared module state) and R-M2 (env validation under fresh workers) finally surface.

**Runtime model note — `forks` vs `threads`:** Phase 1–3 used `pool: 'forks'` with `singleFork: true` — a single isolated process; each test file's module cache, ALS context, and globals were OS-isolated. Phase 4 switches to `pool: 'threads'` — workers **share the process heap** in a V8 isolate. Bugs that never appeared under forks (native modules like `bcrypt`/`canvas`, ALS context leaking across workers, `globalThis` mutations) will surface here for the first time. This phase is not just "increase parallelism" — it is a runtime model change.

### Task 4.0: Pre-phase hazard grep

**Files:** none modified.

- [ ] **Step 1: Scan for shared-memory hazards before switching pools**

```bash
# globalThis / global mutations
grep -rn "globalThis\.\|global\." --include="*.test.ts" \
  --exclude-dir=node_modules --exclude-dir=dist . | grep -v "\.d\.ts" | grep -v "node_modules"

# Native modules (unsafe under threads without special isolation)
grep -rn "require.*bcrypt\|require.*canvas\|require.*sharp\|require.*argon2\|import.*bcrypt\|import.*canvas\|import.*sharp\|import.*argon2" \
  --include="*.test.ts" --exclude-dir=node_modules .

# AsyncLocalStorage
grep -rn "AsyncLocalStorage" --include="*.test.ts" --exclude-dir=node_modules .
```

For each match: note the file and the pattern in `parallel-stress-results.md` under a new `## Pre-phase hazards` section. These files are quarantine candidates — investigate before the stress runs, not after. If a native module is used and cannot be mocked under threads, pin that file to `forks` in `poolMatchGlobs` before the smoke test.

### Task 4.1: Switch to parallel threads pool with worker cap

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1: Update the pool configuration**

Edit `vitest.config.ts`:

- Remove `pool: 'forks'` and the `poolOptions.forks.singleFork: true` block.
- Add the threads-pool configuration with worker cap:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';
import os from 'node:os';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
    },
  },
  test: {
    include: [
      '**/__tests__/**/*.test.ts',
      'shared/lib/parseContextSwitchCommand.test.ts',
      'server/services/scopeResolutionService.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tools/mission-control/**',
      'worker/**',
    ],
    env: {
      JWT_SECRET: 'ci-throwaway-jwt-secret',
      EMAIL_FROM: 'ci@automation-os.local',
      NODE_ENV: 'test',
    },
    poolOptions: {
      threads: {
        maxThreads: Math.max(1, (os.cpus()?.length ?? 2) - 1),
        minThreads: 1,
      },
    },
    poolMatchGlobs: [
      ['scripts/__tests__/build-code-graph-watcher.test.ts', 'forks'],
    ],
    testTimeout: 30_000,
  },
});
```

The `poolMatchGlobs` entry stays — `build-code-graph-watcher.test.ts` remains pinned to a forked worker permanently (R-M6).

- [ ] **Step 2: Smoke test with parallelism enabled**

```bash
npx vitest run
echo "exit: $?"
```

Expected: `exit: 0`. If failures appear, do NOT immediately quarantine — read the failure pattern. If multiple failures look like resource exhaustion (DB connection drops, ECONNREFUSED, EMFILE), drop `maxThreads` and re-run before classifying anything as parallel-unsafe (per spec § 4 Phase 4 deliverable 3 resource-exhaustion-before-quarantine triage).

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "test(vitest-migration): enable parallel threads pool with cores-1 cap (Phase 4, R-M1)"
```

### Task 4.2: Initialize the parallel-stress results file

**Files:**
- Create: `tasks/builds/vitest-migration/parallel-stress-results.md`

- [ ] **Step 1: Seed the results file**

```markdown
# Parallel stress results (Phase 4)

10 consecutive Vitest runs in parallel mode. At least 3 use `--sequence.shuffle`
to surface order-dependent bugs (file-level + test-level shuffle, both
included by default in `--sequence.shuffle`).

## Failure taxonomy

Per spec § 4 Phase 4 deliverable 3:
- **shared-state**: module-level singleton, registry mutation, in-memory
  cache, ALS context. R-M1.
- **env**: module-load env validation under fresh worker (R-M2), or
  env-absence assumption violated (I-8).
- **import-resolution**: extension elision, .ts vs .js suffix, alias miss.
  R-M3.
- **timing-async**: race, missing await, premature teardown, unhandled
  promise rejection.
- **filesystem**: file-write race, port-bind collision. R-M6.
- **order-dependent**: passes under default ordering, fails under shuffle.
  Almost always a shared-state bug surfaced by ordering.
- **other**: explain inline; if used >1 time, add a new category.

## Runs

(populated as runs complete)
```

Write to `tasks/builds/vitest-migration/parallel-stress-results.md`.

```bash
git add tasks/builds/vitest-migration/parallel-stress-results.md
git commit -m "test(vitest-migration): seed parallel-stress results template (Phase 4)"
```

### Task 4.3: Execute 10 consecutive parallel runs

**Files:**
- Modify: `tasks/builds/vitest-migration/parallel-stress-results.md`

- [ ] **Step 1: Plan the 10 runs**

7 with default ordering, 3 with `--sequence.shuffle`. Pick non-trivial ordering (don't run 7 default then 3 shuffle in a row — interleave so a flake at run 8 isn't always a shuffle run):

```
Run 1: default
Run 2: default
Run 3: shuffle
Run 4: default
Run 5: default
Run 6: shuffle
Run 7: default
Run 8: default
Run 9: shuffle
Run 10: default
```

- [ ] **Step 2: Execute the runs**

For each run, capture exit code, runtime, and any failures:

```bash
# Default-ordering run
START=$(date +%s)
npx vitest run --reporter=default 2>&1 | tee /tmp/vitest-run-NN.log
EXIT=$?
END=$(date +%s)
echo "Run NN: exit=$EXIT runtime=$((END-START))s ordering=default"
```

```bash
# Shuffle run
START=$(date +%s)
npx vitest run --sequence.shuffle --reporter=default 2>&1 | tee /tmp/vitest-run-NN.log
EXIT=$?
END=$(date +%s)
echo "Run NN: exit=$EXIT runtime=$((END-START))s ordering=shuffle"
```

After each run, capture memory usage and append to `tasks/builds/vitest-migration/parallel-stress-results.md`:

```bash
# After the run completes, check peak heap (approximate via Node's diagnostic output)
node -e "const m=process.memoryUsage(); console.log('heap used MB:', (m.heapUsed/1024/1024).toFixed(1), '/ heap total:', (m.heapTotal/1024/1024).toFixed(1))"
```

```markdown
### Run NN (YYYY-MM-DD HH:MM, ordering: default|shuffle)
- Exit: 0|N
- Runtime: <wall-clock seconds from date +%s>
- Heap (approx): <MB used / total>
- Failures: (list <file>::<test name> for each, or "none")
- Flaky: (list any test that passed in earlier run but failed here, or "none")
```

If heap usage spikes consistently above ~2 GB or grows run-over-run (memory leak), reduce `maxThreads` before classifying failures — memory pressure can cascade into apparent flakiness that isn't test-logic-related.

The `Runtime` field here is wall-clock time (from `date +%s`), not Vitest's self-reported duration. The Phase 5 hard cap (< 5 min) is measured against wall-clock CI time, not Vitest's internal timer.

- [ ] **Step 3: Apply resource-exhaustion-before-quarantine triage**

After each failed run, before classifying anything as parallel-unsafe:

1. Look at the failure pattern. Multiple files failing with DB-connection-drop / ECONNREFUSED / EMFILE points to environment exhaustion, not test-level bugs.
2. If exhaustion is suspected, lower `maxThreads` and re-run (cores − 2, then cores / 2, then 2):

```ts
// In vitest.config.ts, temporarily:
maxThreads: Math.max(1, (os.cpus()?.length ?? 2) - 2),  // first try
// or
maxThreads: Math.max(1, Math.floor((os.cpus()?.length ?? 4) / 2)),  // second
// or
maxThreads: 2,  // floor
```

3. If failures disappear at lower concurrency, the fix is the cap — not quarantines. Record under **filesystem** or **timing-async** with a "resource-exhaustion suspected" note. Settle on the lowest concurrency where the suite is stable; this becomes the Phase 5 baseline.
4. If failures persist at 2 threads, the failure is genuine parallel-unsafe behaviour. Classify per the taxonomy (Step 4 below).

- [ ] **Step 4: Classify each genuine failure**

For every test that failed or flaked across the 10 runs, classify into ONE of the taxonomy categories above (`shared-state`, `env`, `import-resolution`, `timing-async`, `filesystem`, `order-dependent`, `other`). Record in the results doc as:

```markdown
### Failure: <file>::<test name>
- Category: <one of the seven>
- First seen: Run NN
- Frequency: N of 10 runs
- Diagnosis: <one or two sentences>
- Action: fixed | quarantined (TI-NNN)
```

- [ ] **Step 5: Fix or quarantine each failure**

For each classified failure:

**Fix path:** Refactor the test or its target to remove the parallel-unsafe behaviour. Common fixes:
- `shared-state`: extract module-level singleton into a per-test factory; clear caches in `beforeEach`.
- `env`: ensure the env var is set in the `env` block of `vitest.config.ts` AND the CI workflow (both must list the same set per Step 6).
- `timing-async`: add the missing `await`; fix premature teardown by moving cleanup into `afterEach`.
- `order-dependent`: if it only fails under shuffle, isolate the state setup. Frequently the fix is "test 1 mutates a singleton; tests 2 and 3 rely on the mutation" — extract the mutation into a `beforeEach`.

**Quarantine path:** If the fix is non-trivial and would block Phase 4 closure, quarantine. The quarantine MUST include all five contract fields (four from R-M1 + `review_after` for I-6 enforceability):

```ts
// At the top of the affected file:
// @vitest-isolate
// reason: <one-line description of the parallel-unsafe behaviour>
// date: YYYY-MM-DD
// owner: <team name | individual handle | "unowned">
// follow-up: tasks/todo.md TI-NNN
// review_after: YYYY-MM-DD (30 days from date)
```

Plus add a `poolMatchGlobs` entry pinning the file to forks:

```ts
poolMatchGlobs: [
  ['scripts/__tests__/build-code-graph-watcher.test.ts', 'forks'],
  ['<path-to-quarantined-file>', 'forks'],
],
```

Plus a `tasks/todo.md` entry under `## Test infrastructure hygiene` with the same shape as TI-001 (Task 1.3 step 1). The entry's goal must be "remove the quarantine" with a 30-day expiry per I-6.

- [ ] **Step 6: Reconcile env vars between Vitest and CI**

For every env var added during Phase 4 to satisfy R-M2:

1. Add the throwaway value to the `env` block in `vitest.config.ts`.
2. Add the same variable to `.github/workflows/ci.yml`'s `env:` block (Phase 5 will revisit the workflow; for now, just ensure the addition is staged).

The two lists MUST match exactly. Mismatch is the leading cause of "passes locally, fails in CI" surprises.

- [ ] **Step 7: Re-verify after each fix or quarantine (targeted, not full 10-run reset)**

A full 10-run reset after every fix is expensive (~30 min per cycle). Use this tiered approach instead:

1. **After fixing a specific file:** run that file under 10-iteration shuffle stress (`--repeats 10` + `--sequence.shuffle`), then run the full suite once to confirm no new regressions:
   ```bash
   npx vitest run --repeats 10 --sequence.shuffle <path-to-fixed-file>
   npx vitest run
   ```
2. **After all fixes and quarantines are in place:** run the full 10-consecutive-run gate from Task 4.3 Step 2 once more. This is the final gate — it only needs to pass once after ALL changes are stable.

Append each verification run's result to `parallel-stress-results.md`. The exit gate requires 10 consecutive clean runs at the END of Phase 4 (not after every individual fix).

**Quarantine budget check:** Before adding a new quarantine, check the current count:
```bash
grep -c "@vitest-isolate" $(find . -name "*.test.ts" -not -path "*/node_modules/*")
```
Hard cap: **13 files** (~5% of 277). If this count is reached, stop adding quarantines and force fixes instead. Every quarantine degrades the parallelism Phase 4 is trying to achieve — at 13 quarantined files, the parallel speedup is already materially reduced.

### Task 4.4: Phase 4 commit and progress update

**Files:**
- Modify: `tasks/builds/vitest-migration/progress.md`

- [ ] **Step 1: Verify the exit gate**

```bash
# Tally clean consecutive runs from parallel-stress-results.md
grep -c "^- Exit: 0" tasks/builds/vitest-migration/parallel-stress-results.md
```

Expected: ≥10 consecutive clean runs at the bottom of the file (with at least 3 of them tagged `ordering: shuffle`).

- [ ] **Step 2: Verify quarantine contracts**

```bash
grep -B 1 -A 5 "@vitest-isolate" $(find . -name "*.test.ts" -not -path "*/node_modules/*" -not -path "*/dist/*")
```

Each match must show all four fields (reason, date, owner, follow-up). Each follow-up must reference an existing `tasks/todo.md` entry. Manually verify by opening `tasks/todo.md`.

- [ ] **Step 3: Verify env var reconciliation**

Compare the env block in `vitest.config.ts` against the env block in `.github/workflows/ci.yml`:

```bash
# Extract Vitest env keys
grep -A 20 "env:" vitest.config.ts | grep -E "^\s+\w+:" | awk -F: '{print $1}' | tr -d ' ' | sort
# Extract CI env keys (Phase 5 modifies the workflow; do this comparison once the additions land)
grep -A 30 "^\s*env:" .github/workflows/ci.yml | grep -E "^\s+\w+:" | awk -F: '{print $1}' | tr -d ' ' | sort
```

The two lists should be identical except for `DATABASE_URL` (which is in CI only — Vitest does not inject it).

- [ ] **Step 4: Update progress doc and commit**

Append to `tasks/builds/vitest-migration/progress.md`:

```markdown
- YYYY-MM-DD: Phase 4 complete. 10 consecutive clean runs in parallel mode
  (3 shuffle, 7 default). maxThreads=<final-value>. Quarantines added: <list TI-NNN>.
  Env vars added: <list>. Failures classified by category:
  shared-state=<n>, env=<n>, import-resolution=<n>, timing-async=<n>,
  filesystem=<n>, order-dependent=<n>, other=<n>.
```

```bash
git add vitest.config.ts tasks/builds/vitest-migration/parallel-stress-results.md tasks/builds/vitest-migration/progress.md tasks/todo.md
git commit -m "test(vitest-migration): Phase 4 complete — 10 consecutive parallel runs clean (R-M1, R-M2, I-6)"
```

### Phase 4 exit gate

- 10 consecutive parallel runs pass without flake on the same Node 20 CI environment.
- At least 3 of the 10 used `--sequence.shuffle`.
- Every quarantined test has the four-field R-M1 contract + `poolMatchGlobs` entry + live `tasks/todo.md` follow-up.
- Every failure surfaced is classified into the taxonomy and recorded in `parallel-stress-results.md`.
- `vitest.config.ts`'s `env` block and `.github/workflows/ci.yml`'s `env:` block list the same variables (modulo `DATABASE_URL`).
- `tasks/builds/vitest-migration/parallel-stress-results.md` is committed and complete.

**Phase 4 rollback:** If widespread flake cannot be resolved within the phase budget, revert this phase's commits to restore single-fork mode. Phase 5 cutover can still proceed on top of sequential Vitest; runtime improvement becomes a deferred follow-up.

---

## 8. Phase 5: Cutover and CI re-tune

Replace the bash unit runner with Vitest as the primary path. Bash runner goes away. CI timeout drops from 45 to 15 minutes.

### Task 5.0: Pre-cutover tag and sanity check

**Files:** none modified.

- [ ] **Step 1: Tag the last pre-cutover commit**

```bash
git tag vitest-pre-cutover
git push origin vitest-pre-cutover
```

This tag is the rollback anchor. If Phase 5 causes an incident, rollback is:
```bash
git reset --hard vitest-pre-cutover
git push --force-with-lease origin <migration-branch>
```
Clean and deterministic, without relying on commit-count arithmetic.

- [ ] **Step 2: Pre-cutover shuffle + sequential sanity run**

Run the suite once in shuffle mode and once sequentially before any Phase 5 edits:

```bash
npx vitest run --sequence.shuffle
echo "shuffle exit: $?"
```

If either exits non-zero, the Phase 4 exit gate was not fully satisfied — go back and resolve before touching `package.json` or the CI workflow.

### Task 5.1: Repoint `npm run test:unit` to Vitest

**Files:**
- Modify: `package.json` (scripts)

- [ ] **Step 1: Update the script entry**

In `package.json`'s `scripts` block:

- Change `"test:unit": "bash scripts/run-all-unit-tests.sh"` to `"test:unit": "vitest run"`.
- Delete the `"test:unit:vitest": "vitest run"` entry — it's now redundant.
- Leave the chained `"test"` entry unchanged in shape: `"test": "npm run test:gates && npm run test:qa && npm run test:unit"`.

- [ ] **Step 2: Verify `npm test` runs the new pipeline**

```bash
npm test
echo "exit: $?"
```

Expected: `exit: 0`. The command now runs gates → QA → Vitest in that order.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "test(vitest-migration): repoint test:unit to vitest, retire test:unit:vitest (Phase 5 cutover)"
```

### Task 5.2: Delete the bash unit runner

**Files:**
- Delete: `scripts/run-all-unit-tests.sh`

- [ ] **Step 1: Confirm no other script references it**

```bash
grep -rl "run-all-unit-tests\.sh" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . || true
```

Expected: matches in this plan, the spec, the CI workflow (if it referenced the bash runner directly), and `package.json` (if any leftover reference). Each reference must be either:
- A historical mention in docs/specs (acceptable; do not edit).
- An active call from another script (must be repointed to `vitest run` first).
- The CI workflow (if it used the bash runner directly, repoint it to `npm run test:unit` which now invokes Vitest).

If any active reference remains, fix it before deletion.

- [ ] **Step 2: Delete the bash runner**

```bash
git rm scripts/run-all-unit-tests.sh
```

- [ ] **Step 3: Verify the unit runner directly**

```bash
npx vitest run
echo "exit: $?"
```

Expected: `exit: 0`. (Full `npm test` pipeline is verified by CI push in Task 5.4.)

- [ ] **Step 4: Commit**

```bash
git commit -m "test(vitest-migration): delete scripts/run-all-unit-tests.sh — bash unit runner retired (Phase 5)"
```

### Task 5.3: Verify zero handwritten-harness survivors

**Files:** none modified.

- [ ] **Step 1: Grep for the canonical handwritten signatures**

```bash
grep -rl "function test(name: string" \
  --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist . || echo "no matches"

grep -rl "function assert(cond: unknown" \
  --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist . || echo "no matches"
```

Expected: `no matches` for both. If either match prints a path, that file was missed during Phase 3 conversion. STOP and fix before proceeding — this would be a hidden I-3a violation.

- [ ] **Step 2: Grep for surviving `process.exit` in test files**

```bash
grep -rln "process\.exit" --include="*.test.ts" \
  --exclude-dir=node_modules --exclude-dir=dist . || echo "no matches"
```

Expected: `no matches` OR the only matches are inside files quarantined under R-M1's contract (verify by checking each file has a `// @vitest-isolate` block at the top).

If a survivor is found that is NOT quarantined, treat it as a Phase 3 escape: convert it now under the same rules, append to dual-run-consistency.md as a post-phase-3 fix, and commit.

### Task 5.4: Update `.github/workflows/ci.yml`

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Lower the timeout**

Find the `timeout-minutes: 45` line in the workflow and change it to:

```yaml
timeout-minutes: 15
```

The 15-minute headroom accommodates parallel-run flake detection without masking hangs. If Phase 4 was rolled back to single-fork, this value may need to be 25 instead — verify against actual measured runtime in Phase 4.

- [ ] **Step 2: Reconcile env vars**

Confirm `.github/workflows/ci.yml`'s `env:` block matches `vitest.config.ts`'s `env` block (modulo `DATABASE_URL`). Add any variables surfaced in Phase 4 that haven't yet been added to the workflow.

- [ ] **Step 3: Push to a migration branch and trigger CI**

```bash
git push origin <migration-branch>
```

Wait for CI to complete. Verify:
- Exit code zero.
- Total unit-layer runtime is captured in the workflow logs.

- [ ] **Step 4: Verify runtime targets and record the cutover baseline**

Read the unit-layer runtime from CI logs. Apply gates:
- **Soft target (under 3 minutes):** the migration's primary motivation. If hit, no further action.
- **Hard cap (under 5 minutes):** required to claim Phase 5 success. If exceeded:
  - Phase 4 must be revisited. Likely root cause: too many quarantines (many files now run sequentially instead of in parallel) or worker-count cap too low.
  - Do NOT proceed to Phase 6 until runtime is under 5 minutes.
- **Between 3 and 5 minutes:** acceptable per spec § 4 Phase 5 success criteria. Do not chase optimization during this migration; revisit in Phase 6 follow-ups only if headroom is needed.

Record the measured runtime in `tasks/builds/vitest-migration/progress.md` under Phase 5 as the **cutover baseline** (e.g., `CI unit-layer runtime baseline: 2m 14s`).

**CI regression guardrail:** Add a comment to `.github/workflows/ci.yml` immediately above the unit step:

```yaml
# Vitest cutover baseline: ~Xm YYs (measured YYYY-MM-DD).
# If runtime increases >20% in future PRs, investigate before merging.
```

This creates a persistent reference point so slow creep is visible at code-review time without needing a separate monitoring dashboard.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: lower unit-layer timeout to 15 minutes after vitest cutover (Phase 5)"
```

### Task 5.5: Update `docs/ci-setup.md`

**Files:**
- Modify: `docs/ci-setup.md`

- [ ] **Step 1: Update expected runtimes**

Find the section that describes expected runtime (likely "expected runtimes" or "performance" heading). Update to reflect the new state:

```markdown
## Expected runtimes

- Static gate layer (`npm run test:gates`): about 30 seconds.
- QA spec layer (`npm run test:qa`): about 30 seconds.
- Unit layer (`npm run test:unit`, now Vitest): under 3 minutes (soft target,
  achieved on parallel-clean suite). Hard cap: under 5 minutes. Workflow
  timeout: 15 minutes (failsafe above the hard cap).

Total `npm test` budget: under 4 minutes typical, 6 minutes worst-case.
```

If the document's structure doesn't have a runtimes section, add one near the top (after any introductory paragraph, before the per-job descriptions).

- [ ] **Step 2: Commit**

```bash
git add docs/ci-setup.md
git commit -m "docs(ci-setup): update expected runtimes after vitest cutover (Phase 5)"
```

### Task 5.6: Phase 5 progress and exit verification

**Files:**
- Modify: `tasks/builds/vitest-migration/progress.md`

- [ ] **Step 1: Update progress doc**

Append to `tasks/builds/vitest-migration/progress.md`:

```markdown
- YYYY-MM-DD: Phase 5 complete. test:unit repointed to vitest, bash runner deleted.
  CI runtime (unit layer): <measured-time>. Soft target: <hit|missed>.
  Hard cap: <hit|missed>. Workflow timeout: 15 minutes.
```

```bash
git add tasks/builds/vitest-migration/progress.md
git commit -m "test(vitest-migration): Phase 5 complete — vitest is the primary unit runner"
```

### Phase 5 exit gate

- A CI run on the migration branch passes (gates + QA + Vitest all green).
- Total CI runtime for the unit layer:
  - Hits the soft target (< 3 minutes), OR
  - Sits in the acceptable band (3–5 minutes), OR
  - If above 5 minutes, Phase 4 has been revisited and runtime is now under 5 minutes.
- `scripts/run-all-unit-tests.sh` is gone from the repo.
- `grep -rln "function test(name: string\|function assert(cond: unknown" --include="*.ts"` returns zero matches.
- `grep -rln "process\.exit" --include="*.test.ts"` returns zero matches OR every match is in a quarantined file with the five-field contract (four + `review_after`).
- `package.json` no longer has the `test:unit:vitest` script.
- `vitest-pre-cutover` tag exists and is pushed.
- CI workflow has the runtime baseline comment.
- Cutover baseline runtime recorded in `progress.md`.

**Phase 5 rollback:** `git reset --hard vitest-pre-cutover` and force-push to the migration branch. The bash runner is restored from the tag. CI returns to the slower runtime but stays green. Phase 6 work is independently revertable (each task is its own commit) — a Phase 5 issue does not require undoing Phase 6 commits if they've already landed.

---

## 9. Phase 6: Cleanup, conventions, footguns, coverage

Final-state housekeeping. Each task is independent — commit per task. None of these changes affects the test runner or CI behaviour; they codify conventions, remove footguns, and wire up coverage.

### Task 6.1: Rewrite `docs/testing-conventions.md`

**Files:**
- Modify: `docs/testing-conventions.md`

- [ ] **Step 1: Read the existing doc**

```bash
cat docs/testing-conventions.md | head -100
```

Identify the sections that describe the handwritten and `node:test` patterns as canonical (per spec § 1, both `docs/testing-conventions.md` and `docs/testing-structure-Apr26.md` describe the handwritten pattern as canonical today).

- [ ] **Step 2: Rewrite the canonical-runner section**

Replace the canonical pattern with Vitest. Key content (preserve any project-specific narrative around it):

```markdown
## Canonical test pattern

The single permitted runner is **Vitest**. Tests live under
`**/__tests__/*.test.ts`. The `*Pure.ts` + `*.test.ts` sibling pattern
is preserved (the `verify-pure-helper-convention.sh` gate continues to
enforce it unchanged).

The canonical assertion API is `expect(...).matcher(...)`. Both the
handwritten `function test(name, fn)` + custom `assert` pattern AND
`node:test` + `node:assert/strict` are forbidden in new tests.

### Imports

```ts
import { test, expect, beforeEach, afterEach, describe } from 'vitest';
```

### Skip-gates

```ts
const SKIP = !process.env.DATABASE_URL;
describe.skipIf(SKIP)('DB-backed feature', () => {
  test('does the thing', async () => {
    const db = await import('../db.js');
    // ...
  });
});
```

### Module-load side effects (I-7b)

Test files MUST NOT mutate shared state at import time. No top-level
registry registration (`registerProviderAdapter`), no top-level singleton
init, no top-level filesystem writes, no top-level network setup. State
setup belongs in `beforeAll` / `beforeEach` or inside the `test()` body.
Integration tests are the strict subset enforced by grep (I-7a); the
rule applies to all tests.

### Env-absence dependencies (I-8a)

A test that branches on `process.env.X === undefined` MUST include
`expect(process.env.X).toBeUndefined()` so the dependency is visible.
Implicit absence is forbidden — a future PR adding a default would
silently change the test's meaning.

### Env mutation (I-8b)

Tests that mutate `process.env` MUST restore using snapshot/restore:

```ts
let envSnapshot: typeof process.env;
beforeEach(() => { envSnapshot = { ...process.env }; });
afterEach(() => { process.env = envSnapshot; });
```

### No-new-flake gate (I-9)

A new test that flakes under 3 consecutive local or CI runs (I-9a) OR
fails in ≥2 of 10 consecutive CI runs (I-9b) does not merge. Either fix
the flake or quarantine under R-M1's contract (with 30-day expiry per I-6).

**Enforcement mechanism (I-9b going forward):** I-9b applies to new tests via code review and CI observation, not via a manual 10-run gate per PR. Phase 4's 10-run gate was a one-time migration-quality bar; I-9b is the ongoing reviewer signal. If a PR adds a new test and CI shows it flaking across runs, the reviewer blocks the merge. No automated 10-run gate per PR is expected.

### Test naming

Every `test()` name must describe observable behaviour, not implementation or sequence:
- Reject: `'test 1'`, `'should work'`, `'processContextPool'` (function name only)
- Accept: `'returns empty array when pool has no sources'`, `'rejects malformed input with a descriptive error'`

### Per-file count drift (I-10)

A PR that changes the registered test count of a file by more than ±30%
must include one or two sentences in the PR description naming what
changed and why. Routine refactoring is below threshold; structural
weakening (1 test → 5 weak ones; 10 tests → 4) surfaces to review.

### Test-only utilities

Test fixtures, mocks, and helper functions used only by tests must live
under a `__tests__/` directory (typically `__tests__/fixtures/` or
`__tests__/helpers/`) so the coverage `**/__tests__/**` exclude pattern
catches them. A helper that accidentally lives in a production directory
inflates coverage metrics and makes them meaningless. If a test-only
utility must live outside `__tests__/` for import-graph reasons, it
gets an explicit per-file entry in the coverage `exclude` array with a
comment naming the reason. New tests should never need this escape
hatch.
```

- [ ] **Step 3: Add the quarantined-tests section**

Append a new section listing every `// @vitest-isolate` quarantine AND the quarantine removal procedure:

```markdown
## Quarantined tests

Tests pinned to single-fork execution because they exhibit parallel-
unsafe behaviour. Each entry has a corresponding `tasks/todo.md` follow-up
to remove the quarantine.

- `scripts/__tests__/build-code-graph-watcher.test.ts` — spawns tsx
  subprocesses, holds singleton lock, runtime up to 120 s. TI-001.
- (one line per other quarantine added during Phases 4 / 5)

### Quarantine removal procedure

A quarantine may only be removed when:

1. The linked `tasks/todo.md` follow-up's goal is confirmed met (the
   underlying parallel-unsafe behaviour is fixed).
2. The file passes 10-iteration shuffle stress locally:
   ```bash
   npx vitest run --repeats 10 --sequence.shuffle <path>
   ```
3. After steps 1–2: remove the `// @vitest-isolate` comment block
   (all five fields), remove the `poolMatchGlobs` entry, close the
   `tasks/todo.md` entry — all in one commit.

Never remove a quarantine without step 2. The comment existing ≠ the
problem being fixed.
```

- [ ] **Step 4: Commit**

```bash
git add docs/testing-conventions.md
git commit -m "docs(testing-conventions): rewrite for vitest, codify I-7..I-10, quarantine removal procedure (Phase 6)"
```

### Task 6.2: Update `docs/testing-structure-Apr26.md`

**Files:**
- Modify: `docs/testing-structure-Apr26.md`

- [ ] **Step 1: Update the runtime snapshot**

Find the section describing the current runtime (a snapshot from April 2026 of how tests are organized and run). Update it to reflect Vitest as the canonical runner. Preserve:

- The per-feature-stabilisation trigger for adding frontend tests.
- The explicit out-of-scope categories (frontend tests, API contract tests, E2E).
- Any project-specific narrative about the rationale for the current testing posture.

The change is purely descriptive — replace "the handwritten harness" with "Vitest" wherever it appears, replace any per-file `tsx`-invocation language with parallel Vitest, and update the runtime expectations to match `docs/ci-setup.md`.

- [ ] **Step 2: Commit**

```bash
git add docs/testing-structure-Apr26.md
git commit -m "docs(testing-structure): update April 2026 snapshot for vitest runtime (Phase 6)"
```

### Task 6.3: Move outlier file 1 — `parseContextSwitchCommand.test.ts`

**Files:**
- Move: `shared/lib/parseContextSwitchCommand.test.ts` → `shared/lib/__tests__/parseContextSwitchCommand.test.ts`

- [ ] **Step 1: Move the file with `git mv`**

```bash
mkdir -p shared/lib/__tests__
git mv shared/lib/parseContextSwitchCommand.test.ts shared/lib/__tests__/parseContextSwitchCommand.test.ts
```

- [ ] **Step 2: Adjust import paths inside the moved file**

The relative import to the implementation changes from `'./parseContextSwitchCommand.js'` to `'../parseContextSwitchCommand.js'`. Open the file and update each affected import.

- [ ] **Step 3: Run Vitest against the moved file**

```bash
npx vitest run shared/lib/__tests__/parseContextSwitchCommand.test.ts
```

Expected: pass. If imports fail to resolve, double-check the relative path — there should be exactly one `../` step now.

- [ ] **Step 4: Commit**

```bash
git add shared/lib/parseContextSwitchCommand.test.ts shared/lib/__tests__/parseContextSwitchCommand.test.ts
git commit -m "test: move parseContextSwitchCommand.test.ts under __tests__/ (Phase 6, R-M8)"
```

### Task 6.4: Move outlier file 2 — `scopeResolutionService.test.ts`

**Files:**
- Move: `server/services/scopeResolutionService.test.ts` → `server/services/__tests__/scopeResolutionService.test.ts`

- [ ] **Step 1: Move the file with `git mv`**

```bash
mkdir -p server/services/__tests__
git mv server/services/scopeResolutionService.test.ts server/services/__tests__/scopeResolutionService.test.ts
```

- [ ] **Step 2: Adjust import paths inside the moved file**

Same as Task 6.3 step 2 — change `'./scopeResolutionService.js'` to `'../scopeResolutionService.js'`.

- [ ] **Step 3: Run Vitest against the moved file**

```bash
npx vitest run server/services/__tests__/scopeResolutionService.test.ts
```

Expected: pass.

- [ ] **Step 4: Run `verify-pure-helper-convention.sh` against the moved file**

```bash
bash scripts/verify-pure-helper-convention.sh
echo "exit: $?"
```

If the gate complains about the moved file (it now lives in `__tests__/` and must import from a sibling `*Pure.ts` module):

- **Option A (preferred):** extract pure logic into `server/services/scopeResolutionServicePure.ts` and update the test's import to `'../scopeResolutionServicePure.js'`.
- **Option B (fallback):** suppress the gate for this file with a documented comment at the top of the test file:

  ```ts
  // guard-ignore-file: pure-helper-convention reason="extraction deferred — see TI-NNN"
  ```

  Add a `tasks/todo.md` entry under "test infrastructure hygiene":

  ```markdown
  ### TI-NNN: Extract scopeResolutionServicePure.ts
  - File: server/services/__tests__/scopeResolutionService.test.ts
  - Goal: extract pure logic from scopeResolutionService.ts into
    scopeResolutionServicePure.ts per the gate convention; update the
    test import; remove the guard-ignore-file suppression.
  - Linked: spec § 8 (decisions deferred and follow-ups).
  ```

- [ ] **Step 5: Commit**

```bash
git add server/services/scopeResolutionService.test.ts server/services/__tests__/scopeResolutionService.test.ts tasks/todo.md
git commit -m "test: move scopeResolutionService.test.ts under __tests__/ (Phase 6, R-M8)"
```

### Task 6.5: Simplify `vitest.config.ts` `include` array

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1: Drop the explicit outlier paths**

In `vitest.config.ts`, the `include` array currently has three entries:

```ts
include: [
  '**/__tests__/**/*.test.ts',
  'shared/lib/parseContextSwitchCommand.test.ts',
  'server/services/scopeResolutionService.test.ts',
],
```

After Tasks 6.3 and 6.4 the outliers live under `__tests__/`, so the glob catches them. Reduce to one entry:

```ts
include: [
  '**/__tests__/**/*.test.ts',
],
```

- [ ] **Step 2: Verify Vitest still discovers all 277 files**

```bash
npx vitest list --reporter=json | node -e 'let s=""; process.stdin.on("data",c=>s+=c); process.stdin.on("end",()=>{ const d=JSON.parse(s); const f=new Set(); (Array.isArray(d)?d:d.files||[]).forEach(e=>f.add(e.file||e.path||e.filepath)); console.log("files:",f.size); });'
```

Expected: `files: 277`. If lower, the glob is missing one or both outliers — re-check the moves in Tasks 6.3 / 6.4.

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "test(vitest-migration): simplify include after outlier moves (Phase 6)"
```

### Task 6.6: Convert `dlqMonitorRoundTrip.integration.test.ts` placeholder to `test.todo`

**Files:**
- Modify: `server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts`

- [ ] **Step 1: Locate the `Implementer-supplied:` placeholder**

```bash
grep -n "Implementer-supplied:" server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts
```

The match identifies the empty test body that currently no-ops.

- [ ] **Step 2: Replace with `test.todo`**

Replace the placeholder block with:

```ts
test.todo('DLQ round-trip: poison job → __dlq → system_incidents row', () => {
  // implement: see TI-NNN in tasks/todo.md
});
```

- [ ] **Step 3: Add the follow-up entry**

Append to `tasks/todo.md`:

```markdown
### TI-NNN: Implement DLQ round-trip integration test body
- File: server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts
- Currently: test.todo() placeholder.
- Goal: implement the DLQ round-trip behaviour: poison job → __dlq →
  system_incidents row insertion. Or delete the test if the behaviour
  is otherwise covered.
- Linked: spec § 8 (decisions deferred and follow-ups), R-M9.
```

- [ ] **Step 4: Verify Vitest reports the todo**

```bash
npx vitest run server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts
```

Expected: the run reports the test as TODO (not as a passing or failing test). The test is now visible as a pending item rather than a silent no-op.

**I-3a note:** `test.todo` registers as a test in Vitest's discovery count. After this task the file's registered-test count goes from 0 (was a no-op placeholder) to 1 (now a visible TODO). If any automated parity check runs after Phase 6, this `+1` is expected and not a drift signal — document it in `vitest-discovery-baseline.json` or the parity check's WHITELISTED DELTA section if needed.

- [ ] **Step 5: Commit**

```bash
git add server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts tasks/todo.md
git commit -m "test: convert dlqMonitorRoundTrip placeholder to test.todo (Phase 6, R-M9)"
```

### Task 6.7: Rename the broken legacy migrate script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Rename the script entry**

In `package.json`'s `scripts` block, rename:

- `"migrate:drizzle-legacy": "drizzle-kit migrate"` → `"migrate:drizzle-legacy-DO-NOT-USE": "drizzle-kit migrate"`.

The rename surfaces the broken state in `package.json` itself (per readiness report § 2, this script silently skips migrations 0041+; the team uses `scripts/migrate.ts` instead).

- [ ] **Step 2: Verify nothing references the old name**

```bash
grep -rln "migrate:drizzle-legacy" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . | grep -v "DO-NOT-USE"
```

Expected: no matches outside historical docs/specs (which mention the old name in narrative context). If any active script or CI invocation uses the old name, update it to the new name (or, more likely, remove the call — `migrate:drizzle-legacy-DO-NOT-USE` should never be called by automation).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(package): rename migrate:drizzle-legacy to ...-DO-NOT-USE for visibility (Phase 6)"
```

### Task 6.8: Audit and delete `playbooks:test` script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Verify Vitest discovers the file**

```bash
npx vitest list --reporter=json | grep -c "workflow.test.ts"
```

Expected: ≥1 (Vitest's glob `**/__tests__/*.test.ts` matches `server/lib/workflow/__tests__/workflow.test.ts`).

If zero, Vitest is NOT covering the file — keep the script and document the reason in `docs/testing-conventions.md` under a new "Excluded from Vitest" section. Skip Step 2.

- [ ] **Step 2: Delete the redundant script entry**

In `package.json`, delete the line:

```json
"playbooks:test": "tsx server/lib/workflow/__tests__/workflow.test.ts",
```

- [ ] **Step 3: Verify nothing else references it**

```bash
grep -rln "playbooks:test" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . || echo "no matches"
```

Expected: `no matches` outside historical docs. If any active reference exists (CI workflow step, Makefile, etc.), update it to call `npm run test:unit` (which now invokes Vitest covering the file) or remove the redundant call.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(package): delete redundant playbooks:test script — vitest covers it (Phase 6)"
```

### Task 6.9: Investigate `chatTriageClassifierPure.test.ts` filesystem write (R-M6)

**Files:**
- Possibly modify: `server/services/__tests__/chatTriageClassifierPure.test.ts`

- [ ] **Step 1: Find the writeFileSync call and inspect the path**

```bash
grep -n "writeFileSync" server/services/__tests__/chatTriageClassifierPure.test.ts
```

Examine the path argument:

- **Path is fixed** (e.g. `'/tmp/some-fixture.txt'`, `'./fixtures/output.txt'`): two tests writing concurrently to the same path would race under parallelism. Rewrite to use:
  - **Option A (preferred):** in-memory buffer, no filesystem touch. Capture the would-be-written content into a variable and assert against it.
  - **Option B:** `vi.fn()`-based mock — spy on `writeFileSync` itself and assert on call arguments.
  - **Option C (fallback):** per-test temp file via `os.tmpdir()` + a UUID. Preserves the I/O behaviour but eliminates the collision.
- **Path is per-test** (e.g. parameterised by test name or includes a UUID): already parallel-safe. No change needed; document the verification in the commit message.

- [ ] **Step 2: If a rewrite is needed, apply the chosen option**

Implement the rewrite. Run `npx vitest run server/services/__tests__/chatTriageClassifierPure.test.ts` to verify it still passes.

- [ ] **Step 3: If rewrite is non-trivial, quarantine instead**

If extracting the filesystem dependency would be a substantial refactor, quarantine under R-M1's contract (five-field comment: reason, date, owner, follow-up, review_after + `tasks/todo.md` entry + `poolMatchGlobs` entry). Quarantine only as last resort — the spec explicitly prefers fix over quarantine.

- [ ] **Step 4: Commit**

```bash
git add server/services/__tests__/chatTriageClassifierPure.test.ts
git commit -m "test(chatTriageClassifierPure): make filesystem write parallel-safe (Phase 6, R-M6)"
```

(If the audit found the file already parallel-safe, commit only an updated note in the spec/progress docs — no source change.)

### Task 6.10: Add Node 20 engine pin and `.nvmrc`

**Files:**
- Modify: `package.json`
- Create: `.nvmrc`

- [ ] **Step 1: Add the `engines` field to `package.json`**

Insert at the top level of `package.json`:

```json
"engines": {
  "node": ">=20.0.0 <21.0.0"
},
```

Place it after `"type": "module"` so it sits in the standard package.json header block.

- [ ] **Step 2: Create `.nvmrc`**

Create the file at the repo root with a single line:

```
20
```

(No trailing newline, no version qualifier — `.nvmrc`'s convention is the major version on its own line, supported by nvm, fnm, and Volta.)

- [ ] **Step 3: Verify the engine constraint accepts the local Node**

```bash
node --version
```

Expected: `v20.x`. If the local Node is outside the range, switch via `nvm use` or equivalent before continuing.

- [ ] **Step 4: Commit**

```bash
git add package.json .nvmrc
git commit -m "chore: pin node to 20.x via engines and .nvmrc (Phase 6)"
```

### Task 6.11: Wire up Vitest v8 coverage

**Files:**
- Modify: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the coverage block to `vitest.config.ts`**

Inside the `test` block, alongside `include`, `env`, etc., add:

```ts
coverage: {
  provider: 'v8',
  reporter: ['text', 'html', 'json'],
  include: ['server/**/*.ts', 'shared/**/*.ts', 'client/src/**/*.ts'],
  exclude: [
    '**/__tests__/**',
    '**/fixtures/**',      // catches test fixtures outside __tests__/ — see test-fixtures-inventory.md
    '**/*.d.ts',
  ],
},
```

The `exclude` uses directory-based patterns. `**/__tests__/**` catches test files; `**/fixtures/**` catches shared fixture modules that the test-fixtures-inventory enumerates. Any test-only utility living outside both of these directories must get an explicit per-file `exclude` entry with a comment.

- [ ] **Step 2: Add the `test:coverage` script**

In `package.json`'s `scripts` block:

```json
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 3: Run coverage once, verify it works, and record the baseline**

```bash
npm run test:coverage
echo "exit: $?"
ls coverage/
```

Expected: exit 0, `coverage/` directory contains `index.html`, `coverage-final.json`, and per-file breakdowns. Then capture the baseline numbers:

```bash
node -e '
const s = require("./coverage/coverage-summary.json");
const t = s.total;
console.log("Coverage baseline (post-migration):");
console.log("  lines:", t.lines.pct + "%");
console.log("  branches:", t.branches.pct + "%");
console.log("  functions:", t.functions.pct + "%");
console.log("  statements:", t.statements.pct + "%");
'
```

Append these numbers to `tasks/builds/vitest-migration/progress.md` under a `## Coverage baseline` heading. This is the reference for the 2–3-month threshold-revisit decision.

- [ ] **Step 4: Add `coverage/` to `.gitignore`**

If `coverage/` isn't already in `.gitignore`, add it:

```bash
echo "coverage/" >> .gitignore
```

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json .gitignore tasks/builds/vitest-migration/progress.md
git commit -m "test(vitest-migration): wire vitest v8 coverage with no thresholds, record baseline (Phase 6)"
```

### Task 6.12: Phase 6 quarantine audit

**Files:**
- Modify: `tasks/builds/vitest-migration/progress.md`

- [ ] **Step 1: Audit every quarantine for the five-field contract**

```bash
for f in $(grep -rl "@vitest-isolate" --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist .); do
  echo "=== $f ==="
  awk '/@vitest-isolate/,/^[^/]/' "$f" | head -12
done
```

For each file, verify all five fields are present:
- `reason:` — one-line description of the parallel-unsafe behaviour
- `date:` — ISO date the quarantine was added
- `owner:` — team name, handle, or `"unowned"` (flag, not a final state)
- `follow-up:` — references an existing `tasks/todo.md` TI-NNN entry
- `review_after:` — ISO date 30 days from `date:` (enforces I-6 expiry pressure)

If any field is missing, fix the comment before proceeding. `owner: unowned` is allowed but must be explicitly set — blank is not.

- [ ] **Step 2: Author the deferred-decisions follow-ups**

For each item under spec § 8 "Decisions deferred and follow-ups", create a `tasks/todo.md` entry. The list:

- Coverage thresholds — revisit in 2 to 3 months.
- Bash gate audit — separate follow-up under "test infrastructure hygiene".
- QA script audit — same shape as gate audit.
- Trajectory tests — fold into `npm test` decision deferred.
- Frontend tests — per-feature stabilisation trigger.
- API contract tests — same trigger as frontend.
- `dlqMonitorRoundTrip.integration.test.ts` body — already created in Task 6.6.
- Quarantined tests under `// @vitest-isolate` — per-quarantine entries already exist (Task 1.3, Phase 4 quarantines).
- Optional non-blocking shuffled CI job — follow-up.
- Bash gate parallelisation — follow-up if CI time becomes gate-dominated.
- `scopeResolutionServicePure.ts` extraction — already created in Task 6.4 if the gate suppression was used.
- Mission-control tests — separate decision tracked elsewhere.
- Worker test coverage — product decision tied to IEE worker stability.
- `loadFixtures()` style replacement — not in scope.

Each entry uses the standard `### TI-NNN:` shape under `## Test infrastructure hygiene` (or a more specific heading for items not strictly hygiene).

- [ ] **Step 3: Final progress update**

Append to `tasks/builds/vitest-migration/progress.md`:

```markdown
- YYYY-MM-DD: Phase 6 complete. Migration finished.
  Quarantines: <n> total, all with valid four-field contract.
  Deferred-decisions follow-ups created: <n>.
  Coverage tooling wired (no thresholds).
  Engines pinned to Node 20; .nvmrc created.
  Both outliers moved under __tests__/.
  Footguns removed: migrate:drizzle-legacy renamed; playbooks:test deleted (or kept with documented reason).
```

- [ ] **Step 4: Commit**

```bash
git add tasks/builds/vitest-migration/progress.md tasks/todo.md
git commit -m "test(vitest-migration): Phase 6 complete — conventions, footguns, coverage, deferred follow-ups (Phase 6)"
```

### Phase 6 status — DONE (2026-04-30)

Phase 6 (and subsequent post-merge hardening) shipped on PR #238, branch
`claude/vitest-migration-2026-04-29`. Summary of what landed across multiple
commits after the initial Phase 6 work:

- All 6 phases of the Vitest migration complete; bash unit runner deleted.
- 4 orphan-pattern test files (outside `__tests__/` or with zero `test()` blocks) found and migrated.
- 6 half-migrated test files repaired (handwritten harness leftovers — `asyncTest`, `pendingTests`, `passed++`, `Promise.all(pendingTests)`); these caused a 13-min CI hang on the first PR #238 CI run before the fix.
- 22 files converted from `node:assert` to `expect()`.
- 2 outlier files relocated under `__tests__/`; the include allow-list in `vitest.config.ts` removed.
- 3 files with `process.exit` in tests rewritten to use `test.skipIf` / proper test() blocks.
- 16 files: `await import('dotenv/config')` → `import 'dotenv/config'`.
- 18 files: pointless `await` before `test()` removed.
- Module-level env mutations (9 files) converted to `??=` (idempotent).
- 3 more handwritten-harness leftovers found post-CI-hang and fixed: `agentExecution.smoke.test.ts` (run() wrapper), `alertFatigueGuard.regression.test.ts` (tests.push pattern), `crmQueryPlannerService.test.ts` (dead `Promise<void>[]`).
- Unified test-quality gate: `scripts/verify-test-quality.sh` enforces 7 rules — file location under `__tests__/`, no `node:test`/`node:assert`, no handwritten-harness leftovers, no `process.exit`, has at least one `test()/describe()/it()` block, no bare top-level `await`, no module-level env assignment without `??=`. Currently 282 files scanned, 0 violations.
- New `integration` CI job runs the previously-dead 36 `*.integration.test.ts` cases under `NODE_ENV=integration` (currently `continue-on-error: true` while TI-005 audits per-file lifecycle).
- Test count: 4,440 → 4,555 (+115 previously hidden `asyncTest` assertions now actually run).
- Wall clock: 15-min CI hang → 40s clean.

Original exit-gate items below — historical reference.

- Both outlier files moved under `__tests__/` and discoverable by the `**/__tests__/**/*.test.ts` glob without explicit path entries in `vitest.config.ts`.
- `docs/testing-conventions.md` describes Vitest as the single permitted runner and codifies I-7..I-10.
- `docs/testing-structure-Apr26.md` describes the Vitest-based runtime.
- `docs/testing-conventions.md` § "Quarantined tests" lists every `// @vitest-isolate` file with rationale.
- `package.json` has `engines.node = ">=20.0.0 <21.0.0"` and `.nvmrc` contains `20`.
- Vitest v8 coverage configured with directory-based exclude; `test:coverage` script exists; no thresholds.
- `dlqMonitorRoundTrip.integration.test.ts` uses `test.todo()`.
- `package.json`'s `migrate:drizzle-legacy` is renamed `-DO-NOT-USE`; `playbooks:test` deleted (or kept with documented reason).
- Every quarantine passes the five-field-contract audit (reason, date, owner, follow-up, review_after).
- `tasks/builds/vitest-migration/progress.md` has a `## Coverage baseline` section with line/branch/function/statement %.
- Every spec § 8 deferred decision has a corresponding `tasks/todo.md` entry.

---

## 10. Cross-phase invariants reference (I-1 … I-10)

These hold across every phase and are referenced by ID in commit messages, quarantine comments, and `tasks/todo.md` entries. Source: spec § 6.

| ID | Name | Where enforced in this plan |
|----|------|-----------------------------|
| I-1 | Gate / QA layers never change | Phase 0 Task 0.5 (CI push confirms); Phase 5 Task 5.1 step 2 (CI pipeline still chains gates+QA+unit). |
| I-2 | Main is always green | Each phase's exit gate; each batch is its own commit and revertable. |
| I-3a | Vitest discovery count is the source of truth | Phase 1 Task 1.5 step 2 (baseline capture); Phase 3 Task 3.N+1 step 5 (post-outlier update); Phase 5 Task 5.3 (zero-handwritten-survivor grep). Note: `test.todo` registers as a test — Task 6.6 produces a deliberate `+1` in the DLQ file. |
| I-3b | Grep-derived testCount must not diverge beyond whitelisted deltas | Phase 0 Task 0.4 (grep snapshot); Phase 1 Task 1.7 (parity report). Hard rule: grep>0 AND vitest=0 is always a hard failure. |
| I-4a | Dual-run consistency: bash outcome = Vitest outcome (Phases 2–3 only) | Phase 2 Task 2.3 step 6, repeated per batch; Phase 3 Task 3.2 step 7, repeated per batch; Phase 3 Task 3.N+1 (end-of-phase global with `--reporter=json`). Valid matches: pass↔pass, fail↔fail, skip↔skip only. |
| I-4b | Deep-equality spot-check per applicable batch | Phase 2 Task 2.3 step 7; Phase 3 Task 3.2 step 8. |
| I-5 | No silent test deletions | Phase 0 Task 0.2 step 1 (deletion requires rationale in commit body). |
| I-6 | Quarantine contract with expiry pressure | Phase 1 Task 1.3 (first quarantine sets the precedent, five-field contract); Phase 4 Task 4.3 step 5 (per-quarantine contract + budget cap: ≤13 files); Phase 6 Task 6.12 step 1 (audit). Removal procedure codified in conventions doc (Task 6.1 step 3). |
| I-7a | No free-standing top-level statements in integration tests | Phase 3 Task 3.2 step 9 (per-batch grep). |
| I-7b | No module-load side effects in any test (advisory) | Phase 6 Task 6.1 step 2 (codified in conventions doc). |
| I-8a | Env-absence dependencies have explicit assertion | Phase 2 Task 2.3 step 4; Phase 3 Task 3.2 step 4; Phase 6 Task 6.1 step 2 (codified). |
| I-8b | Env mutation must restore | Phase 4 Task 4.3 step 5 (env category); Phase 6 Task 6.1 step 2 (codified). |
| I-9a | New tests not flaking under 3 consecutive runs | Phase 6 Task 6.1 step 2 (codified for future PRs). |
| I-9b | New tests not failing in ≥2 of 10 consecutive runs | Phase 6 Task 6.1 step 2 (codified for future PRs). **Enforcement:** reviewer signal on PR CI observation; NOT a per-PR automated 10-run gate. Phase 4's 10-run gate was migration-only. |
| I-10 | Per-file count drift > ±30% requires PR justification | Phase 6 Task 6.1 step 2 (codified for future PRs). |
| I-11 | Skip rate must not increase materially post-migration | Phase 3 Task 3.N+1 step 3a (skip rate check in global comparison). Threshold: vitest-skips ≤ bash-skips + 5. |

---

## 11. Self-review checklist

Before declaring this plan ready for execution:

- [ ] Spec § 1 (goals) — runtime target, assertion consolidation, outlier discovery, watch/parallel/coverage, single convention, gate/QA layers untouched. **Covered:** Phases 1–5 (runtime + assertion + parallel), Phase 1 Task 1.5 (outlier discovery), Phase 6 Tasks 6.11 (coverage), 6.1 (single convention), explicit § 2 non-goal preserved throughout.
- [ ] Spec § 2 (non-goals) — gates, QA, migrate, trajectory, worker, mission-control all untouched. **Covered:** § 2 of this plan ("Untouched") + each phase's scope respects this list.
- [ ] Spec § 3 (R-M1..R-M9) — every risk has detection + mitigation. **Covered:** R-M1 → Tasks 1.3 + 4.3; R-M2 → Tasks 1.5 + 4.3 + 4.4 step 3; R-M3 → Task 1.5; R-M4 → Tasks 2.3 + 3.2 + 3.N + 6.6; R-M5 → none required (verification only, in Phase 1 fixture inventory Task 1.6); R-M6 → Tasks 1.3 + 4.1 + 6.9; R-M7 → Task 4.3 step 4 (timing-async category); R-M8 → Task 3.N; R-M9 → Task 6.6.
- [ ] Spec § 4 (phased plan) — every phase + every numbered deliverable mapped to a task. Verified above.
- [ ] Spec § 5 (concrete file changes) — every Created/Modified/Deleted/Moved entry mapped to a task. Verified.
- [ ] Spec § 6 (validation + invariants) — exit gates per phase + I-1..I-10 reference table. Verified above.
- [ ] Spec § 7 (estimate) — informational only; not a deliverable. Plan size matches the 21-40 hour estimate.
- [ ] Spec § 8 (deferred decisions) — each gets a `tasks/todo.md` entry in Task 6.12 step 2. Verified.

If any spec section is uncovered, add a task before handing off to execution.








