# Pre-Launch Deferred Items — Dev Spec

**Status:** Draft 2026-05-01
**Branch:** `claude/deferred-items-pre-launch-5Kx9P`
**Class:** Significant (multi-domain, no architecture decisions — direct execution)
**Slug:** `deferred-items-pre-launch`
**Source:** Deferred items review + spot-check session 2026-05-01 against `main` at `eb39ac3e`

---

## Table of contents

- §0 — Framing & scope contract
- §1 — Verification log (already shipped — do not re-implement)
- §2 — Items to implement
  - §2.1 — E-D3: Implement `integrationBlockService.checkRequiredIntegration`
  - §2.2 — A-D1: Inject thread context into system prompt at run start + resume
  - §2.3 — Soft-delete gaps: 23 missing `isNull(deletedAt)` join filters
  - §2.4 — A-D3: Add `WITH CHECK` to `conv_thread_ctx_org_isolation` RLS policy
  - §2.5 — REQ C5: Add subaccount scope check on Drive `connectionId` attach paths
  - §2.6 — S4: Re-label `cheap_answer` stubs (`source: 'canonical'` → `'stub'`)
- §3 — Files to change
- §4 — Migration details
- §5 — Test matrix
- §6 — Typecheck / lint baseline contract
- §7 — Deferred (explicitly out of scope)
- §8 — Definition of done

---

## §0 — Framing & scope contract

### §0.1 Product framing

- `pre_production: yes` — no live agencies, no live users.
- `stage: rapid_evolution`. `breaking_changes_expected: yes`.
- `testing_posture: static_gates_primary`. `runtime_tests: pure_function_only`.
- No new integration tests. No Playwright. No supertest.
- `rollout_model: commit_and_revert`. No feature flags.
- `prefer_existing_primitives: yes`. No new services, no new layers.

### §0.2 What this spec does

Closes 6 deferred correctness gaps confirmed open on `main` at `eb39ac3e`. All items were surfaced in prior review sessions and have known fix points. No architecture decisions are required — each fix is fully specified in §2.

Items fall into three domains:

| Domain | Items | Priority |
|--------|-------|----------|
| Feature gaps — wired in UI but inert in production | §2.1, §2.2 | Highest |
| Data integrity — deleted records appearing in live queries | §2.3 | High |
| Security / correctness hardening | §2.4, §2.5, §2.6 | Medium |

### §0.3 Scope boundary

- **In:** Exactly the 6 items specified in §2.
- **Out:** Lint/typecheck error clearance (separate branch — `lint-typecheck-baseline`).
- **Out:** Any item not listed in §2, even if noticed while touching a file.
- **Out:** New features, new tables (other than the one corrective migration in §2.4).

### §0.4 Single spec or split?

All 6 items are in scope for one spec and one branch because:
- No item requires an architecture decision — all fixes are fully specified.
- File sets are non-overlapping within the spec.
- Total estimated effort is ~6–7 hours of focused implementation.
- A single PR is easier to review than three small PRs for related fixes.

The lint-typecheck-baseline remaining work (134 server errors, 283 lint errors) runs in a **separate branch** and must not be interleaved with this work. See §6 for the baseline contract.

---

## §1 — Verification log (already shipped — do not re-implement)

Spot-checked 2026-05-01 against `eb39ac3e`. Before implementing any item, verify the relevant file to confirm it is still open.

| Item | Status at spot-check |
|------|---------------------|
| REQ C1 — External doc blocks injected into system prompt | FIXED — `agentExecutionService.ts:811` |
| DR3 — BriefApprovalCard `onApprove`/`onReject` wired | FIXED |
| DR1 — `POST /api/rules/draft-candidates` route | FIXED — `server/routes/rules.ts:111` |
| REQ C4 — Picker-token/verify-access permission guard | FIXED — `requireOrgPermission(WORKSPACE_MANAGE)` on both routes |
| A-D2 — Concurrency guard version predicate in `applyPatch` | FIXED — `conversationThreadContextService.ts:239-244` |
| E-D5 — OAuth callback passes `conversationId` to resume service | FIXED |
| S2 — Skill .md files for `ask_clarifying_questions` / `challenge_assumptions` | FIXED |
| LAEL-P1-1 — `llm.requested` / `llm.completed` emission | FIXED — `llmRouter.ts:867-883`, `1375`, `1763`, `1847` |
| B-D1 — Cost rollup decision | RESOLVED — on-row columns chosen, `agent_messages` carries `costCents` etc. |
| E-D1 — `blocked_awaiting_integration` status enum | RESOLVED — kept; documented decision |

## §2.1 — E-D3: Implement `integrationBlockService.checkRequiredIntegration`

**Source:** spec-conformance log `agent-as-employee` 2026-04-30, E-D3.
**Severity:** Critical — `agentExecutionService` calls `checkRequiredIntegration` before tool dispatch; the stub always returns `{ shouldBlock: false }`. The entire OAuth-pause/resume flow (`InlineIntegrationCard`, token issuance, `agentResumeService`) is built but never fires in production.

### What to build

**Step 1 — Add `requiredIntegration?: string` to `ActionDefinition`** in `server/config/actionRegistry.ts`. This is the provider slug the handler reads to decide whether a live OAuth connection is needed. Type: string literal identifying the provider (e.g. `'google_drive'`, `'gmail'`, `'slack'`, `'notion'`, `'ghl'`). Optional — actions with no external dependency leave it unset.

**Step 2 — Tag known actions** that require an active external OAuth credential. Using the existing `server/config/actionRegistry.ts` entries, set `requiredIntegration` on actions that call:
- Google Drive / Docs → `'google_drive'`
- Gmail → `'gmail'`
- Slack → `'slack'`
- Notion → `'notion'`
- GHL OAuth endpoints → `'ghl'`

Do not tag actions that call first-party/internal APIs. When in doubt, leave the field unset (safe default).

**Step 3 — Implement the body of `checkRequiredIntegration`** in `server/services/integrationBlockService.ts`. The current stub (lines 67-75) has a TODO comment describing exactly this. Replace it:

```typescript
// Implementation outline — adapt to existing service patterns in this file
const action = actionRegistry.getAction(toolName);
if (!action?.requiredIntegration) return { shouldBlock: false };

const provider = action.requiredIntegration;

const conn = await integrationConnectionService.findActiveConnection({
  organisationId: orgId,
  subaccountId,
  providerType: provider,
});

if (conn) return { shouldBlock: false };

return { shouldBlock: true, provider, reason: `integration_required:${provider}` };
```

Use whichever `integrationConnectionService` method already queries `integration_connections` for an active connection by `(organisationId, subaccountId, providerType)` with `connectionStatus = 'active'` and `oauthStatus = 'active'`. If no such method exists, add a minimal one to the service — do not query `db` directly from `integrationBlockService`.

**Step 4 — Do NOT implement E-D4** (the `unsafe` strategy guard) — no `unsafe` actions exist yet. Leave the TODO comment in place.

### Acceptance criteria

- `checkRequiredIntegration` no longer returns `{ shouldBlock: false }` unconditionally.
- Tool with `requiredIntegration: 'gmail'`, no active Gmail connection → returns `{ shouldBlock: true, provider: 'gmail', reason: 'integration_required:gmail' }`.
- Same tool with active Gmail connection → returns `{ shouldBlock: false }`.
- Tool with no `requiredIntegration` → returns `{ shouldBlock: false }` with no DB query.
- Pure tests in `server/services/__tests__/integrationBlockServicePure.test.ts` cover all three cases (mock the connection lookup).

## §2.2 — A-D1: Inject thread context into system prompt at run start + resume

**Source:** spec-conformance log `tier-1-ui-uplift` 2026-04-30, A-D1.
**Severity:** High — `buildThreadContextReadModel` is exported from `conversationThreadContextService` and consumed by the `GET /thread-context` route, but `agentExecutionService.executeRun()` never calls it. The right-pane thread context panel renders correctly in the UI; the LLM running the agent receives nothing from it.

### What to build

**Step 1 — Add `formatThreadContextBlock` pure function** to `server/services/conversationThreadContextService.ts` (or a sibling `conversationThreadContextServicePure.ts`):

```typescript
export function formatThreadContextBlock(ctx: ThreadContextReadModel | null): string {
  if (!ctx) return '';
  const lines: string[] = [];
  if (ctx.tasks?.length) {
    lines.push('Tasks:');
    ctx.tasks.forEach((t) => lines.push(`  - ${t}`));
  }
  if (ctx.approach) lines.push(`Approach: ${ctx.approach}`);
  if (ctx.decisions?.length) {
    lines.push('Decisions:');
    ctx.decisions.forEach((d) => lines.push(`  - ${d}`));
  }
  if (!lines.length) return '';
  return `<thread_context>\n${lines.join('\n')}\n</thread_context>`;
}
```

Keep the formatted block under ~500 tokens for a typical context. If all fields are empty/null, return `''` and the caller skips injection entirely.

**Step 2 — Inject in `executeRun()`** in `server/services/agentExecutionService.ts`. After the existing `buildSystemPrompt(...)` call, add:

```typescript
if (runMetadata.conversationId) {
  const threadCtx = await buildThreadContextReadModel(
    runMetadata.conversationId,
    organisationId
  );
  const block = formatThreadContextBlock(threadCtx);
  if (block) {
    systemPrompt = block + '\n\n' + systemPrompt;
    runMetadata.threadContextVersionAtStart = threadCtx!.version;
  }
}
```

Import `buildThreadContextReadModel` and `formatThreadContextBlock` from `conversationThreadContextService`. If `conversationId` is absent (direct API run with no conversation), skip silently — no error.

**Step 3 — Re-inject on resume** in `server/services/agentResumeService.ts`. After `resumeFromIntegrationConnect` clears the blocked state and before re-executing the blocked tool call, apply the same injection — build model, format block, prepend if non-empty, and explicitly overwrite `runMetadata.threadContextVersionAtStart = threadCtx!.version`. The resume path must always reflect the latest context version, not the snapshot from the original run. The existing `runMetadata` object is already in scope in the resume service.

### Acceptance criteria

- `buildThreadContextReadModel` is called from `executeRun()` when `conversationId` is set.
- `runMetadata.threadContextVersionAtStart` is written when context is injected.
- Resume path re-injects context.
- If `conversationId` is null, injection is silently skipped — no exception thrown.
- Pure tests for `formatThreadContextBlock`: empty model → `''`; model with tasks → contains `<thread_context>`; model with approach/decisions → formatted correctly.

### Prompt injection ordering invariant

Thread context must be the first block prepended to the system prompt, before external doc blocks, memory blocks, or any other augmentation. This prevents nondeterministic prompt composition if other injection paths are added later. The `block + '\n\n' + systemPrompt` ordering in Step 2 defines the canonical position.

## §2.3 — Soft-delete gaps: 23 missing `isNull(deletedAt)` join filters

**Source:** pr-reviewer on branch `fix-logical-deletes` 2026-04-29 — Category A gaps not covered by that branch's spec.
**Severity:** High — deleted agents appear in org charts (`getTree`), routing decisions (`hierarchyRouteResolverService`), workspace health checks, delegation detectors, and job-level intervention queries. These produce phantom results that are invisible to operators but affect system behaviour.

### Fix pattern

There are three groups. **Do not add any new business logic** — these are mechanical filter additions only.

**Group A — `agents` join with no `deletedAt` filter at all (add it):**

| File | Approx. line | Function / context |
|------|-------------|-------------------|
| `server/services/subaccountAgentService.ts` | ~227 | `getLinkById` — innerJoin agents |
| `server/services/subaccountAgentService.ts` | ~390 | `getTree` — innerJoin agents |
| `server/services/hierarchyRouteResolverService.ts` | ~58 | innerJoin agents, runtime routing |
| `server/services/workspaceHealth/workspaceHealthService.ts` | ~266-267 | innerJoin agents + subaccounts |
| `server/services/workspaceHealth/workspaceHealthService.ts` | ~317 | innerJoin subaccounts |
| `server/services/workspaceHealth/detectors/explicitDelegationSkillsWithoutChildren.ts` | ~41 | innerJoin agents |

For each: add `isNull(agents.deletedAt)` (import from `drizzle-orm`) to the join `ON` condition using `and(existingCondition, isNull(agents.deletedAt))`.

**Group B — `agents` join, filter in WHERE only (move it to the join ON clause):**

| File | Approx. line(s) |
|------|----------------|
| `server/tools/internal/assignTask.ts` | ~55 |
| `server/services/agentExecutionService.ts` | ~3057 |
| `server/services/agentScheduleService.ts` | ~221 |
| `server/services/capabilityMapService.ts` | ~203 |
| `server/services/scheduleCalendarService.ts` | ~123 |
| `server/services/skillExecutor.ts` | ~3375, ~3589, ~3839 (3 sites) |

For each: move the existing `isNull(agents.deletedAt)` from the `.where(...)` clause into the join `ON` condition. Query semantics are identical for `innerJoin`; this is convention alignment with the rest of the codebase.

**Null-safety checklist (Group B only):** Before moving each site, verify no downstream code in the same function tests `if (!agent)` or `if (agent == null)` to handle filtered-out rows. `WHERE` filtering returns zero rows; moving to `ON` causes the join to return a row with null columns on the right side instead. This distinction matters only if code branches on the agent being absent.

**Group C — `systemAgents` join with no `deletedAt` filter (add it):**

| File | Approx. line | Function |
|------|-------------|---------|
| `server/services/subaccountAgentService.ts` | ~499 | leftJoin systemAgents |
| `server/jobs/proposeClientPulseInterventionsJob.ts` | ~309 | innerJoin systemAgents |
| `server/services/clientPulseInterventionContextService.ts` | ~366 | innerJoin systemAgents |
| `server/services/configUpdateOrganisationService.ts` | ~59 | innerJoin systemAgents |
| `server/services/workflowActionCallExecutor.ts` | ~74 | innerJoin systemAgents |
| `server/tools/config/configSkillHandlers.ts` | ~34 | innerJoin systemAgents |

For each: add `isNull(systemAgents.deletedAt)` to the join `ON` condition. The `systemAgents` alias or the actual table name (whatever is used in context) must match — read the file before editing.

**Left join semantics guard:** `subaccountAgentService.ts ~499` is a `leftJoin`. For all `leftJoin` sites, `isNull(deletedAt)` MUST be added to the ON clause only — never into WHERE. Adding it in WHERE converts the outer join to inner semantics: deleted-agent rows that should return null columns become invisible instead.

### Before you edit

Verify each line number by reading the file — numbers above are approximate from the spot-check. If the query has already been fixed (has an `isNull(*.deletedAt)` in the join ON), skip it without marking it as a problem.

### Acceptance criteria

- All Group A files: `isNull(agents.deletedAt)` in join ON condition.
- All Group B files: filter moved from WHERE to join ON.
- All Group C files: `isNull(systemAgents.deletedAt)` in join ON condition.
- `npm run typecheck:server` error count does not increase.
- No new pure tests required (mechanical fix, no new logic).

## §2.4 — A-D3: Add `WITH CHECK` to `conv_thread_ctx_org_isolation` RLS policy

**Source:** spec-conformance log `tier-1-ui-uplift` 2026-04-30, A-D3.
**Severity:** Medium — migration 0264 created `conversation_thread_context` with a `USING` clause (read isolation) but no `WITH CHECK` clause (write isolation). The canonical `architecture.md § Row-Level Security` template requires both. Without `WITH CHECK`, tenant code paths that write to this table are not blocked from inserting rows with a mismatched `organisation_id`.

### What to build

One corrective migration. Before writing it:
1. Run `ls migrations/ | sort -V | tail -5` to confirm the current highest migration number.
2. Use the next available number — do not assume a specific value.
3. Filename: `<number>_conv_thread_ctx_with_check.sql`

Migration body:
```sql
-- up
ALTER POLICY conv_thread_ctx_org_isolation ON conversation_thread_context
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);

-- down
ALTER POLICY conv_thread_ctx_org_isolation ON conversation_thread_context
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid);
```

If `ALTER POLICY ... WITH CHECK` is not supported on the PostgreSQL version in use, drop and re-create the policy:
```sql
-- up (drop-and-recreate form)
DROP POLICY IF EXISTS conv_thread_ctx_org_isolation ON conversation_thread_context;
CREATE POLICY conv_thread_ctx_org_isolation
  ON conversation_thread_context AS PERMISSIVE FOR ALL TO authenticated
  USING (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);
```

No Drizzle schema changes — this is policy-only.

### Acceptance criteria

- Migration file exists and follows the naming convention.
- Policy has a `WITH CHECK` clause matching the `USING` clause.
- `npm run db:generate` is **not** required (no schema table changes).

---

## §2.5 — REQ C5: Add subaccount scope check on Drive `connectionId` attach paths

**Source:** spec-conformance log `external-doc-references` 2026-04-30, REQ C5.
**Severity:** Medium — a user attaching a Google Drive reference to subaccount A's task/agent can supply a `connectionId` owned by subaccount B in the same org. The org check passes; the subaccount isolation is currently implicit (service layer convention) rather than explicit (route guard).

### What to build

Find all Drive attach routes that call `getOrgConnectionWithToken(connectionId, req.orgId!)`. Grep: `grep -rn "getOrgConnectionWithToken" server/routes/`.

After the connection is resolved, add:
```typescript
if (conn.subaccountId !== subaccountId) {
  return res.status(422).json({ error: 'invalid_connection_id' });
}
```

This guard goes after the existing `providerType` and `connectionStatus` checks, before any further processing. Apply it to every attach path — task external-reference, agent data-source, and scheduled-task data-source (if present).

Error shape: `422 { error: 'invalid_connection_id' }` — matches spec §17.6 vocabulary.

### Acceptance criteria

- Every Drive attach route that resolves a `connectionId` has the `conn.subaccountId === subaccountId` guard.
- Returns 422 `invalid_connection_id` when the connection belongs to a different subaccount.
- No new tests required (guard addition at route boundary).

---

## §2.6 — S4: Re-label `cheap_answer` stubs (`source: 'canonical'` → `'stub'`)

**Source:** pr-reviewer on `implement-universal-brief-qJzP8` 2026-04-22, S4.
**Severity:** Low — `briefSimpleReplyGeneratorPure.ts` emits `source: 'canonical'` for hardcoded placeholder rows (e.g. "See revenue data"). Users see artefacts with the same visual trust signal as real canonical data lookups.

### What to build

1. **Add `'stub'` to `BriefResultSource`** in `shared/types/briefResultContract.ts` (or wherever the union is defined). New union: add `'stub'` alongside whatever values already exist.

2. **Change stub emissions** in `server/services/briefSimpleReplyGeneratorPure.ts` — any row where the data is a hardcoded placeholder string, change `source: 'canonical'` → `source: 'stub'`.

3. **Handle `'stub'` in the client** — find wherever `BriefResultSource` drives visual rendering (badge label, colour, icon). If `'stub'` is not handled, add a fallback case that renders a neutral label (e.g. "Placeholder") rather than the canonical badge. A simple `default:` case or a `'stub'` explicit case is sufficient — do not design new UI. `'stub'` must never render with the same visual style as `'canonical'` — a visual distinction must exist even if minimal (different label or badge colour).

### Acceptance criteria

- `BriefResultSource` union includes `'stub'`.
- Stub placeholder rows from `briefSimpleReplyGeneratorPure` emit `source: 'stub'`.
- Client renders `source: 'stub'` without crashing (may fall through to a default label).
- Existing pure tests for `briefSimpleReplyGeneratorPure` (if any) still pass.

## §3 — Files to change

### New files

| File | Section |
|------|---------|
| `migrations/<N>_conv_thread_ctx_with_check.sql` | §2.4 — corrective RLS policy |
| `server/services/__tests__/integrationBlockServicePure.test.ts` | §2.1 — pure tests |

### Modified files

| File | Section | Change |
|------|---------|--------|
| `server/config/actionRegistry.ts` | §2.1 | Add `requiredIntegration?: string` to `ActionDefinition`; tag known OAuth actions |
| `server/services/integrationBlockService.ts` | §2.1 | Implement `checkRequiredIntegration` body |
| `server/services/agentExecutionService.ts` | §2.2, §2.3 | Thread context injection (§2.2); move agents deletedAt filter to join ON at line ~3057 (§2.3) |
| `server/services/agentResumeService.ts` | §2.2 | Re-inject thread context on resume |
| `server/services/conversationThreadContextService.ts` | §2.2 | Add `formatThreadContextBlock` pure function |
| `server/services/subaccountAgentService.ts` | §2.3 | 3 join sites (getLinkById ~227, getTree ~390, systemAgents leftJoin ~499) |
| `server/services/hierarchyRouteResolverService.ts` | §2.3 | 1 join site (~58) |
| `server/services/workspaceHealth/workspaceHealthService.ts` | §2.3 | 2 join sites (~266-267, ~317) |
| `server/services/workspaceHealth/detectors/explicitDelegationSkillsWithoutChildren.ts` | §2.3 | 1 join site (~41) |
| `server/tools/internal/assignTask.ts` | §2.3 | Move filter to join ON |
| `server/services/agentScheduleService.ts` | §2.3 | Move filter to join ON |
| `server/services/capabilityMapService.ts` | §2.3 | Move filter to join ON |
| `server/services/scheduleCalendarService.ts` | §2.3 | Move filter to join ON |
| `server/services/skillExecutor.ts` | §2.3 | Move filter to join ON (3 sites) |
| `server/jobs/proposeClientPulseInterventionsJob.ts` | §2.3 | Add systemAgents deletedAt filter |
| `server/services/clientPulseInterventionContextService.ts` | §2.3 | Add systemAgents deletedAt filter |
| `server/services/configUpdateOrganisationService.ts` | §2.3 | Add systemAgents deletedAt filter |
| `server/services/workflowActionCallExecutor.ts` | §2.3 | Add systemAgents deletedAt filter |
| `server/tools/config/configSkillHandlers.ts` | §2.3 | Add systemAgents deletedAt filter |
| `server/routes/googleDrive.ts` (verify actual filename) | §2.5 | Add `conn.subaccountId === subaccountId` guard on all attach paths |
| `shared/types/briefResultContract.ts` | §2.6 | Add `'stub'` to `BriefResultSource` union |
| `server/services/briefSimpleReplyGeneratorPure.ts` | §2.6 | Change placeholder `source` to `'stub'` |
| Client source-rendering component (find by grep) | §2.6 | Handle `'stub'` without crash |

**Total: 2 new files, ~23 modified files.**

---

## §4 — Migration details

Only one migration is required (§2.4). No other item in this spec requires a schema change.

Pre-flight:
```bash
ls migrations/ | sort -V | tail -5   # confirm current highest number
```

Use the next available number. Do **not** run `npm run db:generate` — this migration modifies a policy only, not a Drizzle-tracked table schema. Verify it applies on a local DB by checking `\d+ conversation_thread_context` in psql shows the updated policy.

---

## §5 — Test matrix

| Section | Test type | File | Cases |
|---------|-----------|------|-------|
| §2.1 | Pure unit | `server/services/__tests__/integrationBlockServicePure.test.ts` | (a) tool with `requiredIntegration`, no connection → `shouldBlock: true`; (b) same tool, active connection → `shouldBlock: false`; (c) no `requiredIntegration` → `shouldBlock: false`, no DB query |
| §2.2 | Pure unit | Extend or create `conversationThreadContextServicePure.test.ts` | `formatThreadContextBlock(null)` → `''`; full model → contains `<thread_context>` and all non-empty fields; partial model → only present fields rendered |
| §2.3 | None | — | Mechanical filter; no new logic |
| §2.4 | None | — | Correctness verified by DB introspection |
| §2.5 | None | — | Guard addition; no new logic |
| §2.6 | Regression | Existing `briefSimpleReplyGeneratorPure.test.ts` | Confirm existing tests still pass after source re-label |

**Execution:** `npx tsx <path-to-test>` per file. Never run the full test suite locally (CI-only per CLAUDE.md).

## §6 — Typecheck / lint baseline contract

**Known state on `main` at `eb39ac3e`:** `npm run typecheck:server` reports ~134 errors after `npm install` (418 without it, because vitest types are missing from node_modules). `npm run lint` reports 283 errors. These are pre-existing baseline errors from the `lint-typecheck-baseline` branch (scaffolding merged PR #246; error clearance is its remaining-work.md).

**Contract for this branch:**

1. Before starting: run `npm install`, then capture baseline counts:
   ```bash
   npm run typecheck:server 2>&1 | grep "error TS" | wc -l   # baseline typecheck
   npm run lint 2>&1 | grep " error " | wc -l                 # baseline lint errors
   ```
2. After completing all items: re-run both commands and confirm neither count has increased.
3. Do **not** fix pre-existing baseline errors — that is `lint-typecheck-baseline`'s job.
4. Do **not** suppress new errors with `// @ts-ignore`, `as any`, or ESLint disable comments to hide them. If a new error appears, fix it.
5. Do **not** skip `npm install` — without it the typecheck baseline is inflated by ~284 false vitest errors.

---

## §7 — Deferred (explicitly out of scope)

Do not implement these in this branch. They were evaluated and excluded.

| Item | Reason |
|------|--------|
| E-D4 — `tool_not_resumable` guard for `unsafe` strategies | No `unsafe` actions exist; guard is theoretical today |
| E-D6 — Persist `dismissed` state via PATCH endpoint | v2 scope; session-only dismissal is acceptable pre-launch |
| D-D1 — Email tile inline config in InvocationsCard | Needs product decision on whether per-agent email config exists |
| LAEL-P1-2 — `memory.retrieved`, `rule.evaluated`, `skill.invoked` emission | Separate LAEL spec scope |
| Lint/typecheck error clearance | Separate branch (`lint-typecheck-baseline`) |
| B10 — Maintenance-job `withOrgTx` defense-in-depth | Correctness unaffected; jobs run successfully today |
| P3-H1 — Server circular dependency (43 cycles) | Separate refactor; no runtime impact |
| TI-006/007/008 — Integration test harness improvements | CI infrastructure work; separate from feature correctness |

---

## §8 — Definition of done

All of the following must be true before opening a PR:

- [ ] §2.1 — `checkRequiredIntegration` implements full lookup; pure tests (3 cases) pass via `npx tsx`.
- [ ] §2.2 — `buildThreadContextReadModel` called from `executeRun()` and resume path; `threadContextVersionAtStart` written; `formatThreadContextBlock` pure tests pass.
- [ ] §2.3 — All 23 soft-delete sites addressed (6 Group A added, 9 Group B moved to join ON, 6 Group C added) with no Group A/C gaps remaining.
- [ ] §2.4 — Corrective migration exists; policy has `WITH CHECK`; migration number is correct (verified by checking `ls migrations/` pre-write).
- [ ] §2.5 — All Drive attach routes have `conn.subaccountId === subaccountId` guard; returns 422 on mismatch.
- [ ] §2.6 — `BriefResultSource` includes `'stub'`; stub artefacts emit it; client handles it without crash; existing pure tests still pass.
- [ ] Typecheck count has not increased from pre-work baseline (verified by running the command from §6).
- [ ] Lint error count has not increased from pre-work baseline.
- [ ] `tasks/current-focus.md` updated to reflect this branch as active.
- [ ] `spec-conformance` run against this spec before opening PR.
- [ ] `pr-reviewer` run on the final diff before opening PR.
