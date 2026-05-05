# Spec Review Plan — home-dashboard-reactivity

**Run started:** 2026-04-27T21-37-58Z
**Spec path:** `tasks/builds/home-dashboard-reactivity/spec.md`
**Spec commit at start:** untracked (working tree only)
**Spec-context commit:** 03cf81883b6c420567c30cfc509760020d325949 (2026-04-21)
**MAX_ITERATIONS:** 5
**Prior iterations for this slug:** 0 (no `spec-review-checkpoint-home-dashboard-reactivity-*` files in `tasks/`)
**Stopping heuristic:** two consecutive mechanical-only rounds = stop before cap.

## Pre-loop context check

- `docs/spec-context.md` read — testing posture `static_gates_primary` / `runtime_tests: pure_function_only` / `frontend_tests: none_for_now`.
- Spec's framing (§2 Not in scope, §13 testing plan) explicitly aligns with spec-context: only pure-function tests, no frontend / API contract / E2E tests. No mismatch.
- Spec acknowledges no new tables, no RLS changes, no migrations — consistent with rapid-evolution / pre-production framing.
- No HITL pause needed.

## Pre-loop pre-cached findings (for iteration 1)

Caught while verifying spec claims against actual codebase before launching Codex:

1. **Emitter signature is wrong throughout §5 and §11.** Actual `emitOrgUpdate(orgId, event, data)` takes 3 args (entityId is auto-set to orgId inside the wrapper). Spec's "Signature note" explicitly tells the implementer to use the 4-arg form, and every code example shows 4 args. This is mechanical and would be corrected in iteration 1's pass.
2. **`emitToSysadmin(event, entityId, data)` is 3 args, not 4** — the spec's §5.5 example happens to be correct (3 args) but the umbrella note in §5 is wrong.
3. **§4.1 claim "auto-joined on connect for every authenticated socket" is correct for `org:${orgId}`** — verified at `server/websocket/rooms.ts:37`. No fix needed.
4. **§10.2 step 4 reference to `useSocketRoom('sysadmin', '', ...)` is wrong shape** — actual hook signature is `useSocketRoom(roomType, roomId, events, onReconnectSync?)`. The events argument is a record, not an array. The "join:sysadmin" handler ignores the roomId argument anyway, so the right pattern is the lower-level `socket.emit('join:sysadmin')` plus `useSocket` for the event.

## Loop status: ABORTED — Codex CLI usage limit reached

Iteration 1 attempt at 2026-04-27T11:39:17Z returned:

> ERROR: You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Apr 29th, 2026 6:49 AM.

Per the spec-reviewer agent definition: "If the Codex CLI fails to run (non-zero exit, auth error), stop immediately and report the exact error to the caller." No iterations were completed. No mechanical fixes were applied to the spec. The pre-cached findings above were caught during the pre-loop codebase verification and are recorded here for the caller to triage manually if desired, but they were NOT applied to the spec.

No final report is written and no commits are produced — the review loop never started.
