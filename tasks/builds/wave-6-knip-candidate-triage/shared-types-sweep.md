# Wave 6 Session P — shared/types/* unused exports sweep

**Branch:** `claude/wave-6-knip-candidate-triage` | **Date:** 2026-05-17
**Inputs:** 58 unused exports + 114 unused exported types = 172 items across 33 files.
**Result:** 0 deletions, 172 keeps, 0 file edits.

## Summary

| Verdict | Count |
|---|---|
| DELETE | 0 |
| KEEP | 172 |
| DEFER | 0 |

## Why zero deletions

A repo-level gate already covers this surface: `scripts/.gate-baselines/types-used.txt` lists 167 of the 172 items as baselined "exported but not referenced" with `# expires: 2026-08-14` (90-day grace). `verify-types-used.sh` is the team's chosen forcing function. Acting on knip's flags now would short-circuit that policy.

Per the task's "Be conservative; cost of wrong delete is high; cost of KEEP is one knip line" instruction, every flagged item meets at least one of three KEEP patterns:

- **Pattern A — Zod schema/inferred-type pair:** file exports `xSchema` + `type X = z.infer<typeof xSchema>`; knip flags the half not externally imported, but the file is alive via the consumed half. Deleting the unused half breaks the pair.
- **Pattern B — Discriminated-union registry:** each union member is exported; consumers import only the union; members are emitted for completeness.
- **Pattern C — File-internal structural composition:** the exported type is referenced only inside the same file (as part of another exported type). Knip's "external-only" semantics flags it; it's load-bearing inside the file.

## Per-file verdicts

| File | Flagged | Verdict | Reason |
|---|---|---|---|
| `agentPresence.ts` | 4 | KEEP | Spec-anchored degraded state machine; service inlines parallel literals at `agentPresenceServicePure.ts:30-31` |
| `agentExecutionCheckpoint.ts` | 1 | KEEP | `SerialisablePreToolDecision` re-exported via `middleware/types.ts:10-15`; consumed by `agentExecutionServicePure.ts:311` |
| `agentExecutionLog.ts` | 3 | KEEP | All Pattern C (embedded in `AgentExecutionEventPayload` union members in same file) |
| `agentRecommendations.ts` | 8 | KEEP | Pattern B (8 evidence types compose `RecommendationEvidence` union; `materialDelta` keyed on union members) |
| `approvalChannel.ts` | 1 | KEEP | Pattern C (`SpendApprovalPayload` embedded in `ApprovalRequest.payload`) |
| `askForm.ts` | 1 | KEEP | Pattern C (`AskFieldType` is `AskField.type` discriminator) |
| `briefResultContract.ts` | 9 | KEEP | `BRIEF_RESULT_CONTRACT_VERSION` spec-pinned; 4 type-guards public surface; rest Pattern C; `ChallengeAssumptionsPayload` re-export 1-line convenience |
| `briefRules.ts` | 1 | KEEP | Pattern C (`RuleDerivedStatus` is `RuleRow.status` + `RuleListFilter.status`) |
| `briefSkills.ts` | 1 | KEEP | Pattern C (`ClarifyingQuestion` composed into `ClarifyingQuestionsPayload.questions[]`) |
| `build.ts` | 1 | KEEP | Pattern C (`AgentPersonality` in `AgentFull.personality` + `AgentPersonalityPatch`) |
| `cachedContext.ts` | 5 | KEEP | All Pattern C (compose `HitlBudgetBlockPayload` / `ContextAssemblyResult` / `PrefixHashComponents`) |
| `calendarAction.ts` | 6 | KEEP | Pattern A — sibling `*Input` types consumed by `calendarActionService.ts:16` + `eaDraftDispatchService.ts:38` |
| `crmQueryPlanner.ts` | 5 | KEEP | Pattern C (compose `QueryPlan` / `CanonicalQueryRegistryEntry` / planner-events surface) |
| `crossOwnerApproval.ts` | 3 | KEEP | Spec-anchored per personal-assistant-v2-operator §5.6 (timeout policy constants) |
| `delegation.ts` | 3 | KEEP | Pattern A (Zod schemas pair with consumed `DelegationScope`/`DelegationDirection` types); `DelegationEdgeKind` Pattern C |
| `eaDraft.ts` | 4 | KEEP | Pattern A — `EADraft`/`EADraftKind`/`EADraftSendState` types consumed externally |
| `externalSourceTrigger.ts` | 7 | KEEP | Pattern B — sub-events compose `ExternalSourceTriggerEvent` discriminated union (consumed by gmail/calendar jobs) |
| `homeWidget.ts` | 10 | KEEP | Pattern B — consumed `HomeWidget`/`HomeWidgetDeclaration`/`SummaryCardData` are public; sub-schemas are union members |
| `messageSuggestedActions.ts` | 2 | KEEP | Pattern A — `parseSuggestedActions` consumed; `suggestedActionSchema` validates inside it |
| `operate.ts` | 11 | KEEP | Pattern C — compose `ActivityItem` / `FilterOptions` / `RunTraceEvent` union; `InboxItemAction` spec §10 deferred |
| `operatorBackendEvents.ts` | 30 | KEEP | Pattern B — `OPERATOR_SESSION_EVENT_NAMES` + 3 named constants consumed; 20 interfaces compose `OperatorBackendEvent` union; 11 name constants are spec §4.7 closed-set registry (CI gate `verify-operator-event-registry.sh` enforces) |
| `operatorEvents.ts` | 5 | KEEP | Pattern C — namespace-discrimination unions + file-event payloads (sibling `CrossOwnerSubstep*` payloads consumed by `workflowGateStallNotifyJob.ts:11`) |
| `operatorRuns.ts` | 11 | KEEP | Pattern B — `OperatorRunSettingsSnapshot` consumed; status types + arrays + guards form state-machine registry (spec §3.3/§3.4) |
| `page.ts` | 3 | KEEP | Pattern C; already carry `// guard-ignore-next-line: types-used` suppressions in source |
| `retrieval.ts` | 2 | KEEP | Pattern C (`RetrievalMode` composes candidate/loaded types; `RetrievalRejected` composes `RetrievalResult.rejected`) |
| `runCost.ts` | 1 | KEEP | Pattern C (`CallSiteBreakdownEntry` composes `RunCostResponse.callSiteBreakdown.{app,worker}`) |
| `runTraceEvent.ts` | 1 | KEEP | Pattern C — every member of `RunTraceEvent` is `RunTraceEventBase & {...}` |
| `sandbox.ts` | 9 | KEEP | Pattern C — every flagged interface composes `SandboxPolicy`/`SandboxRunTaskInput`/etc. (consumed across sandbox service tree) |
| `supportClassifyTicketResult.ts` | 2 | KEEP | Pattern A — `SupportClassifyTicketResultSchema` consumed; sub-schemas compose it in-file |
| `supportObservability.ts` | 1 | KEEP | Pattern C (`SupportLogCode` inferred from consumed `SUPPORT_LOG_CODES` constant) |
| `systemPnl.ts` | 6 | KEEP | Pattern C — KPI wrappers compose `PnlSummary`; `ByOrganisationResponse` tab wrapper; `InFlightSourceType` is `InFlightEntry.sourceType` discriminator |
| `voiceProfile.ts` | 6 | KEEP | Pattern A — `VoiceProfileSchema` + `VoiceProfile` consumed; sub-schemas compose parent in-file |
| `workflowRunStartSkill.ts` | 1 | KEEP | Pattern A — sibling `WorkflowRunStartOutput` consumed; input/output pair |
| `workflowRunStatus.ts` | 1 | KEEP | Pattern C (`WorkflowRunTerminalStatus` inferred from consumed `WORKFLOW_RUN_TERMINAL_STATUSES`) |
| `workflowStepGate.ts` | 1 | KEEP | Pattern C — sub-types consumed; `WorkflowStepGate` is canonical row composing them |
| `workflowValidator.ts` | 1 | KEEP | Pattern C — `ValidatorError`/`ValidatorResult` consumed; `ValidatorRule` is `ValidatorError.rule` discriminator |
| `workspace.ts` | 4 | KEEP | All 4 consumed by `server/db/schema/workspace*.ts` + `server/services/workspace/workspaceActorService.ts`; knip misses `import type` patterns |

## Recommendation

- Session P does nothing to shared/types/* exports. 172 items remain in place.
- Operator forcing function is the **2026-08-14 baseline grace expiry**. Before that date, a dedicated cleanup spec should run with operator input on the spec-anchored items (brief contract version pin, cross-owner timeout policy, operator-backend §4.7 closed set, operator-runs state machine, voiceProfile contract, sandbox policy).
- For knip noise reduction, the right path is the chunk F `knip.json` patch in `triage-verdicts.md` §4 (file-level globs for spec-anchored contract files), not per-export deletion.

## Knip counts

| Metric | Before | After |
|---|---|---|
| `Unused exports` (whole repo) | 562 | 562 |
| `Unused exported types` (whole repo) | 485 | 485 |
| `shared/types/*` in scope (this sweep) | 172 | 172 |

## Files modified

None.

## DEFER items

None — all 172 map to one of the three KEEP patterns above, and the existing `types-used.txt` baseline already encodes the operator's prior decision.
