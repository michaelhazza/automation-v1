# ChatGPT PR Review Session — execution-backend-adapter-contract — 2026-05-10T10-27-36Z

## Session Info
- Branch: claude/sandbox-execution-provider-DLfjn
- PR: #281 — https://github.com/michaelhazza/automation-v1/pull/281
- Mode: manual
- Started: 2026-05-10T10:27:36Z
- Branch HEAD at start: 493fc7eb

---

## Round 1 — 2026-05-10T10-50-00Z

### ChatGPT Feedback (raw)

PR review verdict: changes requested. I found 2 blockers and 3 tightenings. The architecture is mostly on track, but I would not merge until the boot-failure and backend-task contract drift are fixed.

Blockers
B1. Backend registration failure is logged but boot continues

The spec says registration validation is a boot-time safety boundary: adapters that fail validation should never reach dispatch, and validation failure is supposed to be fatal. The implementation catches registration errors, logs [boot] failed to register execution backends, and then continues startup. That means the app can boot with an empty or partial registry, and every later executionBackendRegistry.resolve() call can fail at runtime.

Fix: rethrow after logging, or move to the same fatal boot-failure pattern as other required boot dependencies.

} catch (err) {
  console.error('[boot] failed to register execution backends', err);
  throw err;
}

Also add a small acceptance note: adapter registration failure must prevent start() from completing.

B2. claudeCodeBackend changes backendTaskId semantics outside the plan/spec contract

The contract says backendTaskId is for delegated backends and is null for in-process and subprocess adapters. The plan also explicitly said claude-code returns backendTaskId: null. The implementation intentionally returns ccResult.sessionId as backendTaskId, describing it as an observability improvement.

That is a behaviour/contract change hidden inside a refactor. It also collides with the migration intent: (backend_id, backend_task_id) is a generic delegated-task reference, with backend_task_id null for in-process/subprocess paths.

Fix: restore backendTaskId: null for claude-code. If you want to preserve the Claude session ID, keep it in toolCallsLog.sessionId, which the implementation already does, or introduce a deliberately named future field such as backendSessionId in a separate observability PR.

Tightenings
T1. ParentRunNotDispatchable fallback still invents a synthetic zeroed response

The plan explicitly said to map this to the exact existing race-loser shape, or rethrow and document if no such shape exists. The implementation returns a synthetic response with summary: null, zero counters, and a coerced status derived from the observed parent row.

That may be acceptable operationally, but it is not proven to be the "exact existing race-loser shape." If no such shape exists, the plan said not to invent one.

Fix: either cite/replicate the exact existing shape, or rethrow ParentRunNotDispatchable and let the PR document the behaviour.

T2. The finaliser capability mismatch is silently downgraded to false

finaliseAgentRunFromBackend() resolves an adapter and, if the adapter is not delegated or lacks finalisation methods, logs agentRunFinalization.non_delegated_adapter and returns false.

Given the registry already validates delegated adapters, this path indicates caller misuse or registry/config drift. Returning false makes a bad call look like an idempotent no-op.

Fix: throw a typed error or at least make this impossible by narrowing the call path. I would throw, because calling finalisation on api, headless, or claude-code is a programmer error, not a recoverable reconciliation result.

T3. Registration order is okay, but deterministic order drift is minor

The spec/plan preferred deterministic registration order as api, headless, claude-code, iee_browser, iee_dev. The implementation registers IEE first, then API/headless/Claude. This probably does not matter functionally, but the spec says order matters for log output.

Fix: reorder registrations to match the spec unless there is a deliberate reason not to.

What looks good

The neutral agentExecutionLoop.ts extraction addresses the runtime-cycle risk cleanly. The IEE handler correctly derives backendId from iee_runs.type, preserving the legacy in-flight fallback path without depending on agent_runs.backend_id. The mismatch-invariant tests now cover all five concrete adapters, which closes the gap from the earlier spec/plan pass.

Recommendation

Apply B1 and B2 before merge. I would also take T1 and T2 in the same patch because they are small and prevent silent correctness drift.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| B1 — boot continues silently after adapter registration failure | technical | implement | auto (implement) | high | Spec § 8.2 makes registration a boot-time safety boundary; partial-registry boot would surface as a 500 on every dispatch — strictly worse than a clean fatal-on-failure crash. Mirrors fatal-on-failure pattern of other required boot deps. |
| B2 — claudeCodeBackend returns sessionId as backendTaskId | technical | implement | auto (implement) | high | Spec § 4.1 / § 7 contract: `backend_task_id` is the delegated-task reference, null for in-process and subprocess adapters. Plan line 421 explicit. Hidden contract drift; sessionId is already preserved in `toolCallsLog[0].sessionId`. |
| T1 — ParentRunNotDispatchable invents synthetic zeroed response | technical | implement | auto (implement) | medium | Plan § 8 / spec § 13.1.1 says: rethrow if no existing race-loser shape exists. Verified `origin/main`: pre-cutover dispatch had no such shape. Rethrow + structured warn is the spec-compliant path. |
| T2 — finaliser capability mismatch silently returns false | technical | implement | auto (implement) | medium | Registry already validates delegated adapters at registration; reaching this branch is caller misuse (stale event payload, wrong reconciliation backendId). Adding `FinaliseRequiresDelegatedAdapter` typed error so misuse is loud. |
| T3 — registration order drifts from spec § 8.3 | technical | implement | auto (implement) | low | Spec says api → headless → claude-code → iee_browser → iee_dev. Reordered in `server/index.ts`. Functional no-op (registry is a map) but log-output order matters per spec. |

### Implemented (auto-applied technical)

- [auto] B1 — `server/index.ts:659-687` — Adapter registration block now rethrows on failure with a structured comment. Order also corrected to match spec § 8.3 (T3 same-edit).
- [auto] B2 — `server/services/executionBackends/claudeCodeBackend.ts:85-97` — `backendTaskId: null` restored. Comment explicitly documents the contract; sessionId remains in `toolCallsLog[0].sessionId` for observability.
- [auto] T1 — `server/services/agentExecutionService.ts:1614-1639` — Removed synthetic zeroed-response branch; rethrow `ParentRunNotDispatchable` after structured warn line. Inline comment documents the rationale and points at plan § 8.
- [auto] T2 — `server/services/executionBackends/types.ts` (new `FinaliseRequiresDelegatedAdapter` class) + `server/services/agentRunFinalizationService.ts` (now throws instead of logging+returning false). Doc comment on `finaliseAgentRunFromBackend` updated.
- [auto] T3 — Folded into B1 edit. Order is now `api, headless, claude-code, iee_browser, iee_dev`.

### Top themes
architecture, error_handling, scope

### Verification
- `npm run lint` — 0 errors (warnings unchanged from baseline, none in our edits).
- `npm run typecheck` — clean.

---

## Round 2 — 2026-05-10T11-30-00Z

### ChatGPT Feedback (raw)

Round 2 verdict: approved, with one small optional polish item. The 5 Round 1 findings are closed cleanly.

What changed correctly:

B1 closed: backend registration is now unconditional, in deterministic spec order, and fatal on registration failure via throw err. That fixes the partial-registry boot hazard.
B2 closed: claudeCodeBackend now keeps backendTaskId: null, with sessionId retained only in toolCallsLog[0].sessionId, matching the adapter contract.
T1 closed: ParentRunNotDispatchable no longer returns a synthetic zeroed response. It logs and rethrows because no pre-cutover race-loser shape exists.
T2 closed: finalisation now throws FinaliseRequiresDelegatedAdapter for non-delegated misuse instead of silently returning false.
T3 closed: registration order now matches api, headless, claude-code, iee_browser, iee_dev.
Optional polish, not a blocker
P1. Clarify one comment that claims typed errors render as 4xx

The ParentRunNotDispatchable comment says the route layer's existing error envelope renders typed errors as a 4xx. I have not seen evidence in the diff that ParentRunNotDispatchable carries statusCode or that the route layer maps this class to 4xx. The safer wording is:

Rethrow with a structured warn line so operators see the race in logs. The route layer will surface the typed error according to the existing error-envelope behaviour. A deliberate AgentRunResult shape for this case can be added later once the desired client-visible shape is decided.

This avoids overclaiming the HTTP status behaviour in a code comment.

Recommendation

No further review round needed. Merge once CI is green.

### Verdict
**Verdict:** APPROVED

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| P1 — comment overclaims that typed errors render as 4xx | technical | implement | auto (implement) | low | Investigation: `ParentRunNotDispatchable` (server/services/executionBackends/types.ts:421) extends `Error` and has NO `statusCode` field. `normaliseRouteError` (server/lib/asyncHandlerNormalisationPure.ts:25-51) checks for `instanceof AppError`, then duck-typed `statusCode: number`, then falls through to `kind: 'unknown'` with statusCode 500. So this error today actually maps to a 500 envelope, not a 4xx — the comment is verifiably wrong. Applied ChatGPT's suggested rewording verbatim. |

### Investigation notes for P1

- Verified `ParentRunNotDispatchable` class definition (`server/services/executionBackends/types.ts:421-430`): `extends Error`, fields are `runId` and `reason`, NO `statusCode`.
- Verified the route layer error envelope (`server/lib/asyncHandler.ts` + `server/lib/asyncHandlerNormalisationPure.ts`):
  - `asyncHandler` calls `normaliseRouteError(err)` for all caught errors.
  - `normaliseRouteError` returns `kind: 'unknown'` with `statusCode: 500, code: 'LEGACY_ERROR'` for any `Error` that lacks both `instanceof AppError` and a numeric `statusCode` field.
  - `ParentRunNotDispatchable` matches neither AppError nor the duck-shape — it would currently be rendered as a 500.
- Verified the route call site (`server/routes/agentRuns.ts:55-90`): only `ControllerStyleNotAllowedForAgentError` has explicit handling; everything else falls through to `asyncHandler`'s 500 path.
- Conclusion: ChatGPT's claim is correct — the comment overclaimed 4xx behaviour. The suggested rewording is more accurate ("according to the existing error-envelope behaviour" — neutral on the actual status code). Implemented as recommended.

### Implemented (auto-applied technical)

- [auto] P1 — `server/services/agentExecutionService.ts:1629-1634` — Reworded the comment block to remove the unsupported "renders typed errors as a 4xx" claim. Now reads: "Rethrow with a structured warn line so operators see the race in logs. The route layer will surface the typed error according to the existing error-envelope behaviour. A deliberate AgentRunResult shape for this case can be added later once the desired client-visible shape is decided — that is a behaviour change, out of scope here."

### Top themes
documentation, error_handling

### Verification
- `npm run lint` — 0 errors.
- `npm run typecheck` — clean.

