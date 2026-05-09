# PR Review — agent-workspace fix-loop (post-2f2a3ed3)

**Reviewed:** 2026-05-09T05:18:00Z
**Branch:** `claude/add-agent-cloud-compute-Kb4ii` vs `origin/main`
**Spec:** `tasks/builds/agent-workspace/spec.md` (LOCKED)
**Prior review log:** `tasks/review-logs/pr-review-log-agent-workspace-2026-05-08T22-41-57Z.md`
**Fix commit under review:** `2f2a3ed3`

**Verdict:** CHANGES_REQUESTED (1 blocking new, 2 strong new, 2 carried-forward strong; B1–B8 functionally resolved)

---

## Blocking Issues

### NEW-B9. SSE `fanOut` fires even when watermark predicate blocks the upsert — stale-state leak to live subscribers

`server/services/agentPresenceService.ts:175-251` — the upsert is gated by `WHERE EXCLUDED.last_event_timestamp > … OR (… AND EXCLUDED.last_event_id > …)`. When this predicate fails (out-of-order event), the row is NOT updated. But the SSE emission (`fanOut(sseEvent)` and `fanOutToWorkspace`) runs unconditionally. Live subscribers receive a `presence_state_changed` event carrying the stale `newState`, while the DB projection retains the newer state. The next reconnect snapshot disagrees with the live event.

This is a new correctness bug introduced by the B2 wiring fix.

**Fix.** Capture `rowCount` from `db.execute(...)`. PostgreSQL returns `rowCount=0` when the WHERE predicate fails; `rowCount=1` on successful insert or update. Only emit when `rowCount === 1`:

```ts
const result = await db.execute(sql`INSERT … ON CONFLICT … DO UPDATE … WHERE …`);
if ((result as { rowCount?: number }).rowCount !== 1) return;
fanOut(sseEvent);
if (subaccountId) fanOutToWorkspace(subaccountId, sseEvent);
```

---

## Strong Recommendations

### NEW-S6. `partial_runs` is never incremented — spec §11.5 column is dead code

`agentWorkingTimeService.ts:124-158` — `run.completed` handler splits only on `finalStatus === 'completed'` vs everything-else. Spec §11.5 lists `partial_runs` separately. Today the runtime never emits `finalStatus: 'partial'`, so functionally OK, but the column stays zero and the bar's render logic is incomplete. Add a `finalStatus === 'partial'` arm and document how `timeout/cancelled/loop_detected/blocked_awaiting_integration` map.

### NEW-S7. `agentPresenceStream.ts` introduces direct `db` import in a route file

`server/routes/agentPresenceStream.ts:13` — `import { db } from '../db/index.js'`. Convention from `architecture.md § Service Layer`: routes never import `db` directly. Extract agent ownership lookup to a service helper (e.g., `agentLookupService.findOwnedAgent(agentId, orgId)`), and use `getOrgScopedDb` inside it so RLS provides defence-in-depth alongside the explicit org filter.

### S1 (carried forward). TOCTOU on legal-transition check — unchanged from prior review.

### S5 (carried forward). Test coverage gap for producer wiring — unchanged from prior review.

---

## Nice-To-Have

### NEW-N5. `authenticateSSE` mutates `req.headers.authorization`
`auth.ts:212` — setting the header before delegating to `authenticate` works but any downstream logger/middleware that reads the header will see a token for a query-param request. Defensive alternative: pass raw token as a parameter to a shared inner helper.

### NEW-N6. Document `?token=` SSE auth pattern in `architecture.md`
Per `CLAUDE.md § Docs Stay In Sync With Code` — add one line to the SSE section noting `authenticateSSE` and the token-in-query-param convention.

### NEW-N7. Long-lived SSE connection holds the auth tx open for the full connection lifetime — pre-existing.

### NEW-N8. `step_completed` matching can pick the wrong `step_started` under nested steps — theoretical until nesting is supported.

### Carried forward: N1–N4, S2, S3, S4.

---

## B1–B8 Verification Pass

| ID | Status | Notes |
|---|---|---|
| **B1** | Resolved | Agent ownership check runs before `sseSetup`. Caveat: raw `db` import (NEW-S7). |
| **B2** | Resolved | Fire-and-forget wiring from `agentExecutionEventService`. Caveat: unconditional `fanOut` (NEW-B9). |
| **B3** | Resolved | `authenticateSSE` accepts `?token=`; client appends from localStorage. Caveats: NEW-N5, NEW-N6. |
| **B4** | Resolved | `RETURNING bucket_date` — correct column. |
| **B5** | Resolved (caveat) | `run.completed` handler added. `partial_runs` never written (NEW-S6). |
| **B6** | Resolved | DB query replaces `stepStartMap`. Crash-safe across replicas. Caveat: NEW-N8. |
| **B7** | Resolved | 4-tuple idempotency key matches spec §1110. |
| **B8** | Resolved | `subaccount_id` in INSERT and ON CONFLICT SET. |

---

## Notes For Caller

- NEW-B9 is the only blocking issue; single `rowCount` check fixes it.
- NEW-S7 (raw `db` in route) is a convention violation; prefer service extraction.
- After NEW-B9 fix, re-run typecheck and lint.
