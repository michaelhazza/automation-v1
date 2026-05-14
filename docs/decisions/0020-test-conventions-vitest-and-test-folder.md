# ADR-0020: Test conventions — Vitest only, `__tests__/` folder, `.js` relative imports

**Status:** accepted
**Date:** 2026-05-13
**Domain:** tests / tooling
**Supersedes:** _n/a_
**Superseded by:** _n/a_

## Context

The test-conventions rules were enforced by `scripts/verify-test-quality.sh`, CLAUDE.md prose, `references/test-gate-policy.md`, and a steady stream of KNOWLEDGE.md entries — but never recorded as a single durable decision. The three rules below are the most-violated and most-corrected items in the codebase:

1. **Runner is Vitest.** No `node:test`, no `node:assert`, no `npx tsx` harnesses. Multiple legacy migrations (PR #239 vitest-migration, PR #267 Phase 3 test rework) closed re-invented runners.
2. **Tests live in `__tests__/` directories.** Path-only inline locations (`server/services/foo.test.ts`) are invisible to Vitest's discovery glob and rejected by `verify-test-quality.sh`. The right shape is `server/services/__tests__/foo.test.ts`.
3. **Relative imports inside tests end in `.js`.** TypeScript-ESM `nodenext` resolution + `verify-pure-helper-convention.sh` require `from '../fooPure.js'` — not `from '../fooPure'` and not `from './fooPure'`.

These rules apply identically to `server/`, `client/`, and `shared/`. A single ADR makes the rationale durable and prevents future "should we move to xyz runner?" cycles.

## Decision

We will continue to use **Vitest as the single test runner** for all test files in this repo. Tests **MUST** live under a `__tests__/` directory next to the module being tested. Relative imports inside tests **MUST** end in `.js` (per TypeScript-ESM `nodenext` resolution). No exceptions.

The full rule list lives in `docs/testing-conventions.md` and is enforced by `scripts/verify-test-quality.sh` and `scripts/verify-pure-helper-convention.sh`. This ADR is the authority for the *why*; the script is the authority for the *what fails*.

## Consequences

- **Positive:**
  - One runner, one discovery glob, one set of mock helpers (`vi.mock`, `vi.fn`).
  - Pure-helper extraction pattern (sibling `*Pure.ts` files with `.js` import in the test) becomes the default shape across server and client.
  - CI gate catches every silent invisibility ("test file exists but Vitest never ran it") class.
- **Negative:**
  - One-time migration tax on any imported library or contributor used to `node:test` / Jest / Mocha.
- **Neutral:**
  - The `.js` extension on relative imports inside `__tests__/` looks odd to non-ESM-aware contributors, but it is the only shape that satisfies both nodenext and the verify script. This is a permanent shape, not a transition state.

## Alternatives considered

- **Allow `node:test` as a "lightweight" sibling runner** — rejected. Already produced multiple cycles of "this file was authored against the wrong runner and silently passed locally"; the verify script exists specifically to ban this.
- **Place tests in a top-level `tests/` directory** — rejected. The co-located `__tests__/` shape is what Vitest discovers automatically and what every other vitest-using project assumes.

## When to revisit

Re-open when **any one** of these triggers fires:
- Vitest itself is deprecated by its maintainers or replaced industry-wide by a runner the repo decides to adopt.
- The TypeScript ESM `.js` import convention changes (nodenext semantics shift in a future TypeScript major).

If neither happens: **Permanent — re-open only on incident.**

## References

- Convention doc: `docs/testing-conventions.md`
- Policy: `references/test-gate-policy.md`
- Gate scripts: `scripts/verify-test-quality.sh`, `scripts/verify-pure-helper-convention.sh`
- Related items from legacy todo.md: TI-001/002/003/005-008, PR #239 vitest-migration follow-ups, framework-standalone-repo deferred items
