# PR: wave-6-rls-residue-and-gate-fix — Session O (Major)

## Summary

Closes Wave 5 RLS residue: fixes the gate honesty bug (Windows git-bash POSIX path mismatch silently reported 0 violations), migrates all 1108 flagged callsites, and ships WF1 RLS policy migrations for 5 FK-scoped workflow tables.

## What changed

**Gate fix (Option B — Chunks 1+2):**
- `scripts/lib/gate-file-enumerator.mjs` — OS-portable Node-native glob enumerator; replaces bash `find` pipeline across two confirmed-bug gates
- `scripts/verify-with-org-tx-or-scoped-db.sh` — uses enumerator; now reports honest count on Windows (1108, was 0)
- `scripts/verify-no-direct-boss-work.sh` — uses enumerator; Linux/Windows parity restored
- `scripts/test-gate-portability.sh` + fixtures — P3 OS-parity harness added to run-all-gates.sh

**WF1 RLS migration (Chunk 5):**
- `migrations/0368_rls_workflow_fk_scoped_tables.sql` — ENABLE + FORCE RLS + EXISTS-chain policies for `workflow_step_runs`, `workflow_step_reviews`, `workflow_studio_sessions`, `workflow_run_event_sequences`, `flow_step_outputs`
- `server/config/rlsProtectedTables.ts` — all 5 tables added to manifest

**Service-layer migration (Chunks 3-14):**
- 1108 residue callsites across 228 files addressed: Tier 1 to `getOrgScopedDb`, Tier 2 to `withAdminConnection`/guard-ignore, Tier 0/3 annotated

## Acceptance

- `scripts/guard-baselines.json` `with-org-tx-or-scoped-db` ratcheted 1108 to 0
- `scripts/test-gate-portability.sh` passes (2 gates, 2 fixtures)
- 5 WF1 FK-scoped tables now have FORCE RLS + EXISTS-chain tenant policies
- All 1108 Wave 5 residue callsites resolved
- lint: 0 errors, typecheck: clean, build:server + build:client: success

## Closes

- P3 — Windows-portable harness test
- WF1 — Five FK-scoped tenant tables with no RLS policies
- WF3 — workflowEngineService.ts raw db migration
- WF4 — Workflow tick worker org-context gap
- WF6 — workflowAgentRunHook.ts raw db.select

## Spec refs

Spec: `tasks/builds/wave-6-rls-residue-and-gate-fix/spec.md`
Tier categorisation: `tasks/builds/wave-6-rls-residue-and-gate-fix/tier-categorisation.md`
Gate audit: `tasks/builds/wave-6-rls-residue-and-gate-fix/gate-audit-results.md`
WF1 verification: `tasks/builds/wave-6-rls-residue-and-gate-fix/wf1-rls-verification.md`
Tier 2 audit: `tasks/builds/wave-6-rls-residue-and-gate-fix/tier-2-audit.md`
Per-service summary: `tasks/builds/wave-6-rls-residue-and-gate-fix/per-service-tier-summary.md`
