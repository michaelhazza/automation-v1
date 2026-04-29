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

### phase3 phase3-batch-02 (2026-04-29)
server/jobs/__tests__/fastPathDecisionsPruneJobPure.test.ts bash:pass vitest:pass match:yes
server/jobs/__tests__/fastPathRecalibrateJobPure.test.ts bash:pass vitest:pass match:yes
server/jobs/__tests__/ledgerArchivePure.test.ts bash:pass vitest:pass match:yes
server/jobs/__tests__/measureInterventionOutcomeJob.idempotency.test.ts bash:pass vitest:pass match:yes
server/jobs/__tests__/measureInterventionOutcomeJobPure.test.ts bash:pass vitest:pass match:yes
server/jobs/__tests__/ruleAutoDeprecateJob.idempotency.test.ts bash:pass vitest:pass match:yes
server/jobs/__tests__/ruleAutoDeprecateJobPure.test.ts bash:pass vitest:pass match:yes
server/jobs/__tests__/staleAnalyzerJobSweepJobPure.test.ts bash:pass vitest:pass match:yes
server/lib/__tests__/briefContractTestHarness.example.test.ts bash:pass vitest:pass match:yes
server/lib/__tests__/briefContractTestHarness.test.ts bash:pass vitest:pass match:yes

### phase3 phase3-batch-03 (2026-04-29)
server/lib/__tests__/llmStub.test.ts bash:pass vitest:pass match:yes
server/lib/__tests__/postCommitEmitter.test.ts bash:pass vitest:pass match:yes
server/lib/__tests__/queryIntentClassifierPure.test.ts bash:pass vitest:pass match:yes
server/lib/__tests__/rlsBoundaryGuard.test.ts bash:pass vitest:pass match:yes
server/lib/__tests__/sanitizeSearchQueryPure.test.ts bash:pass vitest:pass match:yes
server/lib/__tests__/scopeAssertion.test.ts bash:pass vitest:pass match:yes
server/lib/__tests__/testRunIdempotencyPure.test.ts bash:pass vitest:pass match:yes
server/lib/__tests__/utf8Truncate.test.ts bash:pass vitest:pass match:yes
server/lib/schedule/__tests__/schedulePickerToCronPure.test.ts bash:pass vitest:pass match:yes
server/lib/workflow/__tests__/actionCallAllowlistPure.test.ts bash:pass vitest:pass match:yes

### phase3 phase3-batch-04 (2026-04-29)
server/lib/workflow/__tests__/actionCallValidatorPure.test.ts bash:pass vitest:pass match:yes
server/lib/workflow/__tests__/agentDecisionEnvelope.test.ts bash:pass vitest:pass match:yes
server/lib/workflow/__tests__/agentDecisionPure.test.ts bash:pass vitest:pass match:yes
server/lib/workflow/__tests__/workflow.test.ts bash:pass vitest:pass match:yes
server/routes/__tests__/briefsArtefactsPagination.integration.test.ts bash:pass vitest:skip match:expected-skip
server/routes/__tests__/conversationsRouteFollowUp.integration.test.ts bash:pass vitest:skip match:expected-skip
server/routes/__tests__/llmUsage.test.ts bash:pass vitest:pass match:yes
server/routes/__tests__/reviewItems.test.ts bash:pass vitest:pass match:yes
server/routes/__tests__/sessionMessage.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/activityService.test.ts bash:pass vitest:pass match:yes

### phase3 phase3-batch-05 (2026-04-29)
server/services/__tests__/agentActivityService.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/agentBeliefServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/agentExecution.smoke.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/agentExecutionService.middlewareContext.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/agentExecutionService.phase.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/agentExecutionService.validateToolCalls.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/agentExecutionServicePure.checkpoint.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/agentExecutionServicePure.plan.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/agentExecutionServicePure.runResultStatus.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/agentExecutionServicePure.toolIntent.test.ts bash:pass vitest:pass match:yes

### phase3 phase3-batch-06 (2026-04-29)
server/services/__tests__/agentExecutionServiceWb1Pure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/agentRunCleanupJobPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/agentRunFinalizationServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/agentRunHandoffServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/agentRunMessageServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/alertFatigueGuard.regression.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/assertSingleWebhookPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/beliefConflictServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/briefApprovalServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/briefArtefactBackstopPure.test.ts bash:pass vitest:pass match:yes

### phase3 phase3-batch-07 (2026-04-29)
server/services/__tests__/briefArtefactCursorPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/briefArtefactPaginationPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/briefArtefactValidatorPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/briefConversationWriterPostCommit.integration.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/briefMessageHandlerPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/briefVisibilityServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/bundleSuggestionDismissalsPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/canonicalDictionaryRendererPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/canonicalDictionaryValidatorPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/canonicalRegistryDriftPure.test.ts bash:pass vitest:pass match:yes

### phase3 phase3-batch-08 (2026-04-29)
server/services/__tests__/clarificationServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/clientPulseHighRiskPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/clientPulseIngestionPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/clientPulseInterventionProposerPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/computeMeaningfulOutputPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/computeRunResultStatusPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/computeStaffActivityPulsePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/configAgentGuidelinesInjection.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/configDocumentParserServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/configHistoryServicePure.test.ts bash:pass vitest:pass match:yes

### phase3 phase3-batch-09 (2026-04-29)
server/services/__tests__/configUpdateOrganisationConfigPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/connectorPollingSchedulerPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/conversationsRoutePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/critiqueGatePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/delegationGrantValidatorPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/delegationGraphServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/delegationOutcomeServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/deliveryServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/extractRunInsightsErrorMessagePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/fixtures/__tests__/fakeProviderAdapter.test.ts bash:pass vitest:pass match:yes

### phase3 phase3-batch-10 (2026-04-29)
server/services/__tests__/fixtures/__tests__/fakeWebhookReceiver.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/ghlWebhookMutationsPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/hermesTier1Integration.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/hierarchyContextBuilderServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/hierarchyRouteResolverServicePure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/incidentIngestorIdempotency.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/incidentIngestorPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/incidentIngestorThrottle.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/interventionActionMetadataPure.test.ts bash:pass vitest:pass match:yes
server/services/__tests__/interventionIdempotencyKeysPure.test.ts bash:pass vitest:pass match:yes
