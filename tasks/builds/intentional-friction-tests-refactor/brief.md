# Brief — Replace "intentional friction" tests with property-based structural assertions

**Status:** DRAFT — operator-captured 2026-05-12 as the follow-up to PR #291 (personal-assistant-v1) auto-fix iteration 3.

## Problem

Two CI tests are designed as "intentional friction" gates:

1. **`server/services/__tests__/skillHandlerRegistryEquivalence.test.ts`** — Maintains a hardcoded `CANONICAL_HANDLER_KEYS` list (currently 216 entries) plus a hardcoded `SKILL_HANDLERS has exactly 216 keys` count assertion. The file's own comment says *"Updating this test is intentional friction… when you add a new system skill handler, you must update both SKILL_HANDLERS and this list."*

2. **`server/services/__tests__/agentExecutionEventServicePure.test.ts > critical event types are exactly the spec §5.3 set`** — Maintains a hardcoded `expectedCritical` set of 6 event types. Every PR that adds an event type to `shared/types/agentExecutionLog.ts` AGENT_EXECUTION_EVENT_CRITICALITY must align with this list or break CI.

**Cost:** every feature PR that adds skills or event types breaks both tests, even when the addition is correct. PR #291 hit both gates in CI iteration 3 and spent budget patching fixtures.

**Why the gates exist:** to prevent silent drift — a skill that's registered without a handler (or a handler without a skill row) breaks the startup validator (`validateSystemSkillHandlers`) and the analyzer-execute gate. Spec §5.3 critical-events list is a contract the run-cap enforcement and observability stream both depend on.

## Goal

Replace both fixtures with structural assertions that catch the same drift WITHOUT requiring per-PR fixture maintenance. The drift signal is preserved; the friction is removed.

## Proposed approach (for the architect to evaluate)

### Test 1 — skillHandlerRegistryEquivalence

Replace the hardcoded canonical list with structural property checks. Candidate invariants (architect picks the right set):

- Every key in `SKILL_HANDLERS` is also a row in `system_skills` (or whatever the canonical skill registry is) — query both at test time, assert set equality.
- Every key follows the slug naming convention (`^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$`).
- Every key has a corresponding `server/skills/<slug>.md` file (or a Zod schema entry in the action registry, for action-style handlers).
- Every handler is a function (this assertion already exists — keep it).
- Existing `SKILL_HANDLERS contains every canonical key` style invariants restated as "every registered skill in `system_skills` has a SKILL_HANDLERS entry" — this catches the same "I forgot to register" bug without a hardcoded list.

If the test needs the database to be seeded to query `system_skills`, the architect decides: either keep this as a unit test that reads a JSON manifest of skills, or move to an integration test that boots the DB.

### Test 2 — critical event types ≡ spec §5.3 set

Two options for the architect:

**Option A (preferred):** drive the expected set FROM the spec, not a hardcoded list. Add a machine-readable spec annotation (e.g. a frontmatter block in `docs/superpowers/specs/2026-05-XX-agent-execution-log-spec.md` listing critical events), have the test parse it. Adding a critical event then requires updating the spec — which IS the intent.

**Option B (simpler):** drop the "exactly the spec §5.3 set" assertion entirely. Replace with weaker structural checks: every entry in AGENT_EXECUTION_EVENT_CRITICALITY is a boolean; every event type has an entry; criticality flags are documented in the type comment. Drift becomes a code-review-time concern, not a CI-time one. Loses the spec-enforcement signal, gains zero friction.

Architect picks based on how load-bearing spec §5.3 is.

## Constraints / non-goals

- **DO NOT** change the runtime contract of `SKILL_HANDLERS` itself, `AGENT_EXECUTION_EVENT_CRITICALITY`, the startup validator (`validateSystemSkillHandlers`), or the analyzer-execute gate. This is a TEST refactor, not a registry refactor.
- **DO NOT** silently weaken either invariant. The replacement must catch:
  - A handler key in `SKILL_HANDLERS` with no matching `system_skills` row, or vice versa.
  - A critical event type marked critical without spec §5.3 entry (if going with Option A).
- Keep the existing positive assertions ("every handler is a function", "every entry is a boolean") — those are cheap and useful.

## Files in scope

- `server/services/__tests__/skillHandlerRegistryEquivalence.test.ts` (rewrite)
- `server/services/__tests__/agentExecutionEventServicePure.test.ts` (rewrite the one failing test, leave the other 28 alone)
- Possibly: `docs/superpowers/specs/<some-existing-or-new>-spec.md` with a machine-readable critical-events block (Option A only)

## Out of scope

- Refactoring `SKILL_HANDLERS` itself or the action registry shape.
- Adding a `system_skills` table column to track handler-key alignment.
- Anything related to PR #291 / personal-assistant-v1 — that build has merged.

## How to start (paste into a new Claude Code session)

```
launch spec-coordinator from tasks/builds/intentional-friction-tests-refactor/brief.md
```

Or, if the architect's judgement is that this is a Standard-class task (no design decisions, just choose between Option A vs B and implement), the operator can invoke architect directly:

```
architect: Replace the intentional-friction tests per tasks/builds/intentional-friction-tests-refactor/brief.md. Pick Option A or B for critical event types based on how load-bearing spec §5.3 is; pick the structural property set for SKILL_HANDLERS that catches the same drift signals the canonical list catches today. Output an implementation plan with file-level chunks.
```

## Provenance

Surfaced during finalisation-coordinator auto-fix loop for PR #291 (`personal-assistant-v1`), iteration 3. Auto-fix log: `tasks/review-logs/auto-fix-log-personal-assistant-v1-2026-05-12T21-58-47Z.md` § Iteration 3. Operator captured 2026-05-12.
