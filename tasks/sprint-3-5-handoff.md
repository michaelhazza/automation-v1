# Sprint 3-5 Handoff Brief

Short brief for starting a new session to execute the remaining sprints of
`docs/improvements-roadmap-spec.md`. Sprints 1 and 2 are merged to main.

## Table of contents

1. Scope reality check
2. Paste-ready starter prompt
3. Pre-session checklist
4. Sprint 3 scope (detailed)
5. Sprint 4 & 5 scope (short notes)
6. Gotchas from Sprint 2
7. Verification recipe

---

## 1. Scope reality check

Sprints 3, 4, and 5 together are significantly larger than Sprint 2. Doing
all three in a single session is not realistic — each sprint introduces new
subsystems (reflection loop, checkpoint/resume, policy DSL expansion, cost
governance, observability), and each needs its own architect pass, build,
pr-reviewer, and dual-reviewer cycle.

Recommended split:

- **Session A — Sprint 3** (P2.1 checkpoint/resume, P2.2 reflection loop,
  P2.3 policy DSL slices A/B/C, agent-run-cleanup cron). The bulk of the
  remaining complexity sits here.
- **Session B — Sprint 4** (P3.1 cost governance + per-org ledger, P3.2
  observability dashboards, P3.3 failure-mode drills).
- **Session C — Sprint 5** (P4.* hardening, final gate flips,
  baseline-zero rollout).

If you want to compress: Sessions B and C can realistically be merged into
one, but keep Sprint 3 on its own session.

## 2. Paste-ready starter prompt

Copy this into the new session to kick things off:

```
We just merged Sprint 2 of docs/improvements-roadmap-spec.md to main
(commit 939b4b4, PR "feat(sprint-2): P1.1 fail-closed isolation + P1.2
regression replay").

Read tasks/sprint-3-5-handoff.md end-to-end first. Then read the Sprint 3
section of docs/improvements-roadmap-spec.md (P2.1, P2.2, P2.3) and
docs/spec-context.md for framing.

Classify this as a Major task. Build order:
  1. architect: produce the Sprint 3 implementation plan
  2. implement P2.2 reflection loop
  3. implement P2.3 policy DSL slices A \u2192 B \u2192 C
  4. implement P2.1 checkpoint/resume
  5. add the agent-run-cleanup cron job
  6. add Sprint 3 gates (list them in the plan)
  7. add Sprint 3 unit tests (pure helpers only)
  8. final verification: build:server, test:unit, GUARD_BASELINE=true
     bash scripts/run-all-gates.sh
  9. pr-reviewer \u2192 dual-reviewer
 10. create a PR against main on branch claude/build-sprint-3-<slug>

Do NOT touch Sprint 4/5 work in this session. Stop at Sprint 3 PR creation.
```

## 3. Pre-session checklist

Before running the starter prompt, confirm:

- [ ] `main` is up to date locally and Sprint 2 is merged (`git log --oneline
      -5` should show the Sprint 2 commit).
- [ ] `npm ci` is clean and `npm run build:server` passes on `main`.
- [ ] `GUARD_BASELINE=true bash scripts/run-all-gates.sh` passes on `main`
      (21 pre-existing blocking failures are expected; Sprint 2 added zero
      regressions).
- [ ] `scripts/guard-baselines.json` matches the state at Sprint 2 merge.
- [ ] The new branch `claude/build-sprint-3-<slug>` does not yet exist on
      the remote.

## 4. Sprint 3 scope (detailed)

Build order matters — later items depend on earlier ones.

### P2.2 Reflection loop (build first)

- New service: `server/services/reflectionService.ts` with a pure helper
  `reflectionServicePure.ts` sibling (mandatory under the pure-helper
  convention).
- Reflection prompt drafting is deterministic given (run summary, rejected
  actions, tool manifest). The pure helper takes the inputs and returns
  the prompt string. The service wraps it with db loads + the LLM call.
- Wire it into the review-rejection path so a rejection can optionally
  enqueue a reflection job (new pg-boss job `reflection-tick`) alongside
  the regression-capture job that already exists from Sprint 2 P1.2.
- Every new job needs `idempotencyStrategy` in `server/config/jobConfig.ts`
  (see Sprint 2 gate `verify-job-idempotency-keys.sh`). For reflection,
  use `'one-shot'` keyed on the review_item id.

### P2.3 Policy DSL slices (build after reflection)

Do the slices in strict order. Each slice is independently testable.

- **Slice A — structural predicates.** Extend `policyEngineService.matchesRule`
  (exported in Sprint 2) to support `any_of` / `all_of` condition groups.
  Pure tests go next to the existing `policyEngineService.scopeValidation.test.ts`.
- **Slice B — numeric comparators.** `gt`, `gte`, `lt`, `lte`, `between`
  on numeric claim values. Guard: every new comparator needs a pure test.
- **Slice C — time-window predicates.** `within_last`, `between_times`.
  The pure helper must take a `now: Date` parameter so tests are
  deterministic — do NOT read `new Date()` inside the comparator.

### P2.1 Checkpoint + resume (build after policy DSL)

- New table `agent_run_checkpoints` via Drizzle migration. Columns:
  `id`, `run_id`, `organisation_id`, `checkpoint_kind`, `payload_json`,
  `created_at`.
- Add the table to `server/config/rlsProtectedTables.ts` and write a
  matching RLS policy migration in the same commit — the
  `verify-rls-coverage.sh` gate will fail otherwise.
- Resume flow: `resumeFromCheckpoint(runId)` loads the latest checkpoint,
  replays the run loop from that state. Use `withOrgTx` + `getOrgScopedDb`
  everywhere; never touch the raw `db` handle from a service.
- Pure helper: `buildResumeContext(checkpoint, runMetadata)` returning the
  replay input shape. Test this separately from the db-touching wrapper.

### Agent-run-cleanup cron (build last)

- New pg-boss job `agent-run-cleanup` on a daily cron (03:00). Purpose:
  prune `agent_runs` older than the retention window (default 90 days)
  that are in a terminal state. Retention config lives in
  `server/config/limits.ts`.
- `idempotencyStrategy: 'fifo'` — every tick is idempotent because the
  cleanup is an upsert-delete that converges.
- Admin-bypass sweeps: use `withAdminConnection` + `SET LOCAL ROLE admin_role`
  (same pattern as `runRegressionReplayTick` from Sprint 2).

### Sprint 3 gates to add

Draft the list during the architect step. At minimum:

- `verify-reflection-loop-wired.sh` — rejection path must enqueue the
  reflection job. Structural parallel to the regression-capture gate.
- `verify-policy-dsl-comparators.sh` — every declared comparator in the
  DSL registry must have a matching pure test file.
- `verify-checkpoint-rls-coverage.sh` — the new checkpoint table must
  appear in `rlsProtectedTables.ts`. (Or extend the existing RLS coverage
  gate if it already enforces per-table; check first.)

Every new gate needs a `guard-baselines.json` entry and a wire-up in
`scripts/run-all-gates.sh` under a new "Sprint 3 gates" section.

### Sprint 3 unit tests

Pure tests only — the pure-helper convention gate is strict. Targets:

- `reflectionServicePure.test.ts` — prompt determinism, input edge cases.
- `policyEngineService.scopeValidation.test.ts` (append) — slices A/B/C
  comparators.
- `buildResumeContext.test.ts` — checkpoint replay shape.

## 5. Sprint 4 & 5 scope (short notes)

These are sketches, not detailed plans. The next session's architect pass
should flesh them out.

### Sprint 4 — cost governance + observability

- **P3.1 cost governance**: per-org llm cost ledger, daily rollup,
  budget-cap enforcement. Extends the existing `iee-cost-rollup-daily`
  job. New enforcement middleware `enforceOrgBudget` that throws a
  `402 PaymentRequired` style error when an org is over budget.
- **P3.2 observability**: Grafana dashboards for the Sprint 2 fail-closed
  layers (RLS denials, scope assertion failures, regression-case flips).
  This is mostly config + dashboard JSON, not code.
- **P3.3 failure-mode drills**: chaos tests that intentionally break the
  ALS context propagation and assert the system fails closed (not open).

### Sprint 5 — hardening + baseline zero

- **P4.* hardening**: address the 21 pre-existing blocking gate failures
  baked into `scripts/guard-baselines.json`. Each is its own mini-task —
  treat them as a checklist.
- **Gate flips**: drop all Sprint 1-3 gate baselines to 0 once all known
  violations are cleaned up.
- **Final spec sign-off**: update `docs/improvements-roadmap-spec.md` with
  the completion state and archive the per-sprint task files under
  `tasks/archive/`.

## 6. Gotchas from Sprint 2

These bit us during Sprint 2 and will bite again if you are not watching.

- **Drizzle column vs field names.** The `actions` table column is
  `payload_json` but the schema field is `payloadJson`. Services must use
  the field name (`actionRow.payloadJson`), never the column name. Same
  pattern applies anywhere a column has a `_json` suffix.
- **Top-level await in a script file** requires the file to be a module.
  Add `export {};` after the header comment or TypeScript will refuse to
  compile with "'await' expressions are only allowed at the top level of
  a file when that file is a module".
- **Dynamic-import integration tests trip the pure-helper gate.** The
  `verify-pure-helper-convention.sh` gate requires every `*.test.ts`
  under `__tests__/` to `import` from a sibling module statically. If
  you are writing an integration test that must dynamic-import to
  preserve a skip-path (e.g. the `DATABASE_URL` not-set skip), prepend
  this as the very first line of the file:
  ```
  // guard-ignore-file: pure-helper-convention reason="Integration test \u2014 dynamic imports required so npm run test:unit can skip without DATABASE_URL"
  ```
  This is the only sanctioned escape hatch. The file-level suppression
  must live on line 1, before any `/**` doc comment.
- **`verify-rls-contract-compliance.sh` baseline is 31.** Thirty-one raw
  `db` imports remain outside the sanctioned boundary. Do NOT refactor
  these as a side quest during Sprint 3 — they are explicitly deferred
  to Sprint 5 P4.*. Touching them now will balloon the PR.
- **`GUARD_BASELINE=true` is required** to run gates locally without
  false-positives from pre-existing violations. The CI wrapper sets this
  automatically; the local `scripts/run-all-gates.sh` invocation needs
  it on the command line.
- **Admin-bypass sweeps** (replay tick, cleanup cron, fixture teardown)
  must use `withAdminConnection` and `SET LOCAL ROLE admin_role` — the
  regular org-scoped handle is subject to RLS like any caller and will
  see zero rows. Copy the pattern from
  `server/jobs/regressionReplayJob.ts`.
- **No emojis anywhere.** No emojis in code, commits, docs, PR bodies,
  test names, log lines. The user's preferences are strict on this.
- **No auto-commits, no auto-PRs.** The user commits explicitly after
  reviewing. The main session should stop at "ready for commit" and
  hand control back. PRs are only created when the user says so.
- **Every new pg-boss job** needs an `idempotencyStrategy` field in
  `server/config/jobConfig.ts`. The Sprint 2
  `verify-job-idempotency-keys.sh` gate will fail the build otherwise.
  Valid values: `'singleton-key' | 'payload-key' | 'one-shot' | 'fifo'`.
- **Every new RLS-protected table** needs (a) an entry in
  `server/config/rlsProtectedTables.ts` AND (b) a matching RLS policy
  migration in the same commit. The `verify-rls-coverage.sh` gate
  enforces this as a structural parallel.

## 7. Verification recipe

Run this sequence at the end of each sprint's build phase, before
invoking pr-reviewer. Fix anything that fails — do not advance with
broken checks.

```bash
# 1. TypeScript compiles
npm run build:server

# 2. Pure unit tests pass
npm run test:unit

# 3. All gates pass (with Sprint 2 baselines)
GUARD_BASELINE=true bash scripts/run-all-gates.sh

# 4. Lint clean
npm run lint

# 5. Full typecheck (client + server)
npm run typecheck
```

Expected state after a clean Sprint 3 run:

- `build:server` — exit 0, no TypeScript errors.
- `test:unit` — all pure tests green, new Sprint 3 tests included.
- `run-all-gates.sh` — 21 pre-existing blocking failures still present
  (Sprint 5 cleanup territory), ZERO new regressions introduced by
  Sprint 3, new Sprint 3 gates all passing at baseline 0.
- `lint` — exit 0.
- `typecheck` — exit 0.

If a Sprint 3 gate you just added reports a non-zero baseline, that's a
red flag — the new gate should start at zero because the code it
enforces is also new. Do not bump the baseline to "make it green" — fix
the code.

After verification passes:

1. `pr-reviewer: review the Sprint 3 changes I just made`
2. Address pr-reviewer findings.
3. `dual-reviewer: Sprint 3 implementation — reflection loop, policy DSL slices A/B/C, checkpoint/resume, agent-run-cleanup cron`
4. Address dual-reviewer findings.
5. Only then create the PR against `main`.
