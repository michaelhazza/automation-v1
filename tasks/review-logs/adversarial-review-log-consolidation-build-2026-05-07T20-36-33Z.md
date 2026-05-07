# Adversarial Review Log

```adversarial-review-log
**Branch:** `ui-consolidation-build`
**Base:** `origin/main` (HEAD `31dce198` after pr-reviewer fix-loop)
**Run at:** 2026-05-07T20:36:33Z
**Reviewer:** adversarial-reviewer (parent-session playbook execution)
**Auto-trigger:** matched 10 files (migrations 0286, schema/agents, schema/projects, agentEtagPrecondition, agentRuns, agents, agents/agentTabs, projects, recurringTasks).

**Verdict:** ADVISORY — 0 confirmed-holes, 1 likely-hole, 6 worth-confirming. None blocking; phase 1 advisory posture.

---

## 1. RLS / tenant isolation

No findings. Every new query filters `eq(table.organisationId, orgId)` and `isNull(table.deletedAt)`. New columns on `agents`/`projects` are additive; both tables are already in `rlsProtectedTables.ts` (lines 559, 754). Column additions inherit existing FORCE-RLS row policies; no policy migration required.

## 2. Auth & permissions

**worth-confirming W1 — `/api/projects/:id` GET + PATCH gated by `authenticate` only.** `server/routes/projects.ts:17-37`. Cross-org prevented by service-layer filter, but any same-org session can mutate any project via UUID. Matches legacy convention in same file. Already flagged in pr-review-log S1.

**worth-confirming W2 — `replaceDataSources` skips google_drive connection validation.** `server/services/agentService.ts:2168-2225`. The legacy POST `/api/agents/:id/data-sources` validates `google_drive` connections (`agents.ts:103-121`). The new PUT path inserts directly without checking `connectionId`. Severity low — runtime path fails gracefully — but inconsistent with POST. Suggested fix: add the same google_drive validation block, OR scope new PUT to non-drive kinds.

**worth-confirming W3 — Test-run rate limit keyed on user-id only.** `server/routes/agents.ts:200`. Existing pattern (not new in this build), no actual evasion. Flag for awareness only.

## 3. Race conditions

**likely-hole L1 — ETag race window is documented last-writer-wins.** `server/services/agentService.ts:2030-2306`. Plan §3 Q1 lines 146-161 explicitly accept this for Phase 1: "agent edits are low-frequency administrative operations". Two concurrent passes can both check the ETag against the same baseline and the second silently overwrites the first. Phase 2 should upgrade to `SELECT ... FOR UPDATE` or a monotonic `revision` column. Already documented; move to acceptance.

**worth-confirming W4 — Save-chain partial-success surface on AgentEditPage.** `client/src/pages/build/AgentEditPage.tsx:99-155`. If write #3 fails after #1 and #2 succeed, agent is left partially-applied. ETag mitigates downstream concurrency. UX gap, not security.

## 4. Injection

No findings. No raw-SQL string concat. The single raw-SQL block in `patchPersonality` (`agentService.ts:2122-2126`) uses `drizzleSql` template-tagged literals with parameterised values.

## 5. Resource abuse

**worth-confirming W5 — Agent-test fire-and-forget execution.** `server/routes/agents.ts:195-249` + `migration-gaps.md` § "startRunAsync — non-durable fire-and-forget". Process restart leaves `running` rows orphaned permanently. Already documented PLAN_GAP. Phase 2 should route through pg-boss + add stuck-run cleanup job.

## 6. Cross-tenant data leakage

**worth-confirming W6 — `isSystemManaged` stripped from API response breaks client-side read-only gate.** `server/routes/agents/agentTabs.ts:32,52,72,92,114,136,158,178` + `client/src/pages/build/AgentEditPage.tsx:185`. The route strips `isSystemManaged` ("internal guard only") but the client reads `data.isSystemManaged` to gate read-only UI. Because the field is stripped, the gate never triggers — system-managed agents appear editable. Save is blocked by the server-side `_assertNotSystemManaged` guard (403), so no security hole — but the UX is broken. Severity: low (UX inconsistency, not data leak). Suggested fix: stop stripping `isSystemManaged` (it's already exposed via `GET /api/agents/:id`), OR refactor client gating to call a dedicated `/api/agents/:id/can-edit` endpoint.

---

## Verdict

ADVISORY. 1 likely-hole (L1, documented accept-and-defer), 6 worth-confirming, 0 confirmed-holes. None block this PR.

Tenant-isolation, auth-baseline, and injection postures are solid. Race-condition surface is documented and accepted. No cross-tenant data-leakage risk.

Phase 2 follow-ups:
- W2: align google_drive validation across POST and PUT data-source routes.
- W6: stop stripping isSystemManaged, OR refactor client gating.
- L1: upgrade ETag concurrency to FOR UPDATE or monotonic revision column.
- W5: durable test-run execution + stuck-run cleanup job.
```
