# Spec Review Log — personal-assistant-v2-operator — Iteration 2

**Date:** 2026-05-13
**Spec:** `docs/superpowers/specs/2026-05-13-personal-assistant-v2-operator-spec.md`
**Codex output:** `tasks/review-logs/.codex-iter2-personal-assistant-v2-operator-2026-05-13T06-20-05Z.txt`
**Codex model:** gpt-5.4
**Codex returned the same review block twice — findings deduplicated to 6 distinct items.**

## Findings & decisions

### Codex findings

**C2-1 — Run-trace privacy projection not wired into a read path (CRITICAL)** — mechanical, auto-applied.
- §4.2 declared `runTraceProjectionForViewer` but no §4.3 consumer was named. Added three concrete consumers to §4.3: `agentExecutionEventService.ts`, `server/routes/taskEventStream.ts`, `server/routes/agentRuns.ts`. Two-layer enforcement (service + route) deliberately chosen so a future bypass of the route still gets the projection. Acceptance criterion added to Chunk 3 (pure-function test asserts projection blanks owner-private fields when viewerUserId differs).
- Also expanded §4.2 row to state the consumers MUST invoke the projection.

**C2-2 — §5.4 producer line still cited the authorisation service, not the assembler (important)** — mechanical, auto-applied. Updated §5.4 producer + §5.6 producer to name `crossOwnerDelegationRequestAssembler.build(...)` consistently. Authorisation service is now described as an upstream input only.

**C2-3 — Chunk 3 didn't include the new assembler (important)** — mechanical, auto-applied. Renamed Chunk 3 to "Cross-owner delegation authorisation + request assembly + credentials"; added assembler + assembler pure helper + the `delegation_outcomes.cross_owner_approval_timeout_policy` write + `runTraceProjectionForViewer` pure helper to the chunk body.

**C2-4 — Cross-owner event inventory not closed (important)** — mechanical, auto-applied. §9.4 previously claimed `proposed|authorised|routed|executing|awaiting_initiator_decision` were emitted events, but §4.6 only listed `.completed`. Scoped down the emitted set: only `cross_owner_substep.awaiting_initiator_decision` (when the `ask_initiator` branch fires) and `cross_owner_substep.completed` (terminal) are emitted as events. `proposed`/`authorised`/`routed`/`executing` are state-machine transitions tracked on `delegation_outcomes.status`, not events. §4.6 now lists both emitted variants; §9.4 rewrites the lifecycle paragraph; §10 testing-posture line updated to reference all four V2-added variants.

**C2-5 — Downstream sections hard-coded strategy (b) despite §13 #1 unresolved (important)** — mechanical, auto-applied. Made §6.1 explicitly conditional on §13 #1 resolution (lists both strategies' RLS consequences). Updated §11 single-source-of-truth bullet to be strategy-neutral. Strategy-neutralised every `executionFiles` reference in §4.2, §5.7 (`Tool-call interceptor vs watcher precedence`), §8 Chunk 7, §9.1, §9.2, §9.6.

**C2-6 — File-inventory drift for additional paths (minor)** — mechanical, auto-applied. Added five paths to §4.8: `client/src/pages/OpenTaskView.tsx`, `client/src/components/global-ask-bar/GlobalAskBar.tsx`, `server/db/schema/executionFiles.ts`, `server/services/__tests__/capabilityMapServicePure.routing.test.ts`, and noted §13 #1 path for `executionFiles.ts` schema reference.

### Rubric findings (independent pass)

**R4 — §4.2 `operatorSandboxFileEventBridge.ts` still cited `executionFiles` directly** — mechanical, auto-applied jointly with C2-5. Service description now says "writes via a thin Drizzle helper exported by the chosen schema module"; pure helper description updated to "looks up prior file-metadata row by `agent_run_id` + relative path; backing-store table per §13 #1".

## Iteration 2 Summary

- Mechanical findings accepted:  7 (C2-1 through C2-6 from Codex, R4 from rubric)
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions:          0
- Spec commit after iteration:   (recorded after Step 8b commit)

## Notes for iteration 3

- The two biggest internal contradictions (privacy projection unwired; `ask_initiator` event variant inventory) are now closed.
- The §13 #1 schema decision remains operator-pending; every downstream section is now strategy-neutral.
- Watch for: did making things strategy-neutral introduce vague language that wouldn't survive an audit? Iteration 3 should sanity-check that every "§13 #1 backing-store table" phrase in the spec has a real fallback.
