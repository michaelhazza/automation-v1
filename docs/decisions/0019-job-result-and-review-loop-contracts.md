# ADR-0019: Job result and review-loop state-machine contracts

**Status:** proposed
**Date:** 2026-05-13
**Domain:** workflow-engine / tooling
**Supersedes:** _n/a_
**Superseded by:** _n/a_

## Context

Two cross-cutting shapes have been re-invented at every caller for months:

1. **Job outcome reporting** — `server/jobs/*` files return ad-hoc shapes (`void`, `{ ok: true }`, throw-only). `queueService.ts` logs them inconsistently; the monitoring agent (PR #226) cannot reliably distinguish a successful no-op from a silent skip from a partial failure. Surfaced in `CHATGPT-PR203-BONUS` and reinforced by every job added since.
2. **Review-loop status** — Each review agent (`spec-conformance`, `pr-reviewer`, `dual-reviewer`, `adversarial-reviewer`, `chatgpt-pr-review`, `chatgpt-spec-review`) emits its own verdict vocabulary in its session log. `feature-coordinator` parses these as strings; the coordinator therefore re-learns the mapping every release.

Locking both shapes now — before more callers land — prevents the migration tax from compounding.

## Decision

We will lock two discriminated-union contracts in `shared/types/`:

### `JobResult` (file: `shared/types/jobs.ts`)

```ts
export type JobResult =
  | { kind: 'ok'; detail?: Record<string, unknown> }
  | { kind: 'noop'; reason: string }
  | { kind: 'partial'; completed: number; failed: number; errors: unknown[] }
  | { kind: 'error'; cause: unknown };
```

Every job under `server/jobs/*` returns `Promise<JobResult>` (existing `Promise<void>` jobs are treated as implicit `{ kind: 'ok' }` until migrated). `queueService.ts` logs by `kind` (one log shape per kind, no string-matching). The system monitor consumes `kind` directly.

### Review-loop verdict (file: `shared/types/reviewVerdict.ts`)

```ts
export type ReviewVerdict =
  | 'APPROVED'
  | 'APPROVED_WITH_OBSERVATIONS'
  | 'CONFORMANT'
  | 'CONFORMANT_AFTER_FIXES'
  | 'NON_CONFORMANT'
  | 'CHANGES_REQUESTED'
  | 'HOLES_FOUND'
  | 'REVIEW_GAP';
```

This is the closed vocabulary. Review agents return one verdict + structured findings; `feature-coordinator` reads `verdict` only — no log-string scraping.

## Consequences

- **Positive:**
  - One canonical place to read the "what does this job/review say" contract.
  - System monitor + coordinator gain compile-time exhaustiveness over outcomes.
  - Removes the silent class of "successful no-op was reported as a failure" bugs.
- **Negative:**
  - Cross-cutting migration: every `server/jobs/*` file + every review-agent definition must be touched.
  - One-time test rewrites to assert against the structured shape.
- **Neutral:**
  - Old-style `Promise<void>` jobs continue to work via the implicit-OK rule; migration is incremental.

## Alternatives considered

- **Leave both shapes free-form** — rejected. Already costing review cycles and produced one observed incident (monitoring agent misclassified a successful no-op).
- **Lock only `JobResult`, keep verdict strings** — rejected. The verdict-string scraping is the larger source of coordinator brittleness; both belong in the same ADR because they share the same failure mode (string-typed contract drift).

## When to revisit

Re-open when **any one** of these triggers fires:
- A real workflow class needs a fifth `JobResult.kind` that doesn't compose from the existing four (e.g. `'rate_limited'` as a first-class outcome distinct from `'noop'`).
- A new review agent ships and its verdict genuinely cannot map to the closed vocabulary above.

## References

- Related entry in legacy todo.md: `CHATGPT-PR203-BONUS`
- Related entry: `CHATGPT-R1-RISK-1` / `R3-RISK-1` (Trust Verification Layer review-loop state-machine items)
- Related ADR: ADR-0001 (mixed-mode review agents), ADR-0002 (interactive-vs-walkaway review agents)
