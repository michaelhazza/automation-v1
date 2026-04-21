# Spec Review Plan — llm-observability-ledger-generalisation

**Spec path:** `tasks/llm-observability-ledger-generalisation-spec.md`
**Spec status:** untracked (new file, not yet committed)
**Spec-context commit:** `d469871`
**HEAD at start of review:** `d469871`
**Caller-stated lifetime iteration:** 1 of MAX_ITERATIONS (5)
**Prior checkpoints for this spec:** none (fresh spec)

## Pre-loop context check result

- `docs/spec-context.md` read successfully.
- Spec framing section (§"Framing statements") explicitly concurs with every flag in `spec-context.md`:
  - `pre_production: yes` — spec uses commit_and_revert, no feature flags, no staged rollout.
  - `testing_posture: static_gates_primary` + `runtime_tests: pure_function_only` — spec §16 only proposes pure-function tests + one new static gate.
  - `prefer_existing_primitives_over_new_ones: yes` — §4 contains a full primitives audit.
  - `breaking_changes_expected: yes` — spec acknowledges adapter + router contract growth without backward-compat shims.
- No framing mismatch. No HITL required before iteration 1.

## Expected iteration cap

- Hard cap: 5 (MAX_ITERATIONS).
- Stopping heuristic: two consecutive mechanical-only rounds = stop.
- Exit conditions per agent contract apply.

## Review scope note

- The reference UI prototype at `prototypes/system-costs-page.html` is part of the spec surface per the caller.
- Focus areas for rubric pass:
  - File-inventory drift (contracts, utility files, shared types).
  - Path references (specifically `withAdminConnection` location).
  - CHECK constraint completeness for the attribution invariant.
  - `sourceType` default column value interaction with new CHECK constraints.
  - Phase sequencing dependency graph validated.
  - Deferred items cross-check.
  - Contracts completeness per §3 of the spec-authoring checklist.
