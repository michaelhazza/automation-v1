# Test Gate Policy

> Single source of truth for the "test gates are CI-only — never run locally" rule. Referenced from `CLAUDE.md`, every agent in `.claude/agents/`, and every spec/plan in `docs/` and `tasks/builds/`.

This file replaces ~10 duplicated copies of the same rule across the agent fleet.

## Rule

**Continuous integration runs the complete test/gate suite as a pre-merge gate.** No local agent or development session runs the full battery. This applies to every agent in `.claude/agents/`, every skill, every review loop iteration, and every main-session task — no carve-outs.

## Forbidden locally

- `npm run test:gates`, `npm run test:qa`, `npm run test:unit`, the umbrella `npm test`.
- `bash scripts/run-all-unit-tests.sh`, `bash scripts/run-all-gates.sh`.
- Any individual `scripts/verify-*.sh` or `scripts/gates/*.sh` invocation.
- Any "regression sanity check", "quick re-verify everything", "confirm no regression" framing — these are dressed-up gate runs.

## Allowed locally

- `npm run lint`.
- `npm run typecheck` (or the dual-tsconfig form per `replit.md`).
- `npm run build:server` / `npm run build:client` when the change touches the build surface.
- **Targeted execution of unit tests authored for THIS change** — a single test file via `npx vitest run <path-to-test>`. Confirm the new test runs and passes. Not to re-run anything else.

**Runner: Vitest 2.x.** Unit tests live at `**/__tests__/*.test.ts`, import `test`/`expect` from `vitest`, and run via `npx vitest run <path>`. Do NOT author tests with `node:test`, `node:assert`, handwritten harnesses, `process.exit` exit-codes, or `npx tsx`-runnable shapes — `scripts/verify-test-quality.sh` rejects them and CI will fail the PR. See `docs/testing-conventions.md` for the canonical pattern. The one carve-out: `scripts/__tests__/*.test.ts` are script-helper checks (not unit tests) and run via `npx tsx` per `scripts/README.md`.

Authoring tests and gates is encouraged. Running the full battery of them locally is not. CI handles that.

## Why

- CI is the authoritative gate runner. Local runs drift. Trust the canonical surface.
- Whole-repo verifiers are slow. They burn agent time without producing new signal.
- Local runs encourage "make this gate pass" patches that hide root causes. CI's pre-merge run catches them anyway.
- Pre-production posture: gate state shifts as the codebase shifts. The CI run is the only one fresh enough to act on.

## What this means for plans and specs

- A plan's "Verification commands" section per chunk lists ONLY lint, typecheck, build:server/client (when relevant), and targeted unit tests for that chunk. No `scripts/verify-*.sh`, no `npm run test:*` umbrella commands.
- A plan does NOT include a "Phase 0 baseline gate run" or a "Programme-end full gate set" section. CI does both.
- A spec MUST NOT instruct implementers to run any forbidden command above. Spec-reviewer auto-fixes specs that do.
- A pull request that requires the operator to "run the gates locally to confirm" before merging is mis-scoped. Either CI catches it, or it's not gate-relevant.

## Pre-existing gate violations

If a plan or implementation suspects pre-existing gate violations:
1. Identify the suspected violation by static reasoning (read the code, read the gate script's grep pattern, point at the offending line).
2. If the new code clearly depends on the violating pattern, add a "Pre-existing violation to fix" item to the plan with the file, the fix, and a one-line justification.
3. CI will catch any baseline violation we missed when the PR is opened — that is the expected behaviour. Don't pre-empt CI by running gates locally.

## How to reference this file

Agent files and specs that need to enforce the rule should link here rather than embedding their own copy:

```markdown
**Test gates are CI-only.** See [`references/test-gate-policy.md`](../../references/test-gate-policy.md). The forbidden / allowed lists live there; this agent enforces them at <step or boundary>.
```

Agents may add a one-line clarification specific to their step (e.g. "step 5 re-verification is limited to reading the affected file back; never runs gates"), but should not duplicate the forbidden / allowed lists.

## Audit-prevention-gates policy (2026-05-14)

Introduced by the `audit-prevention-gates-2026-05-14` build. The three contracts below extend (do not replace) the canonical "Test gates are CI-only" rule.

**Baseline expiry policy.** The expiry framework applies to **violation-list baselines** — baselines under `scripts/.gate-baselines/<guard-id>.txt` whose entries match the canonical violation-key format `<relative-path>:<line>:<message>`. Each such entry MUST be preceded by an `# expires: YYYY-MM-DD` directive on the line above. Entries become warning (exit 2 contribution) at expiry; entries become error (exit 1 contribution) after `GATE_GRACE_DAYS` (default 30) past expiry. Implementation: `scripts/lib/guard-utils.sh::check_expiring_baseline` (introduced by chunk 1).

**Per-file count baselines are out of scope for the expiry framework.** Baselines under `scripts/.gate-baselines/` that use the `<relative-path>:<count>` format — currently `any-budget.txt` and `marker-budget.txt`, consumed by `scripts/verify-any-budget.sh` (P9) and `scripts/verify-marker-budget.sh` (P10) via `scripts/lib/per-file-counter-pure.mjs::parsePerFileBudgetBaseline` — promote on **count growth**, not on calendar expiry. Any `# expires: YYYY-MM-DD` lines in those two files are informational soft-deadlines for human review only; `parsePerFileBudgetBaseline` strips them and `diffAgainstBaseline` compares counts only. Adding expiry enforcement to these gates is tracked as a follow-up — see `tasks/todo.md § BUDGET-EXPIRY-ENFORCEMENT-1`. New per-file count gates SHOULD NOT add `# expires:` directives until that follow-up lands.

**Suppression annotation grammar.** Five forms supported in declining preference order:
- T1 preferred: `// guard-ignore: <guard-id> reason="<rationale>"`
- ADR shape: `// guard-ignore: <guard-id> ADR-<id> <rationale>` (used by gates that require ADR sign-off for new baselines)
- Legacy with `reason="..."`: same shape, accepted for transition
- T0 deprecated: `// guard-ignore: <guard-id>` (no reason) — gates emit `error` severity on T0-only suppressions
- Next-line and file-scoped: documented in the `guard-utils.sh` header

Cross-reference the suppression-grammar header block at the top of `scripts/lib/guard-utils.sh`.

**Warning-first promotion policy.** New gates ship with `default_exit_code=2` (warning). Promotion to `exit 1` (error) is per-gate, operator-initiated, after a minimum one-week soak post-merge. Each promotion is a single-gate PR that flips the gate's `DEFAULT_EXIT_CODE` and surfaces any baseline expirations the soak window revealed. Cross-reference Operator decision §C1 of the prevention-gates plan at `tasks/builds/audit-prevention-gates-2026-05-14/plan.md`.
