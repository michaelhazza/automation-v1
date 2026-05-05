# Brief: Lint + Typecheck — install, clean baseline, make CI mandatory

**Slug:** `lint-typecheck-baseline`
**Type:** Significant — multi-domain (tooling + schema cleanup + CI), at least one architectural decision (schema drift triage)
**Authored:** 2026-05-01
**Status:** Awaiting execution session

---

## Contents

1. Why this exists
2. Current repo state (verified 2026-05-01)
3. Baseline measurement (already taken)
4. The architectural question (Phase 2a depends on this)
5. Plan
   - Phase 1 — scaffolding
   - Phase 2 — clean the baseline (2a server typecheck, 2b lint)
   - Phase 3 — make mandatory
6. Out of scope
7. Decisions already made
8. Open questions for the execution session
9. Suggested classification + agent invocations
10. Verification before declaring done
11. Working-tree state to inherit

---

## 1. Why this exists

CLAUDE.md instructs every agent to run `npm run lint` and `npm run typecheck` after non-trivial changes. Neither script existed in the repo. A PR review session on 2026-04-30 surfaced this gap: the reviewer noted *"No lint/typecheck scripts in this repo (CLAUDE.md mentions npx tsc --noEmit as alternative). Skipping lint/typecheck as not applicable."* That kind of skip is silent — no error, no warning, just a gap in the verification pipeline.

This brief covers closing that gap end to end: install the tooling, fix the existing baseline, then promote both checks to mandatory CI gates.

---

## 2. Current repo state (verified 2026-05-01)

- **No ESLint installed.** No `eslint.config.js`, no `.eslintrc*`, no eslint package in `devDependencies`.
- **No `typecheck` script.** Only `build:server` (`tsc -p server/tsconfig.json`) and `build:client` (`vite build`).
- **Two tsconfig projects, both `strict: true`:**
  - Root `tsconfig.json` → `client/src/**/*` (`jsx`, `noEmit`, `paths` for `@/*`)
  - `server/tsconfig.json` → `server/**/*.ts` + `shared/**/*.ts` (rootDir `..`, outDir `../dist`)
- **CI** in `.github/workflows/ci.yml` runs only on PRs labeled `ready-to-merge`. Two jobs: `unit_tests` (blocking) and `integration_tests` (`continue-on-error: true`).
- **Branch `claude/agentic-engineering-notes-WL2of`** has uncommitted working-tree changes adding the script entries to `package.json` (block of 5 scripts inserted after `build:client`). The next session can keep or revert these — they're additive, no existing script touched.

---

## 3. Baseline measurement (already taken)

Ran `tsc --noEmit` against both projects on `main` (verified by checking out `main`'s `server/` and `shared/` over the branch's tree):

| Project | tsc --noEmit errors |
|---------|---------------------|
| Root (`tsconfig.json` — client) | **0** |
| Server (`server/tsconfig.json` — server + shared) | **248** |

Client is clean. Server is deeply red. **The 248 errors exist on `main`** — they are baseline tech debt, not branch WIP.

ESLint baseline cannot be measured until ESLint is installed (Phase 1).

### Server typecheck error clusters

The 248 errors are concentrated, not scattered. Spot-check sample:

- **`server/services/systemMonitor/triage/*` (the bulk).** Code references columns that don't exist on the `system_incidents` table: `triageStatus`, `lastTriageAttemptAt`, `lastTriageJobId`, `triageAttemptCount`. Code also references event-type variants not in the union: `agent_triage_timed_out`, `agent_triage_skipped`, `agent_auto_escalated`, `agent_triage_failed`. Looks like an in-flight schema migration where the application code shipped but the schema additions did not (or vice versa).
- **`server/services/systemMonitor/triage/writeHeuristicFire.ts`.** Imports `systemMonitorHeuristicFires` from `db/schema/index.js`; that export does not exist.
- **`server/services/workspace/workspaceEmailPipelinePure.ts:27`.** Calls `String.prototype.replaceAll`. Server tsconfig's `target: ES2020` doesn't include `replaceAll` (ES2021+). Fix by bumping `lib` to `["ES2021"]` or rewriting the call.
- **`server/tests/services/agentRunCancelService.unit.ts:176`.** Type-narrowing comparison error — comparing a value typed as `'pending' | 'running' | 'delegated'` against `'cancelling'`. Likely stale test or stale type.
- **`shared/__tests__/stateMachineGuardsPure.test.ts:155`.** Function called with 1 argument but signature expects 2. Likely API drift.

The bulk (>200) is the schema-drift cluster. That cluster needs a single architectural decision before any individual error gets fixed.

---

## 4. The architectural question (Phase 2a depends on this)

For the schema-drift cluster: **are the missing columns and event types code-debt or schema-debt?**

- **If schema-debt** (the schema was supposed to grow but the migration was never written): write the migration, regenerate Drizzle types, errors clear themselves.
- **If code-debt** (the feature was abandoned and the code is dead): revert the dead branches, delete the orphan call sites.
- **If half-and-half:** the worst case — some columns are real and need migrations, others are dead and need reverting.

This must be decided before any line of triage cleanup is touched. Recommended: invoke `architect` with the relevant `git log` plus the original spec for the system-monitor triage feature in hand. One sitting should be enough to decide column-by-column.

**Do not start fixing individual errors before this decision.** Fixing them ad-hoc — adding the columns to schema without migrations, or stubbing types in to silence errors — will compound the debt.

---

## 5. Plan

Three phases. Phases 1 and 3 are mechanical. Phase 2 is the real work.

### Phase 1 — scaffolding (~30 min)

1. **Confirm or restore the script entries in `package.json`** (working tree of branch `claude/agentic-engineering-notes-WL2of` has them). Block to insert after `"build:client"`:
   ```json
   "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p server/tsconfig.json",
   "typecheck:client": "tsc --noEmit -p tsconfig.json",
   "typecheck:server": "tsc --noEmit -p server/tsconfig.json",
   "lint": "eslint .",
   "lint:fix": "eslint . --fix",
   ```
2. **Install ESLint deps:**
   ```
   npm install --save-dev eslint typescript-eslint eslint-plugin-react-hooks globals
   ```
3. **Create `eslint.config.js` (flat config, ESLint 9+).** Recommended starting rules:
   - `typescript-eslint` recommended (errors)
   - `react-hooks/rules-of-hooks` (error), `react-hooks/exhaustive-deps` (warn)
   - `no-undef` off (TypeScript handles it)
   - Ignore: `dist/`, `node_modules/`, `client/dist/`, `coverage/`, generated drizzle output
   - Two file-pattern overrides: client (with React + jsx-a11y), server (no React)
4. **Run `npm run lint` once, capture violation count by rule** to a scratch file. This is the input to Phase 2b's triage decision.

`config-protection` hook will require explicit user approval for the `package.json` edit and the `eslint.config.js` create. Quote the diff verbatim and ask before sentinel.

### Phase 2 — clean the baseline

Two sub-tracks. Can run in parallel by two agents/sessions, but 2a must complete its architectural decision before its execution starts.

#### Phase 2a — server typecheck cleanup

1. **Decide schema-debt vs code-debt** (see § 4). Invoke `architect`. Output: a per-column / per-event-type table with the chosen disposition (add migration / revert code / stub-and-defer).
2. **Execute the decision.** Migrations go through `npm run db:generate` → review the generated SQL → apply. Reverts go through normal edits.
3. **Fix the non-cluster errors:**
   - Bump `server/tsconfig.json` `lib` to include `ES2021` (or rewrite the `replaceAll`).
   - Fix `agentRunCancelService.unit.ts:176` (read the actual state machine, align the test).
   - Fix `stateMachineGuardsPure.test.ts:155` (read the function signature, fix the call).
4. **Verify `npm run typecheck:server` exits 0.** Re-run after each change cluster — don't batch.

#### Phase 2b — lint cleanup

1. **From Phase 1.4, sort violations by rule, descending count.**
2. **Triage policy:**
   - Rule with **<50 violations across the codebase** → fix in this PR.
   - Rule with **>50 violations** → either downgrade to `warn` (and document why) or carve out a follow-up cleanup PR. Decision per-rule based on whether the rule catches likely bugs vs cosmetic concerns.
   - Rule that catches likely bugs (`react-hooks/rules-of-hooks`, `@typescript-eslint/no-floating-promises`, `no-case-declarations`) → never downgrade. Fix or block.
3. **Apply `npm run lint:fix` first** to clear auto-fixable violations.
4. **Verify `npm run lint` exits 0** with the chosen rule severities.

### Phase 3 — make mandatory (~30 min)

1. **Add CI job** to `.github/workflows/ci.yml`:
   - Job name: `lint_and_typecheck`
   - Trigger: every PR push (no `ready-to-merge` label gate — this is fast, sub-1-min)
   - Steps: `actions/checkout@v4`, `actions/setup-node@v4` (Node 20, npm cache), `npm ci`, `npm run lint`, `npm run typecheck`
   - `continue-on-error: false` — blocking from day one
2. **Update CLAUDE.md verification commands table** (§ Verification Commands):
   - `npm run lint` line: remove the "no script" caveat if any
   - `npm run typecheck (or npx tsc --noEmit)` → drop the fallback, just `npm run typecheck`
3. **Update review-agent definitions** so `pr-reviewer`, `spec-conformance`, and `dual-reviewer` run both checks during their verification phase and treat failures as blocking. Files: `.claude/agents/pr-reviewer.md`, `.claude/agents/spec-conformance.md`, `.claude/agents/dual-reviewer.md`. (`adversarial-reviewer` is read-only, no change needed.)
4. **Verification gate test:** force a deliberate type error in a throwaway branch, push, confirm CI's `lint_and_typecheck` job fails and blocks merge. Revert.

---

## 6. Out of scope (do not creep into this work)

- **Pre-commit hooks (husky/lint-staged).** Explicitly skipped — slow, frustrating, CI catches it. If proposed, push back.
- **Prettier.** Separate decision. ESLint can cover most formatting; bringing Prettier in is its own project.
- **Stricter ESLint rules.** Start permissive (recommended preset). Ratcheting up happens in follow-up PRs once the codebase has zero violations at the current level.
- **Fixing the existing build:server failures unrelated to type errors.** If `tsc -p server/tsconfig.json` was already broken on main, that's a separate concern from this brief — though Phase 2a will likely fix it as a side effect.
- **Tightening tsconfig** (e.g., `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Defer.

---

## 7. Decisions already made (do not relitigate)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ESLint config format | Flat (`eslint.config.js`) | ESLint 9+ default; modern; deprecation path is clear |
| Initial strictness | Permissive — errors only for likely-bugs, warnings for cleanup | 248 server type errors already exist; piling on lint errors makes the gate impossible to pass |
| Pre-commit hook | None | CI is the gate, not the dev's keyboard |
| typecheck scope | Both tsconfigs | Otherwise root `tsc --noEmit` only covers client; server needs its own pass |
| CI job position | New job, ungated by `ready-to-merge` label | Fast (<1 min), should run on every push; existing label-gated jobs stay as-is |
| typecheck:client / typecheck:server splits | Yes | Faster local iteration when working in one half of the codebase |
| Will CI gate be blocking from day one? | **Yes — the whole point is to make it mandatory** | Phase 3 is "make mandatory." Don't ship it as advisory. |

---

## 8. Open questions for the execution session

These are real decisions, not relitigations:

1. **Schema-debt vs code-debt** for the `systemMonitor/triage/*` cluster (Phase 2a). Needs `architect` involvement. Output a column-by-column table.
2. **Lint rule severity per noisy rule** (Phase 2b). Depends on the violation count distribution from Phase 1.4. Document the call.
3. **Should `verify-workspace-actor-coverage` (currently a separate CI step) move into the new `lint_and_typecheck` job, or stay separate?** Current setup: it runs after migrations, before tests, only on `ready-to-merge`. Decision: probably keep it where it is — it depends on a live DB.

---

## 9. Suggested classification + agent invocations

- **Class: Significant.** Multi-domain (tooling + schema + CI), one architectural decision (Phase 2a).
- **Sequence:**
  1. `architect: lint-typecheck-baseline phase 2a — decide schema-debt vs code-debt for systemMonitor/triage/*` (run **before** any execution)
  2. Execute Phase 1 (mechanical)
  3. Execute Phase 2a per architect's plan
  4. Execute Phase 2b (lint cleanup, triage-driven)
  5. Execute Phase 3 (CI + docs)
  6. `pr-reviewer: review the lint/typecheck/CI changes`
  7. (Optional) `dual-reviewer` if user explicitly asks

`spec-conformance` does not apply — there is no spec; this brief is the source of truth.

---

## 10. Verification before declaring done

All of these must be true:

- [ ] `npm run lint` exits 0 on a clean checkout of the merged branch
- [ ] `npm run typecheck` exits 0 on a clean checkout of the merged branch
- [ ] CI's `lint_and_typecheck` job runs on every PR push (not just `ready-to-merge`)
- [ ] CI's `lint_and_typecheck` job is blocking (`continue-on-error: false` or absent)
- [ ] Deliberate type error in a test branch causes the CI job to fail and block merge — verified, then reverted
- [ ] CLAUDE.md verification table no longer references `npx tsc --noEmit` as a fallback
- [ ] `pr-reviewer.md`, `spec-conformance.md`, `dual-reviewer.md` updated to run both checks as blocking
- [ ] No new errors introduced — `git diff main` against the schema or production code does not introduce changes unrelated to the brief's stated phases (the architect's decisions in Phase 2a are the exception, and they should be small and pointed)

---

## 11. Working-tree state to inherit

Branch `claude/agentic-engineering-notes-WL2of` has uncommitted changes to:
- `package.json` — adds the 5 script entries described in Phase 1.1
- `tasks/review-logs/_index.jsonl` and `tasks/review-logs/chatgpt-pr-review-claude-agentic-engineering-notes-WL2of-2026-04-30T20-06-11Z.md` — unrelated to this brief, leave them be

The execution session can either start from a fresh branch off `main` (cleanest), or rebase `claude/agentic-engineering-notes-WL2of` onto `main` and continue from there. Cleanest: fresh branch.
