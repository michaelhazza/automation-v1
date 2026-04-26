# Audit Remediation Follow-ups — Progress Log

**Spec:** docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md
**Plan:** docs/superpowers/plans/2026-04-26-audit-remediation-followups.md

## Per-item status
See spec §5 Tracking — the single source of truth for ☐ / ⧖ / ✓ / ↗ / ✗ flips.

## Wave progress (as of 2026-04-26 session pause)
- Wave 1 (signal foundation + cleanup): 10 / 10 items done ✓
- Wave 2 (drift guards + small refactors): 5 / 5 items done ✓
- Wave 3 (heavy migrations): 1 / 5 items done (A1a ✓; A1b, B2, A2, F2 pending)
- F2 (parked behind Phase-5A): not started

### Wave 1 completed items
G2 runbook ✓ | C1 [GATE] lines ✓ | G1 migration script ✓ | D1 baselines ✓ | D2 framing ✓ | D3 skill-read-paths ✓ | E1 test triage ✓ | E2 gate triage ✓ | B1 throw test ✓ | C4 comment fix ✓

### Wave 2 completed items
C2 architect drift guard ✓ | C3 canonical registry drift ✓ | A3 getOrgScopedDb migration ✓ | F1 findAccountBySubaccountId ✓ | H1 Phase-1 advisory gate ✓

### Wave 3 remaining
- A1b (principal-context gate hardening) — NEXT
- B2+B2-ext (job idempotency + concurrency, 4 jobs)
- A2 (RLS write-boundary guard, 3 phases)

## Decisions / observations
(append-only; one heading per item that lands a non-trivial decision)

### A1a deviation (2026-04-26)
Methods do NOT yet wrap DB work in `withPrincipalContext` — that wrapping lands in A1b. Reason: `connectorPollingService` and `measureInterventionOutcomeJob` run outside any `withOrgTx` block, so wrapping today would break production. Also: `intelligenceSkillExecutor.ts` was migrated in A1a (not A1b) because the new signature is a breaking type change. No deprecated shims kept — all callers migrated.
