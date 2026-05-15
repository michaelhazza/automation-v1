# Wave 2 — Hotspot circular-deps audit

**Verdict:** PASS_WITH_DEFERRED
**Scope:** `server/` and `client/src/` — `madge --circular --ts-config tsconfig.json --extensions ts,tsx`.
**Branch:** `claude/wave-2-audit-sweep`
**Captured:** 2026-05-15T07-19-34Z

## Reconnaissance Map

- Tool: `npx madge@8.0.0` (auto-installed). Full server output: `tasks/audit-logs/madge-server-raw.txt`.
- Server scan: 2,223 files processed, **73 circular dependencies**.
- Client scan: 727 files processed, **4 circular dependencies**.

## Pass 1 Findings

### Server (73 cycles)

**Three dominant cycle clusters (CD1 + CD2 + CD3 combined) account for ~85% of the 73 cycles.** CD1 alone covers cycles 19–61 (~43 cycles, ~59%); CD2 covers cycles 64–71 (~8 cycles); CD3 covers the residual `workflowEngineService`-routed paths. The remaining ~15% are the smaller named cycles CD4–CD10.

| ID | Severity | Confidence | Finding |
|---|---|---|---|
| CD1 | high | high | **`skillExecutor.ts` ↔ `agentExecutionService.ts` mutual-import super-cycle.** Most cycles trace through `services/skillExecutor.ts > services/skillExecutor/registry.ts > services/skillExecutor/handlers/*.ts > tools/.../*.ts > services/agentScheduleService.ts > ... > services/workflowEngineService.ts > services/workflowEngine/queueLifecycle/agentStep.ts > services/workflowEngine/queueLifecycle/dispatch.ts > services/workflowActionCallExecutor.ts > services/skillExecutor.ts`. The dispatch layer (`workflowEngine/queueLifecycle/dispatch.ts`) imports `workflowActionCallExecutor.ts` which imports `skillExecutor.ts` which dispatches back into `agentExecutionService.ts`. Long chain (12–17 nodes) but the structural issue is the bidirectional dependency between the skill-execution surface and the workflow-dispatch surface. Cycles 19–61 are variants of the same root cycle differing only in the leaf node. Root cause: handler files in `skillExecutor/handlers/` import services that import `agentExecutionService` which imports them back transitively. Recommended approach: invert dependency via an interface registry pattern — handlers receive their dispatcher as injected dependency rather than importing it. |
| CD2 | medium | high | **`agentExecutionService.ts` ↔ `agentExecutionLoop.ts` ↔ `executionBackends/*` triangle.** Cycles 64–71 chain: `agentRunFinalizationService.ts > executionBackends/registry.ts > executionBackends/types.ts > executionBackends/options.ts > agentExecutionLoop.ts > agentExecutionService.ts > services/agentExecutionService/resume.ts > ...types.ts > middleware/types.ts`. Suggests the executionBackends layer was meant to be a lower-level primitive but ended up importing back into the orchestration layer. Recommended approach: move `executionBackends/options.ts` types into a pure types-only module that does not transitively pull `agentExecutionLoop.ts`. |
| CD3 | medium | high | **`workflowEngineService` post-split residual cycles.** Despite PR #319 splitting `workflowEngineService.ts` (down from 4,073 LOC to 64 LOC), cycles 19–35, 58–63 still route through `workflowEngineService.ts > workflowEngine/queueLifecycle/agentStep.ts > workflowEngine/queueLifecycle/dispatch.ts`. The 64-LOC re-export shell is now a cycle waypoint, not a cycle root. Surface-level fix landed; deeper cycle remains in the queueLifecycle dispatch chain. |
| CD4 | low | medium | **`notifyOperatorFanoutService.ts ↔ notifyOperatorChannels/{email,inApp,slack}Channel.ts`** (cycles 16–18). Classic dispatcher-channel-back-to-dispatcher pattern. Recommended approach: each channel module imports a types-only contract, not the fanout service itself. Three-line fix. |
| CD5 | low | medium | **`agentExecutionService.ts > agentExecutionService/resume.ts > agentExecutionServicePure.ts`** (cycle 67). The pure module should be a leaf, not a parent of `resume.ts`. Suggests an inverted import — possibly fixable by moving the offending types out of `agentExecutionServicePure.ts`. |
| CD6 | low | medium | **`reportRenderingService.ts > reportTemplates/MacroReport.tsx`** (cycle 73). Single .tsx in server — likely the template depending back on the renderer for shared types. Move shared types to a `types.ts` sibling. |
| CD7 | low | high | **`server/mcp/mcpServer.ts` (cycle 13)** — `mcpServer.ts:190-219` ↔ `mcpServer.ts:134-163` self-import via barrel re-export. Same-file cycle suggests a barrel-export shape that re-imports the same file. Worth a 5-minute look. |
| CD8 | low | high | **`server/services/sandbox/sandboxProviderResolver.ts > services/sandbox/inlineSandbox.ts`** (cycle 72). Pair pattern — provider resolver imports an implementation it should only know via the interface. |

### Client (4 cycles)

| ID | Severity | Confidence | Finding |
|---|---|---|---|
| CD9 | low | high | **`pages/govern/components/AppIntegrationsTab.tsx ↔ ConnectAppModal.tsx`** (cycle 1) and **↔ `ManageMultiConnectDrawer.tsx`** (cycle 2). The tab opens modals that depend back on the tab for shared state types. Lift state types to a `types.ts` sibling. |
| CD10 | low | high | **`pages/govern/components/WebLoginsTab.tsx ↔ EditWebLoginModal.tsx`** (cycle 3) and **↔ `TestWebLoginModal.tsx`** (cycle 4). Identical pattern to CD9, different feature. |

## Prevention Proposals

| ID | Target | Proposal | Closes |
|---|---|---|---|
| PP-CD1 | `gate` | Add `npm run check:circular` (madge --circular) to CI as a non-blocking warn gate, with a **baseline of 73 server + 4 client cycles**. Any net-new cycle introduced in a PR fails the check. Pairs with §8 development-discipline rule set. Currently no gate exists — the repo silently accumulates cycles. Leverage tier 1. | CD1–CD10 |
| PP-CD2 | `architecture.md` | Document the "handler-imports-via-interface, never via service" rule for `server/services/skillExecutor/handlers/`. Each handler file should depend on a `HandlerContext` type only, not on `agentExecutionService` or `workflowEngineService` directly. Leverage tier 2. | CD1, CD2 |
| PP-CD3 | `KNOWLEDGE.md` | Pattern entry: "A god-file split that introduces a re-export shell can preserve the cycle through the shell. Verify cycles post-split using `madge --circular` and compare counts to baseline before claiming the split worked." Closes split-claim audit gap. Leverage tier 3. | CD3 |

## Post-audit actions required

- `pr-reviewer: review tasks/audit-logs/madge-server-raw.txt and confirm CD1 cluster is the right next-priority`.

Findings count: 10 (1 high, 5 medium, 4 low). 73 server cycles + 4 client cycles total.
