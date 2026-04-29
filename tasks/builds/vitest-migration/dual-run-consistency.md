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

### phase2 phase2-batch-01 (2026-04-30)
server/lib/__tests__/idempotencyVersionPure.test.ts bash:pass vitest:pass match:yes
server/lib/__tests__/logger.integration.test.ts bash:pass vitest:skip match:expected-skip
server/lib/__tests__/loggerBufferAdapterPure.test.ts bash:pass vitest:pass match:yes
server/lib/__tests__/reconciliationRequiredErrorPure.test.ts bash:pass vitest:pass match:yes
server/lib/__tests__/redactionPure.test.ts bash:pass vitest:pass match:yes
server/lib/__tests__/softBreakerPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/actionServiceCanonicalisationPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/agentExecutionEventServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/agentRunPayloadWriterFailurePathPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/agentRunPayloadWriterPure.test.ts bash:pass vitest:pass match:yes

### phase2 phase2-batch-02 (2026-04-30)
server/services/__tests__/canonicalDataService.findAccountBySubaccountId.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/canonicalDataService.principalContext.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/chatTriageClassifierPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/contextAssemblyEnginePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/decideApprovalStepTypePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/dlqMonitorRoundTrip.integration.test.ts bash:pass vitest:skip match:expected-skip
server/services/__tests__/dlqMonitorServiceForceSyncInvariant.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/dlqMonitorServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/drilldownOutcomeBadgePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/drilldownPendingInterventionPure.test.ts bash:pass vitest:pass match:yes

### phase2 phase2-batch-03 (2026-04-30)
server/services/__tests__/incidentIngestorThrottle.integration.test.ts bash:pass vitest:skip match:expected-skip
server/services/__tests__/llmInflightPayloadStorePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/llmInflightRegistryPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/llmRouterErrorMappingPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/llmRouterIdempotencyPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/llmRouterPayloadEmissionPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/llmRouterTimeoutPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/managerGuardPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/memoryBlockCitationDetectorPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/memoryBlockRetrievalServicePure.test.ts bash:pass vitest:pass match:yes

### phase2 phase2-batch-04 (2026-04-30)
server/services/__tests__/notifyOperatorFanoutServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/recommendedInterventionPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/referenceDocumentServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/resolveRequiredConnectionsPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/ruleConflictDetectorPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/ruleTeachabilityClassifierPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/skillIdempotencyKeysPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/skillStudioServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts bash:pass vitest:fail match:expected-phase3
server/services/adapters/__tests__/apiAdapterClassifierPure.test.ts bash:pass vitest:pass match:yes

### phase2 phase2-batch-04 (2026-04-30)
server/services/__tests__/notifyOperatorFanoutServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/recommendedInterventionPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/referenceDocumentServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/resolveRequiredConnectionsPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/ruleConflictDetectorPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/ruleTeachabilityClassifierPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/skillIdempotencyKeysPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/skillStudioServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/workflowEngineApprovalResumeDispatch.integration.test.ts bash:pass vitest:fail match:expected-phase3
server/services/adapters/__tests__/apiAdapterClassifierPure.test.ts bash:pass vitest:pass match:yes

### phase2 phase2-batch-05 (2026-04-30)
server/tools/capabilities/__tests__/askClarifyingQuestionsHandlerPure.test.ts bash:pass vitest:pass match:yes
server/tools/capabilities/__tests__/challengeAssumptionsHandlerPure.test.ts bash:pass vitest:pass match:yes

### phase3 phase3-batch-00 (2026-04-30)
client/src/components/__tests__/DeliveryChannels.test.ts bash:pass vitest:pass match:yes
client/src/components/__tests__/activityFeedMerge.test.ts bash:pass vitest:pass match:yes
client/src/components/__tests__/dashboardErrorBannerPure.test.ts bash:pass vitest:pass match:yes
client/src/components/agentRunLog/__tests__/eventRowPure.test.ts bash:pass vitest:pass match:yes
client/src/components/clientpulse/__tests__/SparklineChart.test.ts bash:pass vitest:pass match:yes
client/src/components/dashboard/__tests__/freshnessIndicator.test.ts bash:pass vitest:pass match:yes
client/src/components/run-cost/__tests__/RunCostPanel.test.ts bash:pass vitest:pass match:yes
client/src/lib/__tests__/briefArtefactLifecyclePure.test.ts bash:pass vitest:pass match:yes
client/src/lib/__tests__/formatDuration.test.ts bash:pass vitest:pass match:yes
client/src/lib/__tests__/resolvePulseDetailUrl.test.ts bash:pass vitest:pass match:yes

### phase3 phase3-batch-01 (2026-04-29)
client/src/pages/__tests__/dashboardVersioning.test.ts bash:pass vitest:pass match:yes
scripts/__tests__/auditSubaccountRootsPure.test.ts bash:pass vitest:pass match:yes
scripts/__tests__/build-code-graph-watcher.test.ts bash:pass vitest:pass match:yes
scripts/__tests__/chatgpt-reviewPure.test.ts bash:pass vitest:pass match:yes
scripts/__tests__/rlsContractImportTypePure.test.ts bash:pass vitest:pass match:yes
server/config/__tests__/actionRegistry.test.ts bash:pass vitest:pass match:yes
server/config/__tests__/actionSlugAliasesPure.test.ts bash:pass vitest:pass match:yes
server/config/__tests__/sensitiveConfigPathsRegistryPure.test.ts bash:pass vitest:pass match:yes
server/jobs/__tests__/bundleUtilizationJob.idempotency.test.ts bash:pass vitest:pass match:yes
server/jobs/__tests__/connectorPollingSync.idempotency.test.ts bash:pass vitest:pass match:yes
