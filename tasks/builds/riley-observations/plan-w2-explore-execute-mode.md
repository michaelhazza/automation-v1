# Wave 2 — Explore Mode / Execute Mode (Part 3)

_Plan slug: `riley-observations` — W2 chunk: `explore-execute-mode`_
_Source spec: `docs/riley-observations-dev-spec.md` §6 (lines 944–1242), §10.1–§10.5, §11.2, §12.3_
_Mockups: `prototypes/riley-observations/02-agent-chat-explore-mode.html`, `03-workflow-run-modal-step2.html`, `04-promote-to-execute-prompt.html`, `10-agent-config-page.html`_
_Depends on: W1 having landed (Part 1 rename + Part 2 composition)._

---

## Contents

1. Orientation
2. Architect decisions
3. Schema changes — migration 0205
4. File inventory — Edit vs Write
5. Mockup citations per UI file
6. 152-skill `side_effects` audit — separable deliverable
7. Test strategy
8. Reviewer checklist

---

## 1. Orientation

Wave 2 introduces **Explore Mode / Execute Mode** — a new per-run *safety* dimension on top of the pre-existing `run_mode` *execution-style* dimension (`auto | supervised | background | bulk`, from migration `0086`). The two dimensions are deliberately split: `safety_mode` answers "does every side-effecting action pause for review?", `run_mode` answers "how is the run driven (interactive / queued / parent of many)?" — Part 3 leaves `run_mode` untouched on the existing `workflow_runs` column and adds a brand-new `safety_mode` column alongside it.

This plan **depends on W1 having landed** — every reference below uses post-rename names: `workflow_runs` (was `playbook_runs`), `workflow_templates` / `workflow_template_versions` (was `playbook_templates*`), `agents` (unchanged), `automations` (was `processes`), `automation_engines` (was `workflow_engines`), `WorkflowRunModal` (was `PlaybookRunModal`), `workflowEngineService` (was `playbookEngineService`), etc. If W1 is not yet merged when this plan runs, stop and block — mechanical rebase on top of W1 is the prerequisite.

The work decomposes into three independently verifiable phases, all landing in one PR:

- **Phase A — schema + manifest.** Migration `0205_explore_execute_mode.sql` (forward + down), Drizzle schema edits on five tables + one new table, RLS manifest entry, permission seed for `ORG_PERMISSIONS.AGENT_RUN_MODE_MANAGE`. No service or route changes in this phase; `tsc` clean after A.
- **Phase B — gate + resolver services.** Extract `resolveEffectiveGate` into `server/services/gateResolutionServicePure.ts`; add `server/services/resolveSafetyModeServicePure.ts`; wire both into `agentExecutionService.ts` and (post-rename) `workflowEngineService.ts`; add user-preference service CRUD + promote-prompt counter updates; delete the old `runMode: 'supervised'` branch from the run-creation path (see §6.8 supervised-removal audit below). Unit tests (pure-function) land with this phase.
- **Phase C — UI surfaces.** Mockup 10 → surgical edits in `AdminAgentEditPage.tsx` "Schedule & Concurrency" section (cited line range L1410–1531) and `SubaccountAgentEditPage.tsx` (safety mode only); mockup 03 → `WorkflowRunModal.tsx` radio-pair replacement of the supervised checkbox; mockup 02 → `AgentChatPage.tsx` header mode chip + inline approval card + confirm-dialog toggle; mockup 04 → new `PromoteToExecuteModal.tsx` component; existing run-log viewer gets a mode-transition row.

Architectural constraints reinforced against §6 of the spec: routes remain thin (call services only); service errors throw `{ statusCode, message, errorCode? }`; every route uses `asyncHandler`; schema changes go through a single Drizzle migration file with a paired down-file; new tenant-scoped table ships with RLS in the same migration plus a manifest entry; three-tier agent model respected (`agents.default_safety_mode` at the Org tier; `subaccount_agents.portal_default_safety_mode` at the Subaccount tier; System tier is untouched in v1).

---

## 2. Architect decisions

One row per open-question item that this plan closes before coding starts. Architect's default recommendations are **confirmed** unless explicitly overridden.

| # | Open question (spec §) | Outcome | Column / mechanism pinned | Rationale (≤ 1 sentence) |
|---|---|---|---|---|
| 1 | Portal `safety_mode` field (§6.8 / §12.13) | **Confirmed — add column.** | `subaccount_agents.portal_default_safety_mode text NOT NULL DEFAULT 'explore' CHECK (portal_default_safety_mode IN ('explore','execute'))` in migration `0205`. Read at dispatch-time for portal-initiated runs; customer-facing paths cannot switch modes. | No existing `subaccount_agents` column carries portal-specific safety posture; reusing `agents.default_safety_mode` would couple admin default to customer default, which §6.8 explicitly rejects. |
| 2 | `system_skills.side_effects` runtime storage (§6.4 / §12.22) | **Confirmed — top-level column.** | `system_skills.side_effects boolean NOT NULL DEFAULT true` in migration `0205`. Backfilled from the audit log at `tasks/builds/riley-observations/skills-side-effects-audit.md` (see §6 below); markdown frontmatter is the authoring source, column is the runtime surface. | Gate resolution fires on every side-effecting dispatch; a top-level boolean beats JSONB unpacking on the hot path. Default `true` is safe-by-construction per §6.4. |
| 3 | Supervised-mode removal call-site audit (§6.8 / §12.14) | **Audit, not a decision.** | Every `runMode: 'supervised' \| 'auto'` site is enumerated in §4 (not a separate deliverable). Builder migrates each: UI drops `supervised`; route validators drop `'supervised'` from the accepted set; `workflow_runs.run_mode` enum retains `supervised` for backward compat on any in-flight row, but no new write sets it (pre-launch posture — zero live rows in practice). | §6.8 is already a locked decision; remaining work is mechanical migration captured in the file inventory. |
| 4 | `safety_mode` vs pre-existing `run_mode` reconciliation (§6.3 / §12.24 / §12.25) | **Confirmed — keep the split.** | Add new column `workflow_runs.safety_mode` alongside the renamed legacy `workflow_runs.run_mode` (post-W1). `run_mode` retains its `auto\|supervised\|background\|bulk` enum for execution-style semantics; `safety_mode` holds `explore\|execute` for the safety dimension. Naming discipline enforced in §3's DDL and in every new TypeScript field (`safetyMode` in code, `safety_mode` in SQL). | Overloading the existing enum would force a lossy 4→2 value migration, breaking `background` / `bulk` semantics that Part 3 does not replace. The two dimensions are independent. |

The four outcomes above are the inputs to §3 and §4 below — every schema DDL and file-inventory row is justified against one of these decisions.

---

## 3. Schema changes — migration 0205

One migration, one down-migration, six schema edits + one new table. All DDL lands in:

- **Forward:** `migrations/0205_explore_execute_mode.sql`
- **Down:** `migrations/_down/0205_explore_execute_mode.sql`

### 3.1 Forward DDL (authoritative)

```sql
-- 0205_explore_execute_mode.sql
-- Part 3 of the Riley Observations spec (§6).
--
-- Naming discipline: every new column/field uses `safety_mode` (SQL) /
-- `safetyMode` (TypeScript). NEVER `run_mode` / `runMode` — which remains
-- the legacy execution-style enum introduced in migration 0086 and renamed
-- onto workflow_runs by W1 migration 0202.

-- ── Agent default safety mode (Org tier) ────────────────────────────────
ALTER TABLE agents
  ADD COLUMN default_safety_mode text NOT NULL DEFAULT 'explore'
  CHECK (default_safety_mode IN ('explore', 'execute'));

-- ── Workflow run safety mode (per-run; separate from legacy run_mode) ───
ALTER TABLE workflow_runs
  ADD COLUMN safety_mode text NOT NULL DEFAULT 'explore'
  CHECK (safety_mode IN ('explore', 'execute'));

-- ── Agent run safety mode (per-run) ─────────────────────────────────────
ALTER TABLE agent_runs
  ADD COLUMN safety_mode text NOT NULL DEFAULT 'explore'
  CHECK (safety_mode IN ('explore', 'execute'));

-- ── Subaccount agent portal default (Subaccount tier — decision 1) ──────
ALTER TABLE subaccount_agents
  ADD COLUMN portal_default_safety_mode text NOT NULL DEFAULT 'explore'
  CHECK (portal_default_safety_mode IN ('explore', 'execute'));

-- ── System skill side_effects classification (decision 2) ───────────────
ALTER TABLE system_skills
  ADD COLUMN side_effects boolean NOT NULL DEFAULT true;

-- One-shot backfill from the audit log. The audit is a sibling deliverable
-- (tasks/builds/riley-observations/skills-side-effects-audit.md §6 below)
-- and produces a CSV of (slug, side_effects boolean) pairs. The migration
-- applies them via a WITH-literal UPDATE — kept tiny so the migration stays
-- reviewable:
--
--   WITH audit(slug, side_effects) AS (VALUES
--     ('list_deals',  false),
--     ('get_campaign_stats', false),
--     -- …one row per skill classified 'false' in the audit…
--   )
--   UPDATE system_skills s
--      SET side_effects = a.side_effects
--     FROM audit a
--    WHERE s.slug = a.slug;
--
-- Every skill not in the audit stays `side_effects = true` (unknown-safe
-- default per §6.4). The VALUES list is generated from the audit markdown
-- at migration-authoring time; builder commits the populated UPDATE inline
-- in this file.

-- ── User safety-mode preferences (§6.3 / §6.9) ──────────────────────────
CREATE TABLE user_agent_safety_mode_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  subaccount_id uuid NULL REFERENCES subaccounts(id) ON DELETE CASCADE,
  last_successful_mode text NOT NULL CHECK (last_successful_mode IN ('explore', 'execute')),
  successful_explore_runs integer NOT NULL DEFAULT 0,
  promoted_to_execute_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX user_agent_safety_mode_preferences_scoped_uniq_idx
  ON user_agent_safety_mode_preferences (user_id, agent_id, subaccount_id)
  WHERE subaccount_id IS NOT NULL;

CREATE UNIQUE INDEX user_agent_safety_mode_preferences_unscoped_uniq_idx
  ON user_agent_safety_mode_preferences (user_id, agent_id)
  WHERE subaccount_id IS NULL;

CREATE INDEX user_agent_safety_mode_preferences_user_agent_idx
  ON user_agent_safety_mode_preferences (user_id, agent_id);

-- ── RLS policy + enable (per spec §6.3a; three-layer model per
--    architecture.md §1155) ───────────────────────────────────────────────
ALTER TABLE user_agent_safety_mode_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_agent_safety_mode_preferences_tenant_isolation
  ON user_agent_safety_mode_preferences
  USING (organisation_id = current_setting('app.current_organisation_id')::uuid);
```

### 3.2 Down DDL (authoritative)

```sql
-- _down/0205_explore_execute_mode.sql

DROP POLICY IF EXISTS user_agent_safety_mode_preferences_tenant_isolation
  ON user_agent_safety_mode_preferences;

DROP INDEX IF EXISTS user_agent_safety_mode_preferences_user_agent_idx;
DROP INDEX IF EXISTS user_agent_safety_mode_preferences_unscoped_uniq_idx;
DROP INDEX IF EXISTS user_agent_safety_mode_preferences_scoped_uniq_idx;
DROP TABLE IF EXISTS user_agent_safety_mode_preferences;

ALTER TABLE system_skills      DROP COLUMN IF EXISTS side_effects;
ALTER TABLE subaccount_agents  DROP COLUMN IF EXISTS portal_default_safety_mode;
ALTER TABLE agent_runs         DROP COLUMN IF EXISTS safety_mode;
ALTER TABLE workflow_runs      DROP COLUMN IF EXISTS safety_mode;
ALTER TABLE agents             DROP COLUMN IF EXISTS default_safety_mode;
```

### 3.3 Manifest + permission updates

- **`server/config/rlsProtectedTables.ts`** — append one entry:

  ```ts
  {
    tableName: 'user_agent_safety_mode_preferences',
    schemaFile: 'userAgentSafetyModePreferences.ts',
    policyMigration: '0205_explore_execute_mode.sql',
    rationale:
      'Per-user safety-mode preferences — PII via user identity plus per-agent usage history.',
  }
  ```

- **`server/lib/permissions.ts`** — add a new org-level permission key:

  ```ts
  // ── Part 3: Explore/Execute mode preferences ──
  AGENT_RUN_MODE_MANAGE: 'org.agent_run_mode.manage',
  ```

  The key gates the mutation routes on `user_agent_safety_mode_preferences` (per-user preference write; reset-to-default). Read paths reuse the existing `AGENTS_CHAT` / `AGENTS_VIEW` guards — a user can always read their own preferences.

- **Permission seed migration:** if the permission-set seed lives in a SQL or TS seeder that runs idempotently on boot, the new key is added to the seed source in the same PR. Architect confirms location during the Part 1 work (§12.1 item 2); Part 3 piggybacks on whatever pattern W1 established.

### 3.4 Invariants captured by the schema

- **Every run has exactly one safety mode.** Enforced by `NOT NULL DEFAULT 'explore'` + CHECK on both `agent_runs.safety_mode` and `workflow_runs.safety_mode`. No nullable state, no tri-state; a run is either Explore or Execute.
- **Safe-by-default at every creation path.** Agent default, run default, user-preference default, portal default, skill-`side_effects` default all favour safety (`explore` / `true`).
- **One preference row per (user, agent, subaccount) scope.** Two partial unique indexes cover the nullable-subaccount case (the spec's §6.3 design — Postgres cannot include NULL in a PK column, so uniqueness is enforced via partial indexes).
- **Tenant isolation holds without application-layer filtering.** RLS policy + manifest entry + CI gate `verify-rls-coverage.sh` enforce it.

### 3.5 Reversibility

- Forward applies green on clean dev DB (§10.3 step 1).
- Down applies green after forward; `drizzle-kit introspect` diff is clean (§10.3 step 3).
- No data migration needed on any of these (pre-launch posture; zero live rows in affected tables beyond seed data).

---

## 4. File inventory — Edit vs Write

All paths absolute from the repo root. "Post-W1" suffix means the file was renamed by W1 — the plan reaches it under its W1 name (e.g. `server/db/schema/workflowRuns.ts`, not `playbookRuns.ts`).

### 4.1 Migration files

| Path | Action | Notes |
|---|---|---|
| `migrations/0205_explore_execute_mode.sql` | **Write** | Forward DDL per §3.1. Contains the audit-backfill UPDATE inline (generated from §6 audit). |
| `migrations/_down/0205_explore_execute_mode.sql` | **Write** | Down DDL per §3.2. |

### 4.2 Drizzle schema files

| Path (post-W1) | Action | Change |
|---|---|---|
| `server/db/schema/agents.ts` | **Edit** | Add `defaultSafetyMode: text('default_safety_mode').notNull().default('explore').$type<'explore' \| 'execute'>()`. |
| `server/db/schema/agentRuns.ts` | **Edit** | Add `safetyMode: text('safety_mode').notNull().default('explore').$type<'explore' \| 'execute'>()`. |
| `server/db/schema/workflowRuns.ts` (post-W1 rename of `playbookRuns.ts`) | **Edit** | Add `safetyMode: text('safety_mode').notNull().default('explore').$type<'explore' \| 'execute'>()`. Legacy `runMode` column retained unchanged. |
| `server/db/schema/subaccountAgents.ts` | **Edit** | Add `portalDefaultSafetyMode: text('portal_default_safety_mode').notNull().default('explore').$type<'explore' \| 'execute'>()`. |
| `server/db/schema/systemSkills.ts` | **Edit** | Add `sideEffects: boolean('side_effects').notNull().default(true)`. Export a `SideEffects` type alias for reuse. |
| `server/db/schema/userAgentSafetyModePreferences.ts` | **Write** | New table definition matching §3.1 DDL; two partial unique indexes + one compound index; exports `UserAgentSafetyModePreference`, `NewUserAgentSafetyModePreference` types. |
| `server/db/schema/index.ts` | **Edit** | One-line add: `export * from './userAgentSafetyModePreferences';` alphabetically in the existing list. |

### 4.3 Config / manifest files

| Path | Action | Change |
|---|---|---|
| `server/config/rlsProtectedTables.ts` | **Edit** | Append manifest entry per §3.3. |
| `server/lib/permissions.ts` | **Edit** | Add `AGENT_RUN_MODE_MANAGE` key to `ORG_PERMISSIONS` object. |
| Permission seed source (location confirmed by W1; likely a TS seed file or SQL seed migration) | **Edit** | Include `AGENT_RUN_MODE_MANAGE` in the default admin permission set. |

### 4.4 Pure-function services (Phase B core)

| Path | Action | Purpose |
|---|---|---|
| `server/services/gateResolutionServicePure.ts` | **Write** | Extract per §6.5: exports `resolveEffectiveGate(subject, context)` where `subject` is `{kind:'skill', skill}` or `{kind:'invoke_automation', step}`; returns `'auto' \| 'review' \| 'block'`. Block-always-wins for skills; Explore forces review on side-effecting subjects; fall-through to existing per-agent / per-subaccount / per-run overrides. Pure; no DB. |
| `server/services/gateResolutionService.ts` | **Write** | Thin wet wrapper — loads `Skill` / overrides from the DB, forwards to the pure fn. Used by agent-execution and workflow-engine paths. |
| `server/services/resolveSafetyModeServicePure.ts` | **Write** | Exports `resolveSafetyMode(request, agent, userPref)` per §6.6. Pure; ordered rule set (parent inheritance → explicit override → top-level scheduled=execute → user pref → agent default). |
| `server/services/userAgentSafetyModePreferencesService.ts` | **Write** | CRUD for the new table. `getPreference(userId, agentId, subaccountId)`, `upsertOnSuccessfulRun(runContext)` (increments `successful_explore_runs` on Explore success; flips `last_successful_mode = 'execute'` and sets `promoted_to_execute_at` on Execute success; no-op on failure), `resetCounterOnReversePromotion(userId, agentId, subaccountId)`. Scoped by `req.orgId`; uses `getOrgScopedDb` for principal-scoped RLS. |

### 4.5 Existing services — edited

| Path (post-W1) | Action | Change |
|---|---|---|
| `server/services/agentExecutionService.ts` | **Edit** | Replace inline gate-resolution branch with call to `gateResolutionService.resolveEffectiveGate`. Read `agent_runs.safety_mode` from the run row and pass into the `RunContext`. Emit `run.safety_mode.selected` at run-creation (§6.11). Hook the preference-update service into the terminal-write path for `status='completed'` runs. |
| `server/services/workflowEngineService.ts` (post-W1 rename of `playbookEngineService.ts`) | **Edit** | Before every side-effecting step dispatch (including every `invoke_automation` step from W1 Part 2), call `gateResolutionService.resolveEffectiveGate({ kind: 'invoke_automation' \| 'skill', … }, context)` where `context.safetyMode = run.safety_mode`. Thread `safety_mode` through to child `agent_runs` created by `agent_call` steps (per §6.7 edge 7 — delegation inherits). |
| `server/services/workflowRunService.ts` (post-W1 rename of `playbookRunService.ts`) | **Edit** | `startRun` accepts `safetyMode?: 'explore' \| 'execute'` and `parentRun?: {safetyMode}` in the input shape; resolves final mode via `resolveSafetyModeServicePure`; writes to the new column on `workflow_runs`. Drop `'supervised'` from the accepted `runMode` values (migration path, decision 3). |
| `server/services/agentRunService.ts` / agent-run creation callsite | **Edit** | `createRun` accepts `safetyMode?: 'explore' \| 'execute'`; resolves via `resolveSafetyMode`; writes to `agent_runs.safety_mode`. Delegation-spawned sub-runs pass `parentRun.safetyMode` through. |
| `server/services/scheduleDispatchService.ts` (or whatever job hands a scheduled agent-run to the executor — confirm location during implementation; likely `agentScheduleService.ts`) | **Edit** | On scheduled dispatch, resolve `safetyMode` via `resolveSafetyMode` with `triggerType='scheduled'` and `parentRun=null` — yields `'execute'` per §6.6 rule 3. Scheduled flows never prompt the user. |
| `server/services/systemSkillService.ts` | **Edit** | `createSystemSkill` / `updateSystemSkill` validate and persist `sideEffects` as a top-level column (not inside `definition`). Seeder reads frontmatter from `server/skills/*.md` and writes both `definition` and `side_effects` to the DB row. |

### 4.6 Routes

| Path (post-W1) | Action | Change |
|---|---|---|
| `server/routes/workflowRuns.ts` (post-W1 rename of `playbookRuns.ts`) | **Edit** | `POST /api/subaccounts/:subaccountId/workflow-runs` accepts `safetyMode?: 'explore' \| 'execute'` in the body. Drop `'supervised'` from the `runMode` validator. `resolveSubaccount(subaccountId, req.orgId)` remains; permission guard unchanged. |
| `server/routes/agentChat.ts` (or equivalent chat-send endpoint; confirm location at implementation time) | **Edit** | Mode-switch endpoint: `POST /api/agent-runs/:runId/safety-mode` with body `{safetyMode: 'explore' \| 'execute'}`. Guarded by `AGENT_RUN_MODE_MANAGE`; service emits a run-log entry per §3a.2 lock 5. |
| `server/routes/userAgentSafetyModePreferences.ts` | **Write** | `GET /api/agents/:agentId/safety-mode-preference?subaccountId=…`, `PUT /api/agents/:agentId/safety-mode-preference` (body: `{safetyMode, subaccountId?}`), `DELETE` to reset. All guarded by `authenticate` + `requireOrganisation` + `AGENT_RUN_MODE_MANAGE`. Uses `resolveSubaccount` when `subaccountId` is present. |
| `server/index.ts` | **Edit** | Register the new preferences route (pattern confirmed by W1 Part 1; §12.1 item 3). |

### 4.7 Server-side unit tests (pure-function only, per spec §11.2 and framing `testing_posture: static_gates_primary`)

| Path | Action | Coverage |
|---|---|---|
| `server/services/gateResolutionServicePure.test.ts` | **Write** | Matrix over `context.safetyMode × subject.kind × skill.sideEffects × skill.defaultGateLevel` (§6.5 / §6.7). Asserts block-always-wins; Explore forces review on `invoke_automation` AND on side-effecting skills; fall-through path preserved. |
| `server/services/resolveSafetyModeServicePure.test.ts` | **Write** | Matrix over `parentRun × request.safetyMode × triggerType × userPref × agent.defaultSafetyMode` (§6.6). Asserts delegation inheritance wins; explicit override second; scheduled top-level forces execute; user pref fourth; agent default last. |

### 4.8 UI files

| Path | Action | Mockup | Change |
|---|---|---|---|
| `client/src/pages/AdminAgentEditPage.tsx` | **Edit** | 10 | Add two-option segmented control (Explore / Execute) for `default_safety_mode` inside the existing "Schedule & Concurrency" `SectionCard` (heading at **L1412**, section spans **L1410–L1560**). New field slots directly after the heartbeat block (after the divider at L1495) and before the concurrency controls; help text per §6.8. Form-state adds `defaultSafetyMode: 'explore' \| 'execute'`; save-payload adds the field. No new `SectionCard`, no new tab. |
| `client/src/pages/SubaccountAgentEditPage.tsx` | **Edit** | 10 | Same segmented control for `default_safety_mode`, inside the existing "Scheduling" tab. Safety mode **only** — not the heartbeat gate. |
| `client/src/pages/OrgAgentConfigsPage.tsx` | **no change** | — | Spec §6.8 explicitly keeps this read-only in v1. |
| `client/src/components/PlaybookRunModal.tsx` → post-W1 `WorkflowRunModal.tsx` | **Edit** | 03 | Replace the `supervised` checkbox (existing L336–L350) with a two-radio mode picker (Explore default / Execute) inside the existing `step === 'run'` stage. Post body sends `safetyMode`, not `runMode: 'supervised' \| 'auto'`. Button label changes to "Start run" in both cases (removes "Start (supervised)"). No multi-step wizard change; mode-picker is one question inside the existing Run step. |
| `client/src/pages/AgentChatPage.tsx` (the existing agent chat page — name finalised in spec §6.8; confirm exact file at implementation time — grep for `AgentChatPage` in `client/src/pages/`) | **Edit** | 02 | (a) Header mode chip: single pill rendering current mode with lock icon for Explore / play icon for Execute; click opens a small confirm dialog, on confirm calls the new `POST /api/agent-runs/:runId/safety-mode` endpoint. (b) Inline approval card in the message stream when a side-effecting action hits the review gate during an Explore run: buttons *Approve* / *Skip*. On approve, existing review-item resolution fires; on skip, the step records as skipped and the run continues. (c) No inline system-message bubble for mode changes (§3a.2 lock 5). |
| `client/src/components/PromoteToExecuteModal.tsx` | **Write** | 04 | One-sentence prompt + two buttons (*Not yet* / *Switch to Execute*) per §6.10. Surfaces after 5 successful Explore runs for the (user, agent, subaccount). No trust-receipts list; no "Execute" typed confirm. "Not yet" calls a suppression endpoint that clears the counter floor by 5. |
| Run-log viewer component (find via grep: `RunEventsList`, `RunTimeline`, or the existing run-detail page that renders `agent_execution_events`; confirmed at implementation time) | **Edit** | — | Render a one-row entry for mode-transition events emitted by `POST /api/agent-runs/:runId/safety-mode`. Existing run-log UI; one new event type. |

### 4.9 Supervised-mode call-site audit (decision 3)

Every `'supervised'` / `runMode: 'supervised' \| 'auto'` / `supervised` state-variable reference that this plan migrates or deprecates. Builder must handle each site — none silently dropped. Grep command run at authoring time: `grep -rn "supervised" server/ client/ shared/ --include="*.ts" --include="*.tsx"`.

| Path | Line(s) | Current shape | Migration action |
|---|---|---|---|
| `client/src/components/PlaybookRunModal.tsx` (→ `WorkflowRunModal.tsx` post-W1) | L99 (`useState`), L180 (`runMode: supervised ? 'supervised' : 'auto'`), L336–L350 (checkbox JSX), L378 (`supervised ? 'Start (supervised)' : 'Start run'`) | `supervised` useState boolean drives a `runMode` value in the run-creation POST body. | Delete `supervised` useState; delete the checkbox JSX block (see §4.8 row); replace with a `safetyMode` useState defaulting to `'explore'` and a two-radio block; change POST body from `runMode` to `safetyMode`; Start-button label simplifies to "Start run". |
| `server/services/playbookRunService.ts` (→ `workflowRunService.ts` post-W1) | `startRun` input shape — `runMode?: 'auto' \| 'supervised' \| 'background' \| 'bulk'`; forwarded to engine `context.runMode`. Engine compares `if (context.runMode === 'supervised')` before dispatching side-effecting steps. | The service's `runMode` field accepts `'supervised'` and uses it to force per-step review. | Drop `'supervised'` from the accepted `runMode` union (type + runtime validator). Force-review semantics move entirely onto `safety_mode = 'explore'` — `resolveEffectiveGate` now handles every case that used to branch on `runMode === 'supervised'`. The `runMode` enum in schema keeps `supervised` for backward-compat on any in-flight row (pre-launch posture — zero rows in practice) but no new write sets it. |
| `server/services/playbookEngineService.ts` (→ `workflowEngineService.ts` post-W1) | every `context.runMode === 'supervised'` conditional (locate via grep at implementation) | Forces a pause before each side-effecting step when true. | Delete the `runMode === 'supervised'` branch. Side-effecting steps now always call `resolveEffectiveGate` which encapsulates the same behaviour under Explore semantics. |
| `server/routes/playbookRuns.ts` (→ `workflowRuns.ts` post-W1) | L55 (validator: `const validModes = ['auto', 'supervised', 'background', 'bulk']`), L73 (cast to union type) | Route accepts `runMode: 'supervised'` and forwards. | Drop `'supervised'` from the validator and the cast-type. Accept `safetyMode` field on the body; forward to service. |
| `server/db/schema/playbookRuns.ts` (→ `workflowRuns.ts` post-W1) | L24 (`PlaybookRunMode` type), L59 (`runMode` column default + type) | Type union includes `'supervised'`; column enum includes it at DB level. | **Leave schema column + type unchanged** — pre-launch posture means zero migration risk, and keeping the schema enum stable avoids a four-way enum migration inside Part 3. Service/route layer stops accepting the value on new writes; no schema change to `run_mode` in this PR. |
| `server/lib/playbook/types.ts` (→ post-W1 `server/lib/workflow/types.ts`) | `RunContext` interface `runMode` field | `RunContext` carries `runMode` for engine-dispatch decisions. | Add `safetyMode: 'explore' \| 'execute'` to `RunContext`. Leave `runMode` in place (still used for `background` / `bulk`). |
| `client/src/pages/AdminAgentEditPage.tsx` | grep for `supervised` — may be zero hits (scheduling section uses heartbeat/concurrency, not run-mode). | Audit confirmation only. | No action expected. |
| `client/src/pages/SubaccountAgentEditPage.tsx` | grep for `supervised` — may be zero hits. | Audit confirmation only. | No action expected. |

**Audit count at authoring time (from grep):** approximately **7 load-bearing sites** — the 6 listed above (Modal, run service, engine service, route, schema types, run-context types) plus any references in test fixtures. Builder reruns `grep -rn "supervised" server/ client/ shared/ --include="*.ts" --include="*.tsx"` against the W1-merged branch and confirms the table matches before coding; any new site surfaced by the grep gets a row appended to this table in the PR description.

---

## 5. Mockup citations per UI file

Every UI-touching file in §4.8 traces to exactly one mockup under `prototypes/riley-observations/`. The mockups were locked by §3a.2 of the spec — where mockup and prose disagree, the mockup wins.

| UI file | Mockup file | Primary user task (from mockup header) | Notes / locked decisions that bind |
|---|---|---|---|
| `client/src/pages/AdminAgentEditPage.tsx` | `prototypes/riley-observations/10-agent-config-page.html` | "Set the agent's defaults" | §3a.2 lock 1 — surgical addition to the existing `SectionCard` "Schedule & Concurrency" section (L1410–L1560), not a new page. Mock explicitly annotates the field as new-inside-existing section. |
| `client/src/pages/SubaccountAgentEditPage.tsx` | `prototypes/riley-observations/10-agent-config-page.html` | "Set the agent's defaults" | Safety mode only (not the heartbeat gate — that is W4). Same mockup; W2 implements only the `default_safety_mode` control, not the heartbeat toggle shown further down the same mock. |
| `client/src/pages/OrgAgentConfigsPage.tsx` | (no mockup — read-only per §6.8) | — | Explicit no-change. |
| `client/src/components/WorkflowRunModal.tsx` (post-W1) | `prototypes/riley-observations/03-workflow-run-modal-step2.html` | "Pick a safety mode and run the Workflow" | §3a.2 lock 4 — **no disabled-selector variant for scheduled runs**; scheduled runs skip the mode-picker entirely. One radio pair, one Run button. |
| `client/src/pages/AgentChatPage.tsx` | `prototypes/riley-observations/02-agent-chat-explore-mode.html` | "Chat safely — see what will change before it runs" | §3a.2 lock 5 — mode-change is recorded in the **run log**, not as an inline system message in the chat stream. Single header chip, single confirm dialog on toggle, inline approval card in the stream. |
| `client/src/components/PromoteToExecuteModal.tsx` | `prototypes/riley-observations/04-promote-to-execute-prompt.html` | "Decide whether to stop reviewing every action" | §3a.2 lock 6 — one sentence + two buttons; no trust-receipts list; no typed "Execute" confirm. |
| Run-log viewer (existing component, name confirmed at implementation) | — (inline state rendered on existing infra) | — | No new mockup; new row type rendered in the existing run-log UI per §3a.2 lock 5. |

Any UI change in this wave that does NOT appear in the table above is out of scope — if it surfaces during implementation, the builder stops and asks rather than extending scope silently.

---

## 6. 152-skill `side_effects` audit — separable deliverable

Per spec §12.12 and §6.4, every skill markdown file must declare `side_effects: true | false` as a top-level frontmatter key. This is a **separable, read-only-ish deliverable**: a single Sonnet session can run it as a distinct sub-task, independent of the schema / service / UI work above. The output is the backfill source for migration `0205`'s `system_skills.side_effects` column (decision 2).

**Output location:** `tasks/builds/riley-observations/skills-side-effects-audit.md`

**Process (one paragraph per the spec requirement):**

1. **Scan** every markdown file under `server/skills/*.md` and `companies/*/skills/*.md` (~152 files per the spec). Parse frontmatter; record the skill slug, filename, and current `side_effects` value if one exists.
2. **Classify** each skill using the §6.4 guidance: `true` for anything mutating external state (send email, update CRM, modify ad spend, post message, create contact, write page, fire webhook, transition pipeline); `false` for pure reads (list deals, get stats, fetch thread, search messages); when ambiguous, default to `true` (safe per the unknown-safe rule §1.5 principle 4).
3. **Log** every classification in `skills-side-effects-audit.md` as a table: `| slug | filename | classification | rationale (≤ 15 words) | ambiguous? |`. Ambiguous-but-marked-true rows are flagged so post-launch tuning can revisit them.
4. **Annotate** each markdown file by inserting the frontmatter key in alphabetical position inside the existing block. If the file has no frontmatter at all (shouldn't happen for real skills but possible for doc fragments), the audit log marks it and the builder decides at review whether to add a frontmatter block or exclude the file from the scan.
5. **Emit backfill SQL** at the bottom of the audit log: a `VALUES (slug, side_effects_boolean) …` list restricted to rows where classification is `false` (rows where classification is `true` need no UPDATE — `true` is the column default). This list is copied verbatim into migration `0205_explore_execute_mode.sql` per §3.1's backfill block.
6. **Gate** — commit the CI gate `scripts/gates/verify-skill-side-effects.sh` per §6.4 as part of this audit deliverable: it fails the PR if any file under `server/skills/**/*.md` or `companies/*/skills/*.md` lacks a top-level `side_effects` frontmatter key. Static enforcement that the frontmatter never drifts.

**Work scope:** pure markdown scanning + classification + one new shell-script gate. No TypeScript, no DB writes, no UI. Can run in parallel with the Phase A / B / C work in this plan; the one hard dependency is that the audit log exists before migration `0205`'s backfill UPDATE is committed (otherwise the UPDATE is empty and every skill silently defaults to `side_effects = true`).

**Ownership:** a dedicated Sonnet session, kicked off via `architect:` / `superpowers:subagent-driven-development` the same way other deliverables under this plan are owned. Out-of-band review by a second reviewer is useful but not required; the `true`-safe default limits blast radius from a mis-classification.

---

## 7. Test strategy

See spec §11.2 "Part 3 (Explore / Execute Mode)" (lines 1787–1793). Coverage: pure-function unit tests against `gateResolutionServicePure` (gate matrix: `safetyMode × subject.kind × sideEffects × defaultGateLevel`, with the `invoke_automation` branch and the block-always-wins case both pinned) and `resolveSafetyModeServicePure` (safety-mode matrix: parent-inheritance > explicit override > top-level scheduled=execute > user pref > agent default); plus integration tests for the Explore review-queue flow, the schedule → Execute contract, the 5-Explore promote-prompt trigger, and mode-persistence across refresh and new-subaccount reset. No frontend unit tests and no API-contract tests — consistent with the framing `testing_posture: static_gates_primary` / `frontend_tests: none_for_now`.

---

## 8. Reviewer checklist

See spec §11.3.
