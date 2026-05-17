# Spec Review Plan — feat-split-subaccountknowledgepage

- Spec path: `tasks/builds/feat-split-subaccountknowledgepage/spec.md`
- Spec commit at start: uncommitted (new file, not yet staged)
- Spec-context: `docs/spec-context.md` (last_reviewed_at 2026-05-11; age 3 days; green)
- MAX_ITERATIONS: 5
- Prior iterations: none
- Stopping heuristic: exit on two consecutive mechanical-only rounds; also exit on Codex-no-findings or zero-acceptance drought.

## Context-freshness summary

- Spec-context staleness: green (3 days old, threshold warn=60).
- No framing mismatches detected between the spec and `docs/spec-context.md`.
- Pre-production / rapid-evolution / static-gates-primary / no-feature-flags / commit-and-revert: all match the spec's posture.
- Batch 1 precedent: `tasks/builds/feat-split-adminsubaccountdetailpage/spec.md`, `feat-split-usagepage/spec.md`, `feat-split-layout/spec.md`. Pattern verified live at `client/src/components/admin-subaccount-detail/`.

## Caller note

- Sections 0 / 4 / 5 / 10 of `docs/spec-authoring-checklist.md` are N/A for this frontend-only refactor per the caller. Rubric will not flag these as missing absent specific evidence they apply.
