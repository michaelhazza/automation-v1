# Adversarial Review — workflows-v1 (spec + plan)

**Branch:** `claude/workflows-brainstorm-LSdMm`
**Build slug:** `workflows-v1`
**Reviewer:** `adversarial-reviewer` (Claude-native, read-only)
**Reviewed at:** 2026-05-03T00:00:00Z

**Verdict:** HOLES_FOUND (3 confirmed-holes, 4 likely-holes, 4 worth-confirming)

## Table of contents

- Scope note
- Findings F1–F6 (RLS / auth / resource abuse)
- Findings F7–F11 (race / injection / leakage)
- Additional observations
- Severity summary

## Scope note

Branch is docs-only; the spec describes a multi-tenant workflow execution system that will go to production. A hole in the spec becomes a hole in production. This review hunts adversarial holes in the **described design** before it gets built.

**Files reviewed:**
- `docs/workflows-dev-spec.md` (1,775 lines)
- `tasks/builds/workflows-v1/plan.md` (2,085 lines)
- `architecture.md`, `DEVELOPMENT_GUIDELINES.md` (reference)

---

## Findings F1–F6

### F1 (CONFIRMED-HOLE — HIGH) — Gate operations missing run-ownership FK check

- **Where:** spec §3.3 (lines 260–287); plan Chunk 1 migration SQL (lines 471–497); plan Chunk 4 (gate route handlers).
- **Attack scenario:** `WorkflowStepGateService.openGate` takes `(runId, organisationId, ...)` as params. RLS on `workflow_step_gates` is `organisation_id`-scoped via `app.organisation_id`. If the route handler derives `organisationId` from `req.orgId` but does NOT verify `workflow_runs.organisation_id = req.orgId` for the supplied `runId`, an authenticated user in Org A can supply a run-ID for a run in Org B. RLS doesn't protect against this — the WITH CHECK validates only that the inserted row's `organisation_id` matches the session var, not that the related run actually belongs to that org.
- **Fix:** spec §5.1.1 + plan Chunk 4 acceptance criteria must require: route handler verifies `workflow_runs.organisation_id = req.orgId` before calling any gate service method. Reference `DEVELOPMENT_GUIDELINES.md §9` checklist item "Cross-entity ID verified."
- **Severity:** HIGH

### F2 (LIKELY-HOLE — HIGH) — `workflow_drafts` GET endpoint scoped by org but not subaccount

- **Where:** spec §3.3 (lines 232–244); plan Chunk 14b contracts (lines 1664–1676).
- **Attack scenario:** `workflow_drafts` has `organisation_id` and `subaccount_id`; RLS enforces only `organisation_id`. A subaccount admin who knows a `draftId` from another subaccount in the same org can GET it via `GET /api/workflow-drafts/:draftId`.
- **Fix:** `WorkflowDraftService.findById` must verify `subaccount_id = resolvedSubaccount.id`. Spec §3.3 acceptance criteria for `workflow_drafts` route must require subaccount scope on every read endpoint.
- **Severity:** HIGH

### F3 (LIKELY-HOLE — MEDIUM) — `assignable-users` enables email enumeration across subaccounts

- **Where:** spec §14.2 (lines 1316–1350); plan Chunk 10 (lines 1287–1310).
- **Attack scenario:** `GET /api/orgs/:orgId/subaccounts/:subaccountId/assignable-users` returns full email for all users visible to caller. An org admin who only administers a "sandbox" subaccount can enumerate emails for any other subaccount by varying `:subaccountId`. No rate limiting or pagination specified.
- **Fix:** consider redacting email for users not in caller's subaccount membership; OR rate-limit (e.g., max 10 unique subaccount-IDs per minute per org admin); OR require explicit "I want to assign across subaccounts" admin permission.
- **Severity:** MEDIUM

### F4 (WORTH-CONFIRMING — LOW) — Approver-pool snapshot string normalisation

- **Where:** spec §5.1 (lines 381–395); plan Chunk 4 (line 746 `ApproverPoolSnapshot = string[]`).
- **Concern:** if user IDs in the snapshot capture in any non-normalised form (uppercase UUIDs, surrogate IDs, email strings for legacy users), the `userInPool(snapshot, userId)` pure function may fail an equality check for a legitimate approver.
- **Fix:** spec §5.1 should pin normalisation contract — UUIDs lowercase, branded type, parsed at write-time.

### F5 (CONFIRMED-HOLE — HIGH) — Cross-subaccount Ask routing access-grant lacks server-side authorisation

- **Where:** spec §14.4 (lines 1368–1374), §14.6 (lines 1385–1394).
- **Attack scenario:** an org admin authors a workflow that routes an Ask to Team X in Subaccount B. A team member in Subaccount B (no base access to the task in Subaccount A) clicks the notification and lands on the task view with full task view access. The spec grants this intentionally but doesn't specify the server-side check. If the route checks `task.subaccount_id` against memberships, cross-subaccount submitters 403. If widened to "any user in an open gate's `approver_pool_snapshot`", attack surface expands: any user whose ID appears in any open gate gets full task read access including pre-existing chat history and files.
- **Fix:** spec §14.4 must specify the access-grant mechanism. Minimum grant: "the calling user's ID appears in the `approver_pool_snapshot` of at least one OPEN gate on this task." V1 may grant full view; V2 introduces restricted-view. Either way, pin the assertion now.
- **Severity:** HIGH

### F6 (CONFIRMED-HOLE — CRITICAL) — `workflow.run.start` skill has no fan-out depth guard

- **Where:** spec §13.4 (lines 1258–1283); spec §4.5 (lines 352–356).
- **Attack scenario:** the validator prevents direct `workflow → workflow` nesting at the template definition level (§4.5). However, `workflow.run.start` is available to any agent at runtime. An agent inside a workflow can invoke `workflow.run.start` → that workflow's agent can again invoke `workflow.run.start` → unbounded recursion. There's no `MAX_WORKFLOW_DEPTH` check (analogous to `MAX_HANDOFF_DEPTH`). A single malicious or buggy workflow can exhaust pg-boss queue, DB connection pool, and org's LLM budget. Per-run `cost_ceiling_cents` doesn't help — each spawned run has its own ceiling.
- **Fix:** spec §13.4 must require `workflow.run.start` skill handler to read a `workflow_run_depth` counter from the principal context and return `{ ok: false, error: 'max_workflow_depth_exceeded' }` when depth exceeds a configurable cap. Default cap: 3. Plan Chunk 13 acceptance criteria must include depth-cap test.
- **Severity:** CRITICAL

---

## Findings F7–F11

### F7 (WORTH-CONFIRMING — LOW) — Stall-and-notify cancellation race

- **Where:** spec §5.3 (lines 443–449); plan Chunk 4 (line 703), Chunk 8 (lines 1063–1066).
- **Status:** the stale-fire guard (`expectedCreatedAt`) covers this race correctly. Flagged for verification at implementation time only.

### F8 (LIKELY-HOLE — HIGH) — XSS via `seen_payload.rendered_preview`

- **Where:** spec §6.3 (lines 517–530); §6.5 (lines 539–547).
- **Attack scenario:** `seen_payload.rendered_preview` is `string | null`, described as "optional human-readable preview (e.g., the email body if this is a 'send email' Action)." LLM-generated content. If the audit drawer / "view what she saw" modal renders `rendered_preview` as `innerHTML`, a jailbroken LLM could embed a script in the email-body preview that executes in the operator's browser.
- **Fix:** spec §6.3 must mandate that `rendered_preview` is treated as plain text — sanitised at write-time (HTML stripped) AND rendered as text content (not `dangerouslySetInnerHTML`) at read-time. Plan Chunk 6 acceptance criteria must include sanitisation test. Plan Chunk 11 (open-task UI) must specify `textContent`-only rendering for the audit modal.
- **Severity:** HIGH

### F9 (WORTH-CONFIRMING — LOW) — Cadence-detection NLP heuristic is gameable

- **Where:** spec §13.1 (lines 1188–1210).
- **Concern:** prompts can be crafted to force-trigger or suppress the `workflow_recommendation` card. Low severity (UX nudge, not code-execution path). Worth a one-line note that the heuristic is advisory only and any draft created from it goes through the standard publish flow with full validation.

### F10 (WORTH-CONFIRMING — MEDIUM) — Per-run cost cap doesn't aggregate across spawned children

- **Where:** spec §7.1 (lines 554–562), §13.4 (lines 1258–1283).
- **Concern:** even without recursion (F6), a single agent step can fire 100 child runs sequentially. Each has its own $5 ceiling = $500 aggregate cost before any cap fires.
- **Fix:** V1 acceptable as-is if F6's depth cap (max 3) is enforced (3 levels × ~10 children per level × $5 = $150 worst-case). V2 should add aggregate "lineage cost" cap. Document trade-off in spec §7.1.

### F11 (WORTH-CONFIRMING — LOW) — `approval.queued` event broadcasts approver-pool IDs

- **Where:** spec §8.2 (line 703); plan Chunk 9 (line 1166).
- **Concern:** all clients in `task:${taskId}` room receive the approver-ID list. If client resolves IDs to display names, this leaks org-chart structure to any task participant including cross-subaccount Ask submitters (per F5). Severity depends on whether client resolves the pool to names.

---

## Additional observations

- **Spec §19 open spec-time decisions** include confidence-chip cut-points (§19.1 #A) — left to architect after 100 internal cards. If never formally decided, the `workflowConfidenceCopyMap.ts` may ship with placeholder values producing misleading confidence values in production. Track in spec §19 as a release blocker.
- **Plan Chunk 1 pre-existing violation #1** (pool-membership check on the approval route) is flagged as a CI-coverage gap: "CI's `verify-rls-coverage.sh` does not catch this — it's an authz check, not RLS." Add to `DEVELOPMENT_GUIDELINES.md` as a known gap in automated enforcement.
- **`workflow_drafts.payload` typed as `jsonb NOT NULL`** with no size limit. An orchestrator producing a 500-step draft would write a very large JSONB. Spec should impose a size cap (e.g., max 100 steps per draft) at publish-time validation.
- **`approval.pool_refreshed` event** broadcasts `new_pool_size` only, not new pool contents. If client doesn't re-fetch the gate's authoritative snapshot after a refresh, it may display stale pool membership.

---

## Severity summary

| Finding | Category | Severity | Status |
|---------|----------|----------|--------|
| F1 | RLS / tenant isolation | HIGH | confirmed-hole |
| F2 | RLS / tenant isolation | HIGH | likely-hole |
| F3 | Cross-tenant data leakage | MEDIUM | likely-hole |
| F4 | RLS / tenant isolation | LOW | worth-confirming |
| F5 | Auth & permissions | HIGH | confirmed-hole |
| F6 | Resource abuse | CRITICAL | confirmed-hole |
| F7 | Race conditions | LOW | worth-confirming |
| F8 | Injection (XSS) | HIGH | likely-hole |
| F9 | Injection (UX) | LOW | worth-confirming |
| F10 | Resource abuse | MEDIUM | worth-confirming |
| F11 | Cross-tenant data leakage | LOW | worth-confirming |

**Phase 1 advisory; non-blocking unless escalated.**
