# Spec Conformance Log

**Spec:** `tasks/builds/wave-4-architectural-and-duplication/spec.md`
**Spec commit at check:** part of branch HEAD `129b9e21c108712163800ddd6d4b414984f4f2fe` (spec ACCEPTED on the same branch)
**Branch:** `claude/wave-4-architectural-and-duplication`
**Base:** `77b70f82b974852e360473c6735739e0d23f336d` (merge-base with `main`)
**Scope:** all-of-spec — operator confirmed all chunks 0-15 are in scope of this run
**Changed-code set:** 64 files (excluding scratch/log/doc-only files)
**Run at:** 2026-05-16T05-19-16Z
**Commit at finish:** `33431881`

---

## Summary

- Requirements extracted:     34
- PASS:                       28
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 4
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     2

**Verdict:** NON_CONFORMANT (4 directional gaps — see deferred items in `tasks/todo.md` under "Deferred from spec-conformance review — wave-4-architectural-and-duplication (2026-05-16)").

Three of the four findings are documentation/test-strictness drift, not functional defects (the CD1 cycle is genuinely broken; the DUP4 spec text is stale; `npm run build:server` fails on a pre-existing main-branch issue). The fourth (DUP8 missing `webhookReplayNoncePruneJob` conversion) is a real functional gap requiring a design choice.

---

## Requirements extracted (full checklist)

### CD1 — handler-injection cycle break (spec §5)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| C1.1 | §5.2.1 / §4.1 | Create `server/services/handlerContextTypes.ts` — pure type-only module exporting `HandlerContext`; no value imports | PASS | `server/services/handlerContextTypes.ts:1-28` — only `import type` statements |
| C1.2 | §5.2.1 / §4.1 | Create `server/lib/buildHandlerContext.ts` — boot-time factory | PASS | `server/lib/buildHandlerContext.ts:1-28` |
| C1.3 | §5.2.1 / CD0.1 | HandlerContext exposes 5 methods: enqueueTick, tick, dispatchStep, startWorkflowRun, skillExecutor.execute | PASS | `handlerContextTypes.ts:14-28` |
| C1.4 | §5.4 | Every skill handler accepts a HandlerContext (or named sub-context) | PASS | `server/services/skillExecutor/context.ts:118-122` — `SkillHandler` type accepts 3rd param `handlerContext: HandlerContext`; `registry.ts:101+` forwards |
| C1.5 | §5.4 | Every workflow queue-lifecycle handler accepts a HandlerContext | PASS | `dispatch.ts:58-64`, `tick.ts:32`, `registerWorkers.ts:14` accept it; `agentStep.ts`/`watchdog.ts` don't cross the boundary so don't need it |
| C1.6 | §5.4 / §2 goal #4 | `buildHandlerContext()` constructed once at boot and threaded into handler registration | PASS | `server/index.ts:673-674` invokes and passes to `WorkflowEngineService.registerWorkers()`; entry-point files `agentExecutionLoop.ts:246`, `flowExecutorService.ts:217`, `optimiser/runOptimiserScan.ts:140` all use it |
| C1.7 | §2 goal #4 / §8 acc #1 | `buildHandlerContext.ts` is the only file in `server/` that value-imports BOTH `skillExecutor` AND `workflowEngineService` | PASS | Confirmed by directed grep; `handlerContextTypes.ts` uses `import type` for both |
| C1.8 | §8 acc #1 | All `await import('.*workflowEngineService.*')` / `await import('.*workflowRunStartSkillService.*')` in `server/services/skillExecutor/handlers/` removed | PASS | grep returns 0 hits |
| C1.9 | §8 acc #1 | grep `"from '.*skillExecutor\.js'"` filtered for non-type-only / non-buildHandlerContext returns ZERO hits | DIRECTIONAL_GAP | Returns 7 hits — see Findings below. Semantic cycle break IS achieved; spec's literal grep test is over-broad. |
| C1.10 | §5.2.3 | HandlerContext complies with governance invariant — no DB accessors, no feature-specific helpers, no convenience wrappers, every method has cycle-break justification | PASS | JSDoc on each method names the cycle it breaks |
| C1.11 | §4 framing | `WorkflowEngineService` exported as `export const` from `workflowEngineService.ts` | PASS | `workflowEngineService.ts:38` |
| C1.12 | §4 framing | `skillExecutor.execute(params): Promise<unknown>` exists with that shape | PASS | `skillExecutor/registry.ts:307` |
| C1.13 | §4.1 / chunk 15 | `architecture.md` documents the handler-injection pattern | PASS | `architecture.md:133-149` |

### DUP1 — Skills/pulse extraction (spec §6.1)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| D1.1 | §6.1 | Create `client/src/components/skills/HistoryRender.tsx` | PASS | exists |
| D1.2 | §6.1 | named exports `CheckOption` and `FilterActions` | PASS | `HistoryRender.tsx:3,17` |
| D1.3 | §6.1 | Both Skills pages + HistoryTab import from new module; duplicate bodies deleted | PASS | All 3 source files import the named exports |

### DUP2 — PermissionsEditor (spec §6.2)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| D2.1 | §6.2 | Create `client/src/components/permissions/PermissionsEditor.tsx`, named export `PermissionsEditor` | PASS | 114 LOC, named export confirmed |
| D2.2 | §6.2 | Both source files import from new module | PASS | `AdminPermissionSetsPage.tsx:6`, `PermissionsTab.tsx:5` |

### DUP3 — ApprovalChannelsEditor (spec §6.3)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| D3.1 | §6.3 | Create `client/src/components/approval/ApprovalChannelsEditor.tsx`, named export `ApprovalChannelsEditor` | PASS | `ApprovalChannelsEditor.tsx:21` |
| D3.2 | §6.3 | Both source pages import the named export | PASS | both pages import; also import `type ApprovalChannel` (additional bonus, harmless) |

### DUP4 — chat/messageRender unified (spec §6.4)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| D4.1 | §6.4 | Create `client/src/components/chat/messageRender.tsx` | PASS | exists |
| D4.2 | §6.4 | named export `MessageRender` | DIRECTIONAL_GAP | Spec text says `MessageRender`; actual exports are `renderAssistantContent`, `renderInlineMarkdown`, `renderBold` — matching the source copies. Same kind of spec/code drift as DUP1/DUP5 but spec text was not updated to match. See Findings. |
| D4.3 | §6.4 | Delete both source copies (not re-export shims) | PASS | both deleted |
| D4.4 | §6.4 | Both pages import from `chat/messageRender` | PASS | `AgentChatPage.tsx:17`, `ConfigAssistantPage.tsx:11` |

### DUP5 — TemplateGrid (spec §6.5)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| D5.1 | §6.5 | Create `client/src/components/templates/TemplateGrid.tsx` | PASS | exists |
| D5.2 | §6.5 | named exports `TemplateSlotRow` (component) and `TemplateSlotNode` (interface) | PASS | `TemplateGrid.tsx:9,19` |
| D5.3 | §6.5 | Both source pages import `TemplateSlotRow` (and optionally `TemplateSlotNode` type) | PASS | `SubaccountBlueprintsPage.tsx:6`, `SystemOrganisationTemplatesPage.tsx:6` |

### DUP7 — templateHelpers (spec §6.6)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| D7.1 | §6.6 | Create `server/services/templates/templateHelpers.ts` | PASS | exists |
| D7.2 | CD0.2 | named exports `computeManifestHash`, `slugify`, `PARSER_VERSION` | PASS | `templateHelpers.ts:3,5,9` |
| D7.3 | §6.6 | Both services import; neither retains private copies (canonical ownership invariant) | PASS | Both services import from the shared module; no parallel `createHash`/`slugify`/`PARSER_VERSION` bodies remain |

### DUP8 — definePruneJob (spec §6.7)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| D8.1 | §6.7 | Create `server/jobs/lib/definePruneJob.ts`, named export `definePruneJob` | PASS | factory exported at line 36 |
| D8.2 | §6.7 / §4.1 | All 6 prune jobs become thin `definePruneJob(...)` wrappers | DIRECTIONAL_GAP | Only 5/6 converted. `webhookReplayNoncePruneJob.ts` remains unchanged (85 LOC, single cross-org DELETE pattern). See Findings. |

### DUP9 — dispatchHelper (spec §6.8)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| D9.1 | §6.8 | Create `server/services/actions/dispatchHelper.ts`, named export `dispatchWithDraftClaim` | PASS | named export at line 10 |
| D9.2 | §6.8 | Both services import; neither retains private copy (canonical ownership) | PASS | calendar + slack action services use the helper; no parallel implementations |

### FE1 — HomePage trim (spec §7.1)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| F1.1 | §7.1 / CD0.5 | Remove all 4 MetricCard tiles from `operate/HomePage.tsx`; keep RunActivityChart hero | PASS | `MetricCard` grep returns no hits; `RunActivityChart` still rendered at line 247 |

### FE4 — IncidentDetailDrawer + IncidentTimeline (spec §7.2)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| F4.1 | §7.2 / CD0.4 | Create `client/src/components/system-incidents/IncidentDetailDrawer.tsx` | PASS | exists, 227 LOC |
| F4.2 | §7.2 / CD0.4 | Create `client/src/components/system-incidents/IncidentTimeline.tsx` | PASS | exists, 33 LOC |
| F4.3 | §7.2 | Reduce parent file LOC below 400 | PASS | `SystemIncidentsPage.tsx` is 239 LOC |
| F4.4 | §7.2 success criteria | Each extracted sub-component clears 5 success criteria (independent testability; ≤6 props; reduced render branching; reduced hook density; reduced cognitive load) | PASS (pr-reviewer scope) | Spec assigns the subjective criteria evaluation to chunk 13 `pr-reviewer`. Mechanical inspection: `IncidentDetailDrawer` has 5 props (incident, onClose, onAck, onResolve, onSuppress); `IncidentTimeline` has 2 props (events, loading). Both render in isolation. Full subjective evaluation belongs to `pr-reviewer`. |

### FE5+FE6 — acceptance headers (spec §7.3)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| F5.1 | §7.3 / CD0.6 | Append header `// admin/power-user page; complexity intentional; reviewed wave-4 spec §7.3 2026-05-15` verbatim to ClientPulseDashboardPage, ClientPulseDrilldownPage, JobQueueDashboardPage, SpendLedgerPage | PASS | All 4 pages have the exact header as line 1 |

### §8 acceptance criteria (build-level gates)

| REQ | Spec section | Requirement | Verdict | Evidence |
|---|---|---|---|---|
| A.1 | §8.1 | `madge` cycle baseline preserved at 0; skillExecutor↔workflowEngine value-edge gone | PASS semantic / DIRECTIONAL on literal grep | See C1.7/C1.8/C1.9 |
| A.2 | §8.2 | jscpd duplicated-line reduction ~1,200-1,500 lines; CI baseline lower than pre-build | NOT_VERIFIED_LOCALLY | CI-only per CLAUDE.md test-gates rule |
| A.3 | §8.3 | Each frontend item resolved per §7 (default verdicts binding unless overridden) | PASS | FE1 trim done; FE4 extracted; FE5+FE6 headers added |
| A.4 | §8.4 | `npm run build:server` exits 0 locally | DIRECTIONAL_GAP | Fails — but cause is pre-existing on main (missing `docx`/`mammoth` modules in 2 unrelated files). Branch did not introduce. |
| A.5 | §8.5 | `npm run build:client` exits 0 locally | PASS | Build succeeds in 5.63s |
| A.6 | §8.6 | `npm run lint` exits 0 locally | PASS | 0 errors (882 pre-existing warnings) |
| A.7 | §8.7 | CI's `verify-duplicate-blocks.sh` baseline reports lower clone-block count | CI-ONLY | Per CLAUDE.md, not run locally |
| A.8 | §8.8 | Targeted Vitest tests for new pure-function code pass | PASS | 13 pure tests + 11 HandlerContext suite tests all green |
| A.9 | §8.9 | `tasks/todo.md` items in §1 marked `[status:closed:pr:<num>]` in the merge commit | OUT_OF_SCOPE | Happens at merge time |

## Mechanical fixes applied

None — no mechanical fixes were applied this run. All gaps require human judgment.

## Directional / ambiguous gaps (routed to tasks/todo.md)

### F-1 (REQ C1.9) — Spec §8 acceptance #1 literal grep test fails (over-broad)

**Class:** spec-test-strictness drift; semantic intent satisfied
**Spec section:** §8 acceptance #1
**Quote:** *"verify by `grep -rn "from '.*skillExecutor\.js'" server/ | grep -v "import type" | grep -v "buildHandlerContext.ts"` returning ZERO hits"*

The literal grep returns 7 hits. None re-introduce the CD1 cycle (none of the 7 files value-imports `workflowEngineService`). The hits are:

| File | What it imports | Why it doesn't matter for CD1 |
|---|---|---|
| `server/services/agentScheduleService.ts:7` | `setHandoffJobSender` | Job DI setter, unrelated to workflowEngine |
| `server/services/skillAnalyzerService/execute/approved.ts:17` | `SKILL_HANDLERS` registry | Skill-analyzer pipeline; doesn't import engine |
| `server/services/systemMonitor/triage/triageHandler.ts:16` | `SKILL_HANDLERS, type SkillExecutionContext` | System-monitor triage; doesn't import engine |
| `server/services/systemSkillHandlerValidator.ts:4` | `SKILL_HANDLERS` | Validator; doesn't import engine |
| `server/services/systemSkillService.ts:7` | `SKILL_HANDLERS` | Skill service; doesn't import engine |
| `server/services/optimiser/__tests__/runOptimiserScanPure.test.ts:144` | `skillExecutor` for test fixture | Test file |
| `server/tools/meta/types.ts:3` | `export type { SkillExecutionContext }` re-export | Type-only re-export but `grep -v "import type"` misses `export type` |

The §2 goal #4 semantic intent (*"buildHandlerContext.ts is the only file in server/ that value-imports BOTH skillExecutor AND workflowEngineService"*) IS satisfied — confirmed by a directed grep crossing both services.

**Suggested approach (not a mechanical fix):**
- Update the spec's acceptance grep to additionally exclude `export type`, `__tests__/`, and the unrelated `setHandoffJobSender` / `SKILL_HANDLERS` imports — OR rewrite the acceptance as a `madge`-based assertion ("the bidirectional edge between `server/services/skillExecutor/` and `server/services/workflowEngine/` is gone").
- Or annotate §8 acceptance #1 with a note that the grep is a heuristic and the load-bearing test is the "both services value-imported only from `buildHandlerContext.ts`" invariant.

Cannot modify spec from this agent.

---

### F-2 (REQ D4.2) — DUP4 spec text references a `MessageRender` export that doesn't exist

**Class:** spec/code documentation drift (no functional defect)
**Spec section:** §6.4
**Quote:** *"Combine the two `messageRender.tsx` copies ... into `client/src/components/chat/messageRender.tsx`, named export `MessageRender`."*

The unified module at `client/src/components/chat/messageRender.tsx` exposes `renderAssistantContent`, `renderInlineMarkdown`, `renderBold` — matching the actual shared surface of the two source copies, which never had a `MessageRender` export. This is the same kind of "spec said X, code extracted Y, spec updated after the fact" drift the build hit at DUP1 (§6.1) and DUP5 (§6.5), where the spec was annotated with a "Note: spec originally specified ... but the builder correctly extracted the actual shared surface" line. DUP4 was missed.

Functional intent (delete dupe copies; both pages import from unified module; jscpd no longer reports the duplicate) IS satisfied. Only the spec text is stale.

**Suggested approach (not a mechanical fix):**
- Append an analogous note to §6.4 documenting the actual extracted exports.
- Cannot modify spec from this agent.

---

### F-3 (REQ D8.2) — DUP8 missing `webhookReplayNoncePruneJob` conversion

**Class:** functional gap (real implementation work remaining)
**Spec section:** §6.7 + §4.1
**Quote:** *"All 6 prune-job files become thin wrappers that call the factory: `agentObservationsPruneJob`, `fastPathDecisionsPruneJob`, `sandboxEgressAuditPruneJob`, `sandboxLogsPruneJob`, `sandboxTelemetryPruneJob`, `webhookReplayNoncePruneJob`."*

Five of the six prune-job files are now thin `definePruneJob(...)` wrappers. `server/jobs/webhookReplayNoncePruneJob.ts` remains unchanged from main (85 LOC, single cross-org DELETE inside `withAdminConnection` with `SET LOCAL ROLE admin_role`). The current `definePruneJob` factory iterates `SELECT id FROM organisations` and runs per-org DELETE — a fundamentally different shape from the webhook-nonce job's single cross-org statement.

This is not a mechanical fix. It needs a design choice:
- **Option A** — extend `definePruneJob` to support a `mode: 'cross-org-single-delete'` config flag, then convert the job.
- **Option B** — keep the divergent pattern and document a comment in `webhookReplayNoncePruneJob.ts` citing the spec exception with rationale. Update §6.7 to enumerate the exception.

**Suggested approach:** Option A is preferable — it keeps the spec promise that all 6 jobs are thin wrappers and preserves the factory as the single source of truth. Option B is a 5-minute fallback if extending the factory surfaces unexpected complexity.

This is the only finding in this run that represents real undelivered scope, not documentation drift.

---

### F-4 (REQ A.4) — `npm run build:server` fails on pre-existing main-branch issue

**Class:** pre-existing main-branch defect; outside this build's scope
**Spec section:** §8.4
**Quote:** *"`npm run build:server` exits 0 locally."*

`npm run build:server` fails:
```
server/services/configDocumentGeneratorService.ts(76,30): error TS2307: Cannot find module 'docx' or its corresponding type declarations.
server/services/configDocumentParserService.ts(101,35): error TS2307: Cannot find module 'mammoth' or its corresponding type declarations.
```

Both files exist on `main` at the merge-base commit (`77b70f82`) and are NOT modified by this branch. The build failure is pre-existing and unrelated to wave-4 work.

**Suggested approach (separate, single-purpose PR):**
- Install the missing modules: `npm install docx mammoth` (and `@types/mammoth` if applicable).
- OR add ambient declarations in `server/types/` for the two modules.
- OR mark the affected files as `@ts-nocheck` if they are not in the runtime path (less ideal).

Out-of-scope for this build but the spec §8.4 gate remains technically open until it's fixed. Likely a quick win that should run as a single-purpose fix-up PR independent of wave-4.

## Files modified by this run

- `tasks/todo.md` — appended the four directional findings under a new "Deferred from spec-conformance review — wave-4-architectural-and-duplication (2026-05-16)" section.
- `tasks/review-logs/spec-conformance-log-wave-4-architectural-and-duplication-2026-05-16T05-19-16Z.md` — this log.

No source-code files were modified. The CD1 cycle break, all 8 duplication extractions, the 4 frontend complexity items, and the architecture.md update are all in place from the build session.

## Next step

NON_CONFORMANT — 4 directional gaps must be reviewed by the operator before `pr-reviewer`. See `tasks/todo.md` under "Deferred from spec-conformance review — wave-4-architectural-and-duplication (2026-05-16)". Of these, DUP8 (missing `webhookReplayNoncePruneJob` conversion) is the only functional gap; the other three are spec-text drift or pre-existing main-branch issues outside this build's scope.

Because no files were modified by this run, `pr-reviewer` can run against the existing changed-code set without re-expansion. If the operator chooses to land the DUP8 conversion before `pr-reviewer`, re-run `spec-conformance` after that change to confirm.
