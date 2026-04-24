# Universal Brief — Phase 0 Progress

**Branch:** `claude/implement-universal-brief-qJzP8`
**Phase:** 0 — Foundation (contract harness + retrieval audit)
**Started:** 2026-04-22

## Status: In progress

## Drift findings (from architect agent)

- `org_settings` table does not exist — Phase 1 will add `agent_persona_label` to `organisations` table instead. User decision pending.
- No explicit "Orchestrator output" hook in `agentExecutionService.ts` — Phase 1 uses a bridge helper pattern.
- `systemCallerPolicy` type confusion in spec §6.1 is a Phase 3 issue only.
- All other files aligned with spec assumptions.

## Phase 0 deliverables

- [ ] `server/services/briefArtefactValidatorPure.ts`
- [ ] `server/services/briefArtefactValidator.ts`
- [ ] `server/services/__tests__/briefArtefactValidatorPure.test.ts`
- [ ] `server/services/briefArtefactBackstopPure.ts`
- [ ] `server/services/briefArtefactBackstop.ts`
- [ ] `server/services/__tests__/briefArtefactBackstopPure.test.ts`
- [ ] `server/lib/briefContractTestHarness.ts`
- [ ] `server/lib/__tests__/briefContractTestHarness.test.ts`
- [ ] `server/lib/__tests__/briefContractTestHarness.example.test.ts`
- [ ] `tasks/research-questioning-retrieval-audit.md`

## Exit gate

1. `npx tsx server/lib/__tests__/briefContractTestHarness.example.test.ts` — all PASS
2. `tasks/research-questioning-retrieval-audit.md` exists with severity-labelled findings
