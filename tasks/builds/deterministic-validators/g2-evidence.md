# G2 Integrated-State Evidence — deterministic-validators

**Run at:** 2026-05-19
**Branch:** claude/deterministic-validators-3Xjcb
**HEAD:** e570141f (post all 6 chunks + 3 fix commits)

## Lint

```
$ npm run lint
✖ 879 problems (0 errors, 879 warnings)
  0 errors and 8 warnings potentially fixable with the `--fix` option.
```

Result: **0 errors**. 879 warnings are pre-existing (no new warnings introduced by this branch — same count as main).

## Typecheck

```
$ npm run typecheck
> tsc --noEmit -p tsconfig.json && tsc --noEmit -p server/tsconfig.json
```

Result: **Clean exit, no errors.** Dual tsconfig (client + server) both pass.

## Build:client

```
$ npm run build:client
vite v5.4.21 building for production...
✓ 670 modules transformed.
✓ built in 5.01s
```

Result: **Clean build, 670 modules.**

## Targeted tests

```
$ npx vitest run server/lib/scorecardValidators/__tests__/ \
    server/services/__tests__/scorecardDispatcher.test.ts \
    server/services/__tests__/scorecardDispatcherPure.test.ts \
    server/jobs/__tests__/scorecardJudgeJob.test.ts \
    server/routes/__tests__/validators.test.ts \
    server/services/__tests__/validatorAuditService.test.ts

Test Files: 15 passed (15)
     Tests: 121 passed (121)
  Duration: 7.52s
```

Breakdown:
- 9 validator unit test files (67 tests total): output_non_empty, output_schema_valid, output_length_within_bounds, no_forbidden_phrase, pii_pattern_absent, cited_entity_exists, action_set_within_allowlist, numeric_within_tolerance, date_in_format
- 1 registry test (6 tests)
- 1 dispatcher pure test (16 tests)
- 1 dispatcher orchestrator test (13 tests)
- 1 judge job test (6 tests)
- 1 validators route test (9 tests)
- 1 audit service test (10 tests)

Result: **121 / 121 passing.**

## Source logs

- `g2-lint.log` — final 3 lines of `npm run lint`
- `g2-typecheck.log` — final 5 lines of `npm run typecheck`
- `g2-tests.log` — final 10 lines of targeted-test run
