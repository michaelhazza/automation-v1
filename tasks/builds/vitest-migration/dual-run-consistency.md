# Dual-run consistency (Phases 2 and 3)

Compares per-file outcomes between the bash runner (`bash scripts/run-all-unit-tests.sh`)
and Vitest (`npx vitest run <files...>`) for every batch in Phases 2 and 3.

Format: one line per file per batch.
`<path> bash:<pass|fail|skip> vitest:<pass|fail|skip> match:<yes|no>`

Spot-checks (I-4b): `spot-check: <file>::<test-name> verified`.

## Phase 2

(populated per batch)

## Phase 3

(populated per batch)

## Phase 3 final global comparison

(populated at end of Phase 3 per § 4 Phase 3 deliverable 10)

### phase2 phase2-batch-00 (2026-04-30)
client/src/components/brief-artefacts/__tests__/ApprovalCardPure.test.ts bash:pass vitest:pass match:yes
client/src/components/brief-artefacts/__tests__/StructuredResultCardPure.test.ts bash:pass vitest:pass match:yes
client/src/hooks/__tests__/usePendingIntervention.test.ts bash:pass vitest:pass match:yes
server/config/__tests__/jobConfigInvariant.test.ts bash:pass vitest:pass match:yes
server/jobs/__tests__/llmInflightHistoryCleanupJobPure.test.ts bash:pass vitest:pass match:yes
server/jobs/__tests__/llmStartedRowSweepJobPure.test.ts bash:pass vitest:pass match:yes
server/jobs/__tests__/skillAnalyzerJobIncidentEmission.integration.test.ts bash:pass vitest:skip match:expected-skip
server/lib/__tests__/agentRunEditPermissionMaskPure.test.ts bash:pass vitest:pass match:yes
server/lib/__tests__/agentRunVisibilityPure.test.ts bash:pass vitest:pass match:yes
server/lib/__tests__/derivedDataMissingLog.test.ts bash:pass vitest:pass match:yes
