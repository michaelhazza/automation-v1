```adversarial-review-log
# Adversarial Review — consolidation-operate

**Files reviewed:** server/routes/{activity,inbox,agentRuns}.ts; server/services/{activityService,activityServicePure,inboxService,inboxServicePure,agentRunMessageServicePure}.ts; shared/types/operate.ts; client surface (read-only context).

**Run at:** 2026-05-07T20:36:46Z
**Branch:** ui-consolidation-operate
**Base:** origin/main (79a95a52)
**Reviewer:** feature-coordinator inline (Sonnet-equivalent threat-model walk)

**Verdict:** NO_HOLES_FOUND (3 worth-confirming, 0 likely-hole, 0 confirmed-hole)

---

## Threat-model checklist

### 1. RLS / tenant isolation

No findings as holes. Three worth-confirming observations:

- **WC-1.1 — Trace-events SELECT on `agent_run_snapshots` has no explicit org predicate.** `server/routes/agentRuns.ts:200-204` selects `toolCallsLog` `WHERE runId = ?` only. The pre-check at lines 188-196 validates that the runId belongs to `req.orgId`, so an attacker cannot fetch a snapshot for a run they don't own — the precheck would 404 first. The SELECT relies on either (a) the precheck or (b) RLS on `agent_run_snapshots`. Comment claims "RLS on agent_run_snapshots forbids cross-org reads"; verify RLS policy is active on that table. If RLS is off on this connection, the precheck is the only gate. Not exploitable as currently structured; verify RLS to make defense-in-depth.

- **WC-1.2 — `/api/agent-runs/:id/trace-events` uses `authenticate` only, no `requirePermission`.** Matches the existing pattern of sibling `/api/agent-runs/:id` (same file, same gating posture). Org-id match is the sole tenant check. Not new exposure for this build, but inherits the broader pattern. Cite for traceability.

### 2. Auth & permissions

No findings as holes. One worth-confirming:

- **WC-2.1 — Inbox approve/reject route trusts client-supplied `kind` field.** `server/routes/inbox.ts:198-202` reads `kind` from the request body and validates against `VALID_INBOX_KINDS`. The downstream `inboxService.approveItem(orgId, userId, { kind, entityId })` runs UPDATE with `WHERE id=? AND organisationId=?` — so an attacker who claims `kind='review_item'` for an `entityId` that's actually an `actions.id` would fail the WHERE predicate (UUIDs are unique per table). Tenant isolation holds. Hardening option (not blocking): derive `kind` from a server-side lookup rather than trusting the client. Skipping the client field would also save a small amount of code surface.

### 3. Race conditions

No findings.

- Inbox approve/reject: single UPDATE with `WHERE status IN (...)` predicate; concurrent calls — only one wins, other returns 0-rows → `alreadyApplied=true`. State-based idempotency, no read-modify-write races.
- Inbox archive: `INSERT … ON CONFLICT DO UPDATE` (upsert) on `inbox_read_states` (single PK on userId+entityType+entityId). Idempotent under retry.
- Activity feed: read-only; cursor walks canonical `(createdAt DESC, id ASC)`; per-source limits enforced (200) and final slice limit ≤ 200.

### 4. Injection

No findings.

- `q` search: parameterised via Drizzle `ilike(col, '%${q}%')` — Drizzle binds the value, no string concat into raw SQL. Additional `%`/`_` escaping in `inboxService.ts:110` for LIKE wildcards.
- Cursor: opaque base64-JSON; `decodeCursor` parses `JSON.parse` on the decoded string and validates fields. Bad input → undefined → restart from page 1; no exception bubbling.
- Body inputs (`kind`, `reason`, `band`): all run through allowlists at the route layer.
- Reject reason: 2000-char cap (`inbox.ts:238-240`).

### 5. Resource abuse

No findings.

- Activity per-source limit: 200 rows. Total merged set: up to 7 sources × 200 = 1400 items max. Final slice capped at 200.
- Inbox: `MAX_ITEMS_PER_SOURCE = 50`, `MAX_TOTAL_ITEMS = 100` (inboxService.ts:60-61).
- Faceted-aggregation cost: 4 dimensions × O(N) where N ≤ 1400 → ~6k ops. Bounded.
- Trace events `toolCallsLog` is a JSONB blob on `agent_run_snapshots`; size is bounded by the producer (agent-execution loop) which has its own caps. Single-row read.

### 6. Cross-tenant data leakage

No findings.

- `Cache-Control: private, no-store` on activity (all three scope variants) AND trace-events. Comments lock the invariant against future "let's cache for performance" PRs.
- 404 on org-mismatch (trace-events endpoint) does not echo the runId or any other tenant-identifying info.
- Audit-log entries written via `auditService.log(...)` for inbox actions; org-scoped.

---

## Additional observations

None — all findings above. Cap-of-10 not approached.

---

## Routing

This run produced zero `confirmed-hole` and zero `likely-hole` findings. The three `worth-confirming` items are documented in the log for traceability and pass-through to chatgpt-pr-review (Phase 3) which can confirm or close them. No `tasks/todo.md` entries needed — `worth-confirming`-only does not block per agent contract.
```
