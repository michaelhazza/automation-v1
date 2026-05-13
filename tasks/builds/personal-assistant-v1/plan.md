# Personal Assistant V1 — Implementation Plan

**Status:** authored 2026-05-12 by architect (Phase 2)
**Source spec:** `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md` (accepted, locked 2026-05-12)
**Build slug:** `personal-assistant-v1`
**Branch:** `claude/synthetos-personal-assistant-0kaIM`
**Migration baseline:** latest on `main` is `0326_operator_session_columns.sql`. EA V1 starts at `0327`.

## Contents

- [Model-collapse check](#model-collapse-check)
- [Executor notes](#executor-notes)
- [Predecessor primitives (from user-owned-agents)](#predecessor-primitives-from-user-owned-agents)
- [Architecture notes](#architecture-notes)
- [Decisions resolved (the 12 open questions from spec §27)](#decisions-resolved-the-12-open-questions-from-spec-27)
- [Risks + mitigations](#risks--mitigations)
- [Chunk plan](#chunk-plan)
  - [Chunk 1 — Shared types + predecessor pre-check](#chunk-1--shared-types--predecessor-pre-check)
  - [Chunk 2 — voice_profiles migration + RLS + Drizzle schema](#chunk-2--voice_profiles-migration--rls--drizzle-schema)
  - [Chunk 3 — ea_drafts migration + RLS + Drizzle schema](#chunk-3--ea_drafts-migration--rls--drizzle-schema)
  - [Chunk 4 — external_source_triggers migration + RLS + schema](#chunk-4--external_source_triggers-migration--rls--schema)
  - [Chunk 5 — OAuth provider + action registry rows + topic registry](#chunk-5--oauth-provider--action-registry-rows--topic-registry)
  - [Chunk 6 — EA draft service + state machine + route + stall job extension](#chunk-6--ea-draft-service--state-machine--route--stall-job-extension)
  - [Chunk 7 — Calendar action service + pure helpers + skill markdown](#chunk-7--calendar-action-service--pure-helpers--skill-markdown)
  - [Chunk 8 — Slack action service + pure helpers + skill markdown](#chunk-8--slack-action-service--pure-helpers--skill-markdown)
  - [Chunk 9 — External-source triggers service + Slack webhook extension](#chunk-9--external-source-triggers-service--slack-webhook-extension)
  - [Chunk 10 — Gmail polling job + Calendar lookahead job](#chunk-10--gmail-polling-job--calendar-lookahead-job)
  - [Chunk 11 — capabilityGroups.ts + integration-reference slug additions](#chunk-11--capabilitygroupsts--integration-reference-slug-additions)
  - [Chunk 12 — VoiceProfile service + samplers](#chunk-12--voiceprofile-service--samplers)
  - [Chunk 12b — VoiceProfile refresh job](#chunk-12b--voiceprofile-refresh-job)
  - [Chunk 13 — VoiceProfile route + prompt-assembly extension](#chunk-13--voiceprofile-route--prompt-assembly-extension)
  - [Chunk 13a — Permissions keys (pre-load)](#chunk-13a--permissions-keys-pre-load)
  - [Chunk 13b — system_agents.home_widget schema primitive](#chunk-13b--system_agentshome_widget-schema-primitive)
  - [Chunk 14 — Home-widget service + route + body-provider skill](#chunk-14--home-widget-service--route--body-provider-skill)
  - [Chunk 15a — Workflow skills (briefing, triage, prep)](#chunk-15a--workflow-skills-briefing-triage-prep)
  - [Chunk 15 — EA system-agent template seed migration + c.ts entry](#chunk-15--ea-system-agent-template-seed-migration--cts-entry)
  - [Chunk 17 — Telemetry event registry + RLS_PROTECTED_TABLES wrap-up](#chunk-17--telemetry-event-registry--rls_protected_tables-wrap-up)
  - [Chunk 18 — Integration test — credential isolation](#chunk-18--integration-test--credential-isolation)
  - [Chunk 19 — Client UI — hooks + sidebar + routes + pages](#chunk-19--client-ui--hooks--sidebar--routes--pages)
- [Acceptance criteria (whole plan)](#acceptance-criteria-whole-plan)
- [Out of plan (acknowledged but not authored here)](#out-of-plan-acknowledged-but-not-authored-here)

## Model-collapse check

Three questions per the architect playbook:
1. Does EA V1 decompose into ingest -> extract -> transform -> render? Partially (each workflow does), but the overall feature is platform plumbing.
2. Could a frontier multimodal model do each step in one call? Workflow content composition yes; OAuth + Drizzle schema + RLS + pg-boss + Run Trace + UI surfaces no.
3. Can the whole pipeline collapse into one model call with structured output? No.

**Decision: reject collapse.** EA V1 is durable, auditable, multi-tenant platform code (RLS-protected tables, pg-boss jobs, OAuth, idempotency ledger, approval primitive composition). A single-model-call collapse would destroy the audit trail, RLS contract, and idempotency guarantees the spec locks. The pieces inside individual workflows (compose-briefing prompt, distil-voice prompt, classify-inbox prompt) are already single LLM calls today via `llmRouter` — that is the right granularity.

## Executor notes

**Test gates and whole-repo verification scripts (`npm run test:gates`, `npm run test:qa`, `npm run test:unit`, `npm test`, `scripts/verify-*.sh`, `scripts/gates/*.sh`, `scripts/run-all-*.sh`) are CI-only. They do NOT run during local execution of this plan, in any chunk, in any form. Targeted execution of unit tests authored within this plan is allowed; running the broader suite is not.**

Per-chunk allowed local commands: `npm run lint`, `npm run typecheck` (or `npx tsc --noEmit`), `npm run build:server` / `npm run build:client` when the chunk touches the build surface, and `npx vitest run <path-to-test>` for tests authored in THIS chunk.

## Predecessor primitives (from `user-owned-agents`)

Chunk 0 pre-check. The builder for Chunk 1 verifies each of the following exists on the rebased branch BEFORE doing any work. Missing = return `PLAN_GAP` with the missing-primitive list; coordinator pauses + escalates.

| Primitive | Expected file path | Symbol / column / event |
|---|---|---|
| `agents.owner_user_id` nullable uuid column | `server/db/schema/agents.ts` | `ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'restrict' })` |
| Partial index on `agents` | predecessor migration | `agents_personal_idx ON agents(organisation_id, owner_user_id) WHERE owner_user_id IS NOT NULL` |
| `agent_runs.owner_user_id` nullable uuid column + immutability constraint | `server/db/schema/agentRuns.ts` | `ownerUserId: uuid('owner_user_id')` |
| Partial index on `agent_runs` | predecessor migration | `agent_runs_user_owned_idx ON agent_runs(organisation_id, owner_user_id, started_at DESC) WHERE owner_user_id IS NOT NULL` |
| `integration_connections.owner_user_id` nullable uuid column | `server/db/schema/integrationConnections.ts` | `ownerUserId: uuid('owner_user_id')` |
| Partial unique index on `integration_connections` | predecessor migration | unique `(organisation_id, subaccount_id, owner_user_id, provider) WHERE owner_user_id IS NOT NULL` |
| `CredentialBrokerService.injectIntoEnvironment({ ownerUserId? })` extension | `server/services/credentialBrokerService.ts` | signature accepts optional `ownerUserId: string` |
| `OWNER_MISMATCH` typed error | `server/services/credentialBrokerService.ts` (or `server/lib/errors.ts`) | thrown when resolved connection's `owner_user_id` differs from requested |
| Owner-scoped credential revocation pathway | `server/services/credentialBrokerService.ts` | revoking a user-owned `integration_connections` row leaves subaccount connection intact |
| RLS clause for user-owned `agent_runs` | predecessor RLS migration | `owner_user_id IS NULL OR owner_user_id = current_setting('app.current_user_id')::uuid OR current_setting('app.current_role')::text IN ('org_admin', 'subaccount_admin')` |
| RLS clause for user-owned `integration_connections` | predecessor RLS migration | analogous clause |
| Admin redaction policy at API serialisation | `server/lib/agentRunVisibility.ts` (or equivalent) | redacts content for admin-non-owner on user-owned rows |
| Typed audit event `owner.content_revealed` | `server/services/securityAuditService.ts` | event-type constant exported |
| Master brief §5.1 + §9 doc updates | `docs/synthetos-governed-agentic-os-brief-v1.2.md` | references to user-owned agents in those sections |

**Predecessor gate (Chunk 1 first step).** Before any code change, builder greps the file paths above for the named symbols. All-present = proceed. Any-missing = return `PLAN_GAP` listing each missing primitive with the grep pattern that failed. Builder does NOT attempt to author predecessor primitives in this plan.

## Architecture notes

### Domain model summary
Three additive entity classes plus two existing primitives composed:
- **VoiceProfile** (new table `voice_profiles`) — per-owner derived voice features; reusable across EA / Riley / Helena / Sarah / future content agents.
- **EA-draft** (new table `ea_drafts`) — EA-side draft payload + post-approval send state; composes over the existing `actions` table (proposal primitive) via `ea_drafts.proposal_action_id` FK.
- **External-trigger dedup** (new table `external_trigger_dedup`) — composite key idempotency ledger for external-source webhook + poll events.
- **EA agent template** — new row in `system_agents` + new entry in `SUBACCOUNT_AGENTS` in `c.ts`. New `home_widget jsonb` column on `system_agents` (NULL = template does not surface to home zone).
- **External-source triggers** — three new enum values on `agent_triggers.event_type` (`gmail_message_received`, `calendar_event_imminent`, `slack_mention`).

### Service layer additions
- `calendarActionService` + `calendarActionServicePure` — 6 Calendar actions
- `slackActionService` + `slackActionServicePure` — 6 Slack actions
- `externalSourceTriggers` + `externalSourceTriggersPure` — webhook + poll dispatch into trigger primitive
- `voiceProfileService` + `voiceProfileServicePure` + `gmailSentSampler` + `driveDocSampler` — voice profile derivation/refresh/opt-out
- `eaDraftService` + `eaDraftServicePure` — EA-draft send state machine (NOT approval; that lives on `actions`)
- `homeWidgetService` + `homeWidgetServicePure` — read user-owned agents + invoke per-agent body-provider skill

### Schema additions
New tables (each with full RLS + `RLS_PROTECTED_TABLES` entry + Drizzle schema + `shared/types/*` types):
- `voice_profiles` (spec §7.4 + §21.1)
- `ea_drafts` (§7.5 + §21.2)
- `external_trigger_dedup` (§7.1 + §21.3)

New columns on existing tables:
- `system_agents.home_widget jsonb` nullable (§7.6)

Extended enum on existing table:
- `agent_triggers.event_type` adds `gmail_message_received`, `calendar_event_imminent`, `slack_mention` (§10.1)

### Migration plan (numbered, ordered, idempotent down-scripts)
Baseline latest: `0326_operator_session_columns.sql`. EA V1 claims `0327` through `0331`.

**F3 split (post chatgpt-plan-review round 1, applied 2026-05-12):** the EA system-agent template seed was split into TWO migrations to avoid a rollback footgun on the generic `system_agents.home_widget` column. Once other templates populate `home_widget`, downing a combined "column + seed" migration would drop the column out from under unrelated rows.

| # | File | Purpose |
|---|---|---|
| 0327 | `migrations/0327_voice_profiles.sql` + `.down.sql` | Create `voice_profiles` table (cols per §7.4); RLS policy per §21.1; partial indexes per scope axis; CHECK constraint `(owner_user_id IS NOT NULL)::int + (subaccount_id IS NOT NULL)::int + (org_scope)::int = 1`; CHECK `refresh_policy IN ('manual', 'periodic', 'on_send_count')`; default `state = 'pending'`. Down: `DROP POLICY IF EXISTS voice_profiles_isolation ON voice_profiles`, `DROP TABLE IF EXISTS voice_profiles CASCADE` |
| 0328 | `migrations/0328_ea_drafts.sql` + `.down.sql` | Create `ea_drafts` table (cols per §7.5); FK `proposal_action_id REFERENCES actions(id) ON DELETE RESTRICT`; FK `agent_id` + `run_id`; RLS per §21.2; indexes `(organisation_id, owner_user_id, send_state)`, `(proposal_action_id)`. Down: `DROP POLICY IF EXISTS ea_drafts_isolation ON ea_drafts`, `DROP TABLE IF EXISTS ea_drafts CASCADE` |
| 0329 | `migrations/0329_external_source_triggers.sql` + `.down.sql` | (a) Extend `agent_triggers.event_type` enum to add 3 new values via `ALTER TYPE ... ADD VALUE IF NOT EXISTS` (must run outside a transaction per Postgres). (b) Create `external_trigger_dedup` table per §7.1 with composite PK `(provider, dedup_key, owner_user_id)`. RLS per §21.3. Down: `DROP TABLE IF EXISTS external_trigger_dedup CASCADE`. Enum value removal is intentionally not part of the down-script — Postgres does not support `ALTER TYPE ... DROP VALUE`; the down-script comments this. |
| 0330 | `migrations/0330_system_agents_home_widget.sql` + `.down.sql` | Generic column add: `ALTER TABLE system_agents ADD COLUMN IF NOT EXISTS home_widget jsonb` (nullable, default NULL). Down-script refuses to drop the column while any non-NULL rows exist — guarded so a future template using `home_widget` is not silently broken by a rollback of this migration. Down body: `DO $$ BEGIN IF EXISTS (SELECT 1 FROM system_agents WHERE home_widget IS NOT NULL) THEN RAISE EXCEPTION 'Cannot drop system_agents.home_widget while rows still use it'; END IF; ALTER TABLE system_agents DROP COLUMN IF EXISTS home_widget; END $$;`. |
| 0331 | `migrations/0331_executive_assistant_seed.sql` + `.down.sql` | EA-specific seed only: (a) Insert `system_agents` row for `slug = 'executive-assistant'` per §13.1 (name, agent_role, execution_scope, master_prompt, default_org_skill_slugs, home_widget JSONB declaration). (b) Add partial unique index `agents_personal_assistant_per_user_idx ON agents(subaccount_id, owner_user_id) WHERE slug = 'executive-assistant' AND deleted_at IS NULL`. Down: `DROP INDEX IF EXISTS agents_personal_assistant_per_user_idx`, `DELETE FROM system_agents WHERE slug = 'executive-assistant'`. Down-script touches ONLY the EA seed row + its partial index — never the generic column. |

Migration numbers claimed at merge time per DG §6.2; builder rebases against `main` before merge and renumbers if newer migrations have landed.

### New permission keys
Six new keys added to `server/lib/permissions.ts` (§21.5 + Q8 decision below):
- `VOICE_PROFILE_READ`, `VOICE_PROFILE_WRITE` — every user (their own)
- `EA_DRAFT_READ`, `EA_DRAFT_DECIDE` — every user (their own)
- `HOME_WIDGET_READ` — every user
- `EA_PROVISION` — every user (Q8 decision: default-grant)

Each adds an `ALL_PERMISSIONS` entry. No admin-only keys.

### New capability slugs + integration-reference slugs
In `docs/integration-reference.md`:
- `calendar_read` (Google Calendar)
- `calendar_event_create` (Google Calendar)
- `calendar_event_update` (Google Calendar)
- `calendar_event_respond` (Google Calendar)
- `channel_messages_read` (Slack)
- `channel_post_message` (Slack)
- `channel_search_messages` (Slack)
- `dm_send` (Slack)

### New skills
Skill markdown files in `server/skills/`:
- 6 Calendar action skills (`calendar-list-events.md`, `calendar-get-event.md`, `calendar-find-free-slot.md`, `calendar-create-event.md`, `calendar-update-event.md`, `calendar-respond-to-invite.md`)
- 6 Slack action skills (`slack-list-channels.md`, `slack-read-channel.md`, `slack-search-messages.md`, `slack-summarise-thread.md`, `slack-post-message.md`, `slack-post-dm.md`)
- 3 workflow skills (`ea-daily-briefing.md`, `ea-inbox-triage.md`, `ea-meeting-prep.md`)
- 1 home-widget body skill (`ea-home-widget-summary.md`)

### New pg-boss queues + cron schedules
- `gmailInboxPollJob` — recurring 5-min per connected Gmail account
- `calendarLookaheadJob` — recurring 1-min per connected Calendar account (5-min fallback on sustained 429)
- `voiceProfileRefreshJob` — recurring nightly (eligible rows)

Existing `workflowGateStallNotifyJob` extended to handle EA-linked `actions` rows.

### New routes + webhook surfaces
- `server/routes/voiceProfiles.ts` — GET list / GET by id / POST refresh / POST opt-out / POST reactivate
- `server/routes/eaDrafts.ts` — GET list / GET by id / POST approve / POST reject / POST retry (delegates to `actionService.transitionState` on the linked action)
- `server/routes/agentHomeWidgets.ts` — GET widgets for current user
- `server/routes/webhooks/slackWebhook.ts` — EXTENDED: add `url_verification` handler; `app_mention` event handler is no-op'd V1 (returns 200, deferred per spec §10.2)

No new `googleWebhook.ts` route — Calendar push deferred V1.5 per §10.2.

### New UI surfaces + nav contributions
- `client/src/pages/personal/PersonalAssistantPage.tsx` — tabbed shell (Workspace / Activity / Settings)
- `client/src/pages/personal/EAFirstRunWizard.tsx` — first-run wizard (renders locked mockup 01)
- `client/src/components/personal/PersonalZoneCard.tsx` — consistent card frame
- 4 hooks: `useUserOwnedAgents`, `useHomeWidgets`, `useVoiceProfile`, `useEADrafts`
- `client/src/config/sidebar.ts` — Personal nav group (data-driven)
- `client/src/config/routes.ts` — `/personal/setup`, `/personal/:agentId`, `/personal/:agentId/setup`
- `client/src/pages/home/HomePage.tsx` — Personal zone at top
- `client/src/pages/govern/ConnectionsPage.tsx` — Personal/Subaccount chip + capability grouping

### Telemetry events introduced
Added to `shared/types/agentExecutionLog.ts` `AGENT_EXECUTION_EVENT_CRITICALITY`:
- `trigger.fired` (info), `trigger.suppressed` (warning)
- `workflow.started` / `workflow.completed` (info), `workflow.failed` (error), `workflow.partial` (warning)
- `draft.created` (info), `draft.sending` (info), `draft.sent` (info), `draft.send_failed` (warning)
- `voice.profile.refreshed` / `voice.profile.derivation.started` / `voice.profile.derivation.completed` (info), `voice.profile.derivation.failed` (warning)
- `delivery_fallback` (warning), `credential.owner_mismatch` (error), `webhook.invalid_signature` (warning), `action.conflict` (warning)

Approval-side events (`proposal.approved` / `proposal.rejected` / `proposal.expired`) are owned by the existing `actions` primitive — NOT added here.

### File inventory (canonical, against spec §5)
Exhaustively cross-referenced spec §5.1 + §5.2. The plan's per-chunk "files" declarations are the source of truth for the builder; the builder reports the subset it actually touched per `feature-coordinator` contract.

**New files (~40):**
5 migrations (0327, 0328, 0329, 0330, 0331 — each with .down; 0330 in chunk 13b + 0331 in chunk 15 are the F3-split pair from round-1; 0330 moved earlier in round-2 F2); 12 skill markdown files (6 Calendar + 6 Slack); 3 workflow skill markdown files; 1 home-widget body skill markdown; 12 service files; 3 routes; 3 jobs; 1 config (`capabilityGroups`); 6 shared types; 6 pure-helper tests; 1 integration test; 4 hooks; 3 client pages/components.

**Modified files (~17):**
`server/config/oauthProviders.ts`, `server/config/actionRegistry.ts`, `server/config/topicRegistry.ts`, `server/config/c.ts`, `server/services/triggerService.ts`, `server/db/schema/agentTriggers.ts`, `server/db/schema/systemAgents.ts`, `server/routes/webhooks/slackWebhook.ts`, `server/jobs/workflowGateStallNotifyJob.ts`, `server/services/agentExecutionServicePure.ts`, `server/config/rlsProtectedTables.ts`, `server/lib/permissions.ts`, `shared/types/agentExecutionLog.ts`, `server/config/limits.ts`, `client/src/pages/govern/ConnectionsPage.tsx`, `client/src/config/sidebar.ts`, `client/src/config/routes.ts`, `client/src/pages/home/HomePage.tsx`, `docs/integration-reference.md`.

**Doc-sync (Phase 3, NOT in this plan):** `architecture.md`, `KNOWLEDGE.md`, `docs/capabilities.md`, `docs/synthetos-governed-agentic-os-brief-v1.2.md`.

## Decisions resolved (the 12 open questions from spec §27)

### Q1 — Calendar `respond_to_invite` risk tier
**Decision:** Tier 3 (as spec recommended).
**Rationale:** Per spec §6.3, `respond_to_invite` only updates organiser-visible state (the responding user's RSVP), not customer-broadcast. The action does not message a third party in a content sense. Tier 3 + action-level `defaultGate: review` override yields the same operator-facing safety as Tier 4 without misclassifying the risk surface.
**Where realised:** Chunk 5 (actionRegistry) row `respond_to_invite`: `riskTier: 3`, `defaultGate: 'review'`.

### Q2 — Slack scope additions
**Decision:** Ship all 7 listed scopes (`channels:history`, `groups:history`, `im:history`, `mpim:history`, `im:write`, `search:read`, `app_mentions:read`).
**Rationale:** All required by V1 actions (`read_channel` needs the four history scopes; `post_dm` needs `im:write`; `search_messages` needs `search:read`; `app_mention` event subscription needs `app_mentions:read`). `search:read` requires a paid Slack workspace plan — handled at runtime with typed `PLAN_NOT_SUPPORTED` (§9.2). The wizard surfaces a "Re-authorise" affordance when existing connections lack new scopes.
**Where realised:** Chunk 5 (`oauthProviders.ts` Slack entry). Chunk 8 (`slackActionService` returns `PLAN_NOT_SUPPORTED` when `search:read` denied).

### Q3 — Calendar lookahead cadence
**Decision:** Ship 1-minute baseline cadence with automatic 5-minute fallback on 429.
**Rationale:** Per spec §10.5, 1 call/min × 1 calendar = 1,440 calls/day per connection, well inside Google's per-user 1M-units/day free quota (`events.list` ≈ 1 unit). 1-min cadence ensures the 15-min lookahead window is never missed. If 429 sustained, `calendarLookaheadJob` falls back to 5-min cadence with a logged warning. On-demand fast-track is NOT shipped V1.
**Where realised:** Chunk 10 (`calendarLookaheadJob.ts`): default interval 60s; rate-limit fallback path.

### Q4 — Calendar lookahead horizon
**Decision:** 15-minute global constant in `server/config/limits.ts`. NOT a per-user memory_block.
**Rationale:** Per spec §10.5, V1 ships single 15-min horizon. Per-user override would surface a UI control with no clear business value and would scatter the constant across the codebase. Multi-horizon (24h next-day prep + 15-min imminent) is explicitly deferred per §26 — when it lands, the global constant becomes a per-horizon set in the same file, not a memory_block.
**Where realised:** Chunk 10 (`server/config/limits.ts` adds `CALENDAR_LOOKAHEAD_MINUTES = 15`).

### Q5 — EA `agentRole`
**Decision:** `'Specialist'` (as spec recommended).
**Rationale:** Matches Sarah / Helena / Patel (workers with defined skill bundles, not orchestrators). EA does NOT delegate to other agents (cross-ownership delegation is explicitly out of V1 scope per §15.7). Adding a `'Personal_Assistant'` role would create a one-off enum value with no consumer differentiation.
**Where realised:** Chunk 15 (`c.ts` SUBACCOUNT_AGENTS entry: `agentRole: 'Specialist'`).

### Q6 — EA system-prompt canonical text
**Decision:** Draft the prompt as the canonical text below. Builder copies into the seed migration body.
**Rationale:** Per spec §13.3, the prompt has 5 sections (identity / voice integration / escalation rules / memory awareness / delivery awareness).

Canonical text the builder embeds in `0331_executive_assistant_seed.sql` `master_prompt`:

```
You are an Executive Assistant agent acting on behalf of {ownerUser.displayName}.

Identity. You speak in {ownerUser.displayName}'s voice when composing outbound messages. Refer to the <voice> block below when present. Without a voice block, default to a clear, professional tone.

Memory awareness. Read working hours, timezone, briefing preferences, and recurring people / projects from your memory blocks at run start. Honour the operator's quiet hours.

Escalation rules.
- When uncertain (low-confidence classification, ambiguous user intent, conflicting calendar or availability info), invoke ask_clarifying_question rather than guess.
- When a Tier 6 action surfaces (send_email, slack.post_message, slack.post_dm to non-owner), invoke request_clarification before proposing.
- When a credential is revoked or expired, invoke notify_operator with severity warning and a deep link to reconnect.

Delivery awareness.
- Briefing delivery target: read from memory_block ea.briefing_delivery_target. Slack DM is the default; email fallback if Slack unavailable.
- Auto-send is strictly limited: Slack DM to the operator's own user is the only auto-allowed third-party-surface write. All other Slack writes and all Gmail sends are review-gated through ea_drafts.

You ask before sending to third parties; you act freely on internal-only tasks (reads, drafts, memory updates, briefing composition).
```

**Where realised:** Chunk 15 (`migrations/0331_executive_assistant_seed.sql` `master_prompt` column value).

### Q7 — Stub second user-owned agent
**Decision:** Do NOT ship a stub Dev Agent template in V1. Rely on the integration test in §25.3 as the reuse-criterion proof.
**Rationale:** Per spec §15.6, V1 does not require shipping a second user-owned agent — the contracts are generic by construction (Personal nav group data-driven from `agents WHERE owner_user_id = current_user.id`; home-widget data-driven from `system_agents.home_widget`; broker call parametric in `provider` + `ownerUserId`). The integration test `userOwnedAgentCredentialIsolation.test.ts` exercises the broker pathway with two users in the same subaccount, which is the critical safety invariant. Adding a no-op stub would add a `system_agents` row + a no-op skill with no other consumer.
**Where realised:** Chunk 18 (integration test) is the proof. No stub-agent chunk authored.

### Q8 — `EA_PROVISION` permission default-grant
**Decision:** Default-grant to every user.
**Rationale:** Per spec §13.4, EA provisioning IS the user's own opt-in choice. Gating provisioning behind admin grant would defeat the "personal assistant for every user" framing and create a friction point with no governance benefit (admins still control which subaccount the user belongs to, which is the gate that matters). For agencies that want admin-gated provisioning, a future spec can introduce a subaccount-level toggle.
**Where realised:** Chunk 13a (`server/lib/permissions.ts`: `EA_PROVISION` added to `ALL_PERMISSIONS` and default-grant set for every user role).

### Q9 — Operator user's seed EA at deploy time
**Decision:** No seed. Operator goes through the wizard like every other user.
**Rationale:** Per spec §13.5, safer is no seed. Seed-time EA creation would couple the migration to a specific `users.id` value (operator's UUID), require the operator's user row to exist before the migration runs, and bypass the wizard's wizardry (memory_block writes, voice-profile derivation kick-off, OAuth connection wiring). The wizard takes well under a minute to complete; consistency wins.
**Where realised:** Chunk 15 (`migrations/0331_executive_assistant_seed.sql` inserts ONLY the `system_agents` template row; NO `agents` row insertion).

### Q10 — Slack capability slug naming
**Decision:** Use the spec-proposed slugs unchanged: `channel_messages_read`, `channel_post_message`, `channel_search_messages`, `dm_send`.
**Rationale:** Per spec §17.3, these match the existing integration-reference naming convention (`<surface>_<verb>` for reads, `<surface>_<verb>_<noun>` for writes — cf. existing `inbox_read`, `email_body_read`, `send_email`, `calendar_event_create`). The names are vendor-neutral so future Microsoft Teams or Discord providers can declare the same slugs.
**Where realised:** Chunk 11 (`docs/integration-reference.md` + `server/config/capabilityGroups.ts`).

### Q11 — Workflow execution-event taxonomy
**Decision:** All event types listed in the spec (§10.7, §11.4, §24.3) land in `shared/types/agentExecutionLog.ts` `AGENT_EXECUTION_EVENT_CRITICALITY` with the criticalities listed in Architecture notes above. Verified no collision with existing event-type entries.
**Rationale:** Per spec §11, every triggered + workflow run already uses the existing Run Trace event scaffold; criticality registry is the only schema landing. `proposal.*` events stay owned by the `actions` primitive.
**Where realised:** Chunk 17 (one edit to `shared/types/agentExecutionLog.ts` adding the new entries).

### Q12 — `actionService.proposeAction` FK shape verification
**Decision:** VERIFIED satisfiable. The composition is realised via `ea_drafts.proposal_action_id uuid NOT NULL REFERENCES actions(id) ON DELETE RESTRICT`. No spec revision required.
**Rationale:**
- `actions` table (`server/db/schema/actions.ts` lines 12-93) exposes `id uuid PK`, `payloadJson jsonb`, `metadataJson jsonb`, and a closed `status` enum (`proposed | pending_approval | approved | executing | completed | failed | rejected | blocked | skipped`).
- `proposeAction` signature (`server/services/actionService.ts` lines 74-110) accepts `payload: Record<string, unknown>` + optional `metadata: Record<string, unknown>`. The `metadata` JSONB stamps `{ kind: 'ea_draft', draftId }` at proposal-creation time for back-reference visibility.
- `actions.id` is referenced by `ea_drafts.proposal_action_id` (inverse FK direction; chosen to avoid mutating the `actions` schema). The proposal row IS the approval source of truth; `ea_drafts.send_state` is post-approval only.
- `LEGAL_TRANSITIONS` enforces `proposed -> pending_approval -> approved -> executing -> completed | failed` plus terminal `rejected | blocked | skipped`. The proposal primitive's existing approval path covers EA's approval state perfectly; the `executing -> completed` transition is the commit hook entry point for the EA-side send.
- `actions.suspendUntil` already implements the 7-day expiry shape `workflowGateStallNotifyJob` operates on (verified by reading existing job code — chunk 6 extends it).
**Where realised:** Chunk 3 (`ea_drafts` migration) with the FK; chunk 6 (`eaDraftService`) creates the draft + the action row in the same transaction; chunk 6 commit-hook integration with `actionService.transitionState`.

## Risks + mitigations

### R1 — Predecessor primitives not merged when Phase 2 BUILD starts
**Impact:** Plan blocked; builder returns `PLAN_GAP` on every chunk.
**Mitigation:** Chunk-0 pre-check (predecessor gate above) lists every expected file path + symbol. Builder MUST verify before chunk 1. If missing, escalate to operator; do NOT author predecessor primitives here.

### R2 — `agent_triggers.event_type` enum extension migration race
**Impact:** Postgres `ALTER TYPE ... ADD VALUE` must run outside a transaction. A migration runner that wraps each migration in a transaction will fail.
**Mitigation:** Migration `0329_external_source_triggers.sql` follows the existing precedent: builder greps `migrations/*.sql` for prior `ALTER TYPE ... ADD VALUE` patterns to find the established style (likely a separate migration file with the enum-add isolated, or a directive comment that signals the runner to skip the wrapping transaction). If no precedent exists, builder splits 0329 into two files: `0329a_enum_add.sql` (enum-add only) + `0329b_external_trigger_dedup.sql` (table create) — the enum-add file carries a header comment instructing the runner.

### R3 — Calendar lookahead floods Google API quota
**Impact:** 1-min cadence × N connected users could exhaust quota during heavy testing.
**Mitigation:** Per-connection advisory lock prevents double-runs. Default cadence 1 min, automatic fallback to 5 min on first sustained 429. Lookahead horizon is a single 15-min window. Builder logs cadence-fallback events as `trigger.suppressed` reason `rate_capped` for visibility.

### R4 — `external_trigger_dedup` race between webhook ingest and poll-job ingest
**Impact:** Two ingest paths could attempt the same `(provider, dedup_key, owner_user_id)` triple — e.g. Gmail history says message X and a later poll also discovers it.
**Mitigation:** `INSERT ... ON CONFLICT DO NOTHING` semantics in `externalSourceTriggers.recordDedup`. The PK constraint guarantees idempotency at the database layer. A conflict resolves into a `trigger.suppressed` event with reason `dedup_hit` — no run enqueued, no error.

### R5 — Voice profile derivation reveals sensitive sent-mail content in logs / Run Trace
**Impact:** Privacy regression — admin redaction policy could leak transient content.
**Mitigation:** `voiceProfileServicePure.distilFeatures` operates on samples in memory only; samples are NEVER written to `voice_profiles.profile_json` (only derived statistics are). Run Trace event `voice.profile.refreshed` carries only `{ profileId, sampleSize, durationMs }` — no content. `gmailSentSampler` returns samples via an in-process callback, not via persistent storage. Reviewer (`adversarial-reviewer`) MUST verify no path persists `samples[*].text`.

### R6 — EA draft + action row out of sync (creation, approval, send)
**Impact:** A failed transaction could leave an `ea_drafts` row without a linked `actions` row (or vice versa), producing dangling FK or orphaned drafts.
**Mitigation:** `eaDraftService.createDraftWithProposal` performs both inserts inside a single `withOrgTx` block. FK is `ON DELETE RESTRICT` so a stray action delete cannot orphan the draft. The Workspace tab UI reads via JOIN; orphaned rows would be invisible. Nightly audit script for `ea_drafts.send_state IN ('idle','sending') WHERE proposal_action_id IS NULL` is a follow-up (out of this plan).

### R7 — Slack `search:read` paid-tier dependency surfaces as silent failure
**Impact:** Free-plan Slack workspaces lack `search:read`; `slack.search_messages` would fail with opaque Slack error.
**Mitigation:** `slackActionService.searchMessages` catches Slack's `not_allowed_token_type` / `missing_scope` / `team_not_authorized` errors and maps to typed `PLAN_NOT_SUPPORTED`. Daily-briefing workflow catches this error and falls back to a search-less path (channel reads only). The Slack OAuth connection card surfaces a "Plan upgrade required" chip when the scope is granted-then-revoked by Slack.

### R8 — Two simultaneous wizard submissions create duplicate EA agent rows
**Impact:** Browser-tab double-submit, mobile back-button-then-resubmit.
**Mitigation:** Per spec §13.4, two layers: (1) Postgres advisory lock on `('ea_provision', subaccount_id::bigint, owner_user_id::bigint)` taken in the wizard handler — loser waits up to 2s for leader to release; (2) defence-in-depth partial unique index `agents_personal_assistant_per_user_idx ON agents(subaccount_id, owner_user_id) WHERE slug = 'executive-assistant' AND deleted_at IS NULL` catches any racing insert that bypassed the advisory lock. Loser's 23505 maps to 409 with `code: 'ea_already_provisioned'`; client redirects to edit-setup.

## Chunk plan

19 chunks (chunks 12 + 19 are split for size compliance), organised by capability boundary (NOT by file or layer). Each chunk forms a deep module: small public interface, larger hidden implementation. Chunk size respects the rule: ≤5 files OR ≤1 logical responsibility.

**Build-order revision (post chatgpt-plan-review round 1, F1 applied 2026-05-12):** EA draft service relocated from old chunk 13 to new chunk 6 so it lands before Calendar/Slack action services (which compose the post-approval send-claim path against `ea_drafts.send_state`). Downstream chunks renumbered.

**Build-order revision (post chatgpt-plan-review round 2, F1/F2/F3 applied 2026-05-12):** Three additional ordering fixes: (F1) permission keys extracted into new Chunk 13a — must precede Chunk 14 which gates on `requirePermission('HOME_WIDGET_READ')`; (F2) `system_agents.home_widget` DDL + Drizzle field extracted into new Chunk 13b from old Chunk 15 — Chunk 14 reads the `homeWidget` column via the service layer; (F3) old Chunk 16 (workflow skills) renamed Chunk 15a and moved BEFORE Chunk 15 (EA seed) — the seed row's `default_org_skill_slugs` references skill slugs that must exist before the template is wired up. Old Chunk 16 retired.

Chunk dependency graph (forward-only):

```
1: Shared types + predecessor pre-check
2: voice_profiles migration + RLS + schema
3: ea_drafts migration + RLS + schema
4: external_source_triggers migration + RLS + schema
5: OAuth provider + action registry rows + topic registry
6: EA draft service + state machine + route + stall job      (depends on 1, 3)
7: Calendar action service + pure helpers + skills           (depends on 1, 5, 6)
8: Slack action service + pure helpers + skills              (depends on 1, 3, 5, 6)
9: External-source triggers service + slack webhook extension (depends on 1, 4)
10: Gmail poll job + Calendar lookahead job                  (depends on 1, 4, 9)
11: capabilityGroups + integration-reference slugs           (depends on 5)
12: VoiceProfile service + samplers                          (depends on 1, 2)
12b: VoiceProfile refresh job                                (depends on 12)
13: VoiceProfile route + prompt-assembly extension           (depends on 12)
13a: Permissions keys (pre-load)                             (depends on 1)
13b: system_agents.home_widget schema primitive              (depends on 1)
14: Home-widget service + route + body skill                 (depends on 1, 13a, 13b)
15a: 3 workflow skills (briefing, triage, prep)              (depends on 7, 8, 13)
15: EA template seed migration + c.ts entry                  (depends on 6, 7, 8, 12, 14, 15a; 0331 only — 0330 moved to 13b)
17: Telemetry event registry + RLS_PROTECTED_TABLES wrap-up  (depends on 2, 3, 4)
18: Integration test — credential isolation                  (depends on 2, 3, 6, 12, 15)
19a: Client hooks                                            (depends on 6, 13, 14)
19b: Sidebar + routes + ConnectionsPage chip                 (depends on 11, 19a)
19c: Pages + components                                       (depends on 19b)
```

### Chunk 1 — Shared types + predecessor pre-check

- **spec_sections:** §7 (all subsections — shared type contracts), §3.2 (predecessor gate)
- **files:**
  - `shared/types/homeWidget.ts` (new)
  - `shared/types/eaDraft.ts` (new)
  - `shared/types/voiceProfile.ts` (new)
  - `shared/types/externalSourceTrigger.ts` (new)
  - `shared/types/calendarAction.ts` (new)
  - `shared/types/slackAction.ts` (new)
- **logical responsibility:** Author every cross-boundary type and Zod schema the rest of the chunks consume. Plus the predecessor pre-check (the very first thing the builder runs).
- **module shape:**
  - *Public interface:* exported types + Zod schemas — `HomeWidgetType`, `HomeWidgetDeclaration`, `WidgetData` (discriminated), `EADraft`, `EADraftKind`, `EADraftSendState`, `VoiceProfile`, `VoiceProfileSource`, `VoiceProfileRefreshPolicy`, `VoiceProfileState`, `ExternalSourceTriggerEvent` (discriminated), `CalendarListEventsInput`, `CalendarCreateEventInput`, etc., `SlackPostMessageInput`, etc., plus Zod schemas suffixed `*Schema`.
  - *Hidden:* none (pure type modules).
- **contracts:**
  - `HomeWidgetDeclaration = { type: 'summary_card' | 'queue_card' | 'metric_card', titleTemplate: string, bodyProviderSkill: string, refreshPolicy: 'on_login' | 'every_5m' | 'on_demand' }`
  - `EADraftKind = 'gmail_reply' | 'gmail_new' | 'slack_post' | 'slack_dm' | 'calendar_create' | 'calendar_update' | 'calendar_respond'`
  - `EADraftSendState = 'idle' | 'sending' | 'sent' | 'send_failed'`
  - `VoiceProfileSource = 'gmail_sent_sampler' | 'drive_doc_sampler'` (the `'manual'` value is intentionally NOT in the V1 union per spec §26 deferred)
  - `VoiceProfileRefreshPolicy = 'manual' | 'periodic' | 'on_send_count'` — Zod schema for write API rejects `'on_send_count'`
  - `VoiceProfileState = 'pending' | 'deriving' | 'ready' | 'failed'`
  - `ExternalSourceTriggerEvent` discriminated on `eventType` per §7.1
  - ISO8601 strings validated via `z.string().datetime({ offset: true })`.
- **error handling:** Type-level only.
- **tests:** None in this chunk (types only; Zod schemas tested via consuming pure helpers in chunks 6, 7, 8, 12).
- **dependencies:** Predecessor pre-check FIRST (before any file edit). No code dependencies.
- **acceptance:** All six files exist; `npm run typecheck` (CI) passes; no cycles introduced.
- **verification commands (local):** `npm run lint`, `npm run typecheck`.

### Chunk 2 — `voice_profiles` migration + RLS + Drizzle schema

- **spec_sections:** §7.4, §12.1, §21.1, §24.6
- **files:**
  - `migrations/0327_voice_profiles.sql` (new)
  - `migrations/0327_voice_profiles.down.sql` (new)
  - `server/db/schema/voiceProfiles.ts` (new)
  - `server/config/rlsProtectedTables.ts` (modified — append entry)
- **logical responsibility:** Land the `voice_profiles` table + canonical RLS policy + Drizzle schema + RLS_PROTECTED_TABLES registration. Single capability: persistent voice profile storage with three-axis scoping.
- **module shape:**
  - *Public interface:* Drizzle `voiceProfiles` pgTable export; row type `VoiceProfile`; `InsertVoiceProfile`.
  - *Hidden:* CHECK constraints (exactly-one-of axis; refresh_policy values); RLS policy SQL body; partial indexes; the migration body itself.
- **contracts:**
  - Columns per spec §7.4.
  - RLS policy (canonical 4-clause form):
    ```sql
    CREATE POLICY voice_profiles_isolation ON voice_profiles
      USING (
        (owner_user_id IS NOT NULL AND owner_user_id = current_setting('app.current_user_id', true)::uuid)
        OR (subaccount_id IS NOT NULL AND subaccount_id = ANY(string_to_array(current_setting('app.current_subaccount_ids', true), ',')::uuid[]))
        OR (org_scope = true AND organisation_id = current_setting('app.organisation_id', true)::uuid)
        OR (current_setting('app.current_role', true) IN ('org_admin', 'subaccount_admin'))
      );
    ```
  - `RLS_PROTECTED_TABLES` entry: `{ table: 'voice_profiles', policyMigration: '0327_voice_profiles.sql' }`.
- **error handling:** None at this layer. 23505 (PK) and 23514 (CHECK violation) bubble through the service layer in chunk 12.
- **tests:** None (schema only).
- **dependencies:** Chunk 1.
- **acceptance:** Migration up + down idempotent; Drizzle types align; `RLS_PROTECTED_TABLES` entry exists; `verify-rls-coverage.sh` would pass (CI).
- **verification commands (local):** `npm run lint`, `npm run typecheck`, `npm run db:generate`.

### Chunk 3 — `ea_drafts` migration + RLS + Drizzle schema

- **spec_sections:** §7.5, §11.6, §18.2, §21.2, §24.3
- **files:**
  - `migrations/0328_ea_drafts.sql` (new)
  - `migrations/0328_ea_drafts.down.sql` (new)
  - `server/db/schema/eaDrafts.ts` (new)
  - `server/config/rlsProtectedTables.ts` (modified — append entry)
- **logical responsibility:** Land `ea_drafts` table with FK to `actions` (proposal primitive) + canonical RLS + Drizzle schema. Single capability: persistent EA-draft storage with send-state machine.
- **module shape:**
  - *Public interface:* Drizzle `eaDrafts` pgTable export; row type `EADraft`; `InsertEADraft`.
  - *Hidden:* FK migration ordering (actions table exists — guaranteed); RLS policy body; indexes; CHECK constraints for send-state and kind closure.
- **contracts:**
  - Columns: `id uuid PK`, `organisation_id uuid NOT NULL`, `subaccount_id uuid NOT NULL`, `owner_user_id uuid NOT NULL`, `agent_id uuid NOT NULL REFERENCES agents(id)`, `run_id uuid NOT NULL REFERENCES agent_runs(id)`, `proposal_action_id uuid NOT NULL REFERENCES actions(id) ON DELETE RESTRICT`, `kind text NOT NULL`, `target_ref jsonb NOT NULL`, `body jsonb NOT NULL`, `send_state text NOT NULL DEFAULT 'idle'`, `external_result_id text`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`.
  - CHECK `send_state IN ('idle','sending','sent','send_failed')`; CHECK `kind IN ('gmail_reply','gmail_new','slack_post','slack_dm','calendar_create','calendar_update','calendar_respond')`.
  - Indexes: `(organisation_id, owner_user_id, send_state)`, `(proposal_action_id)`, `(agent_id)`, `(run_id)`.
  - RLS policy: owner sees own; admin sees row but `body` redacted at API serialisation (chunk 6 + chunk 17).
- **error handling:** None at this layer.
- **tests:** None.
- **dependencies:** Chunk 1. Predecessor must have shipped `owner_user_id` columns. `actions` table is shipped (existing).
- **acceptance:** Migration up + down idempotent; FK enforces; partial-index works.
- **verification commands (local):** `npm run lint`, `npm run typecheck`, `npm run db:generate`.

### Chunk 4 — `external_source_triggers` migration + RLS + schema

- **spec_sections:** §7.1, §10.1, §10.9, §21.3, §24.1
- **files:**
  - `migrations/0329_external_source_triggers.sql` (new — may split per R2 mitigation)
  - `migrations/0329_external_source_triggers.down.sql` (new)
  - `server/db/schema/externalTriggerDedup.ts` (new)
  - `server/db/schema/agentTriggers.ts` (modified — extend `event_type` $type union)
  - `server/config/rlsProtectedTables.ts` (modified — append `external_trigger_dedup` entry)
- **logical responsibility:** Extend `agent_triggers.event_type` enum + create `external_trigger_dedup` table + register RLS. Single capability: idempotency ledger for external-source triggers.
- **module shape:**
  - *Public interface:* `externalTriggerDedup` pgTable; row type `ExternalTriggerDedup`; the 3 new enum literals on `AgentTriggerEventType`.
  - *Hidden:* enum-add migration ordering (must run outside transaction per R2); RLS policy body; composite PK definition.
- **contracts:**
  - Enum add via `ALTER TYPE agent_trigger_event_type ADD VALUE IF NOT EXISTS '<value>'` × 3. Builder verifies pattern against existing migrations.
  - `external_trigger_dedup` per §7.1: composite PK `(provider, dedup_key, owner_user_id)`; cols `provider text NOT NULL`, `dedup_key text NOT NULL`, `owner_user_id uuid NOT NULL`, `organisation_id uuid NOT NULL`, `subaccount_id uuid NOT NULL`, `fired_at timestamptz NOT NULL DEFAULT now()`, `trigger_id uuid`, `run_id uuid`.
  - RLS policy: `owner_user_id = current_user OR role IN ('org_admin', 'system_admin')`.
- **error handling:** PK violation = `ON CONFLICT DO NOTHING` semantics in service layer (chunk 9).
- **tests:** None.
- **dependencies:** Chunk 1.
- **acceptance:** Three enum values exist post-migration; `external_trigger_dedup` table accepts inserts with composite PK; RLS enforced.
- **verification commands (local):** `npm run lint`, `npm run typecheck`, `npm run db:generate`.

### Chunk 5 — OAuth provider + action registry rows + topic registry

- **spec_sections:** §8.1, §8.2, §9.1, §9.2, §10.6, §17
- **files:**
  - `server/config/oauthProviders.ts` (modified — add `google_calendar` entry; extend Slack scopes)
  - `server/config/actionRegistry.ts` (modified — add 6 Calendar + 6 Slack actions; register `'calendar'` + `'slack'` topics)
  - `server/config/topicRegistry.ts` (modified — add 2 new topic entries)
- **logical responsibility:** Register every new connector + action at the config layer. Single capability: action-registry surface for Calendar + Slack agent actions.
- **module shape:**
  - *Public interface:* Calendar + Slack action types appear in `ACTION_REGISTRY`; `requiredIntegration: 'google_calendar' | 'slack'`; new topics `'calendar'` + `'slack'`.
  - *Hidden:* Zod schema wiring; verify-shape config; retry policy config; idempotency posture config.
- **contracts:**
  - 6 Calendar action rows per spec §8.2 table.
  - 6 Slack action rows per spec §9.1 table — including `slack.post_message` Tier 6 review-gated and `slack.post_dm` Tier 6 dynamic-decision (auto when target=owner; review otherwise — decision in pure helper in chunk 8).
  - OAuth `google_calendar` entry per §8.1 with the three scopes; env vars `OAUTH_GOOGLE_CALENDAR_CLIENT_ID/_SECRET`.
  - Slack scope extension per Q2 decision (all 7 listed).
- **error handling:** Registry-level — type-system enforced.
- **tests:** None (registry config).
- **dependencies:** Chunk 1.
- **acceptance:** Every action has `riskTier`; `verify-risk-tier-assigned` (CI) would pass; topics registered; OAuth provider entries valid.
- **verification commands (local):** `npm run lint`, `npm run typecheck`.

### Chunk 6 — EA draft service + state machine + route + stall job extension

- **spec_sections:** §7.5, §11.6, §18.2, §20.4, §24.3
- **files:**
  - `server/services/eaDrafts/eaDraftService.ts` (new)
  - `server/services/eaDrafts/eaDraftServicePure.ts` (new)
  - `server/services/eaDrafts/eaDraftServicePure.test.ts` (new — Vitest)
  - `server/routes/eaDrafts.ts` (new)
  - `server/jobs/workflowGateStallNotifyJob.ts` (modified — handle EA-linked action rows)
- **logical responsibility:** EA-draft state machine + create-draft-with-proposal transactional helper + approval delegation + send-claim + retry. Single capability: post-approval send orchestration for EA drafts. **Build-order note:** relocated from old chunk 13 to chunk 6 per chatgpt-plan-review F1 (2026-05-12) so Calendar (chunk 7) + Slack (chunk 8) action services can compose against the send-claim path without a forward dependency.
- **module shape:**
  - *Public interface:* `eaDraftService.createDraftWithProposal({ kind, body, targetRef, agent, run, ctx })` -> `{ draftId, actionId }`; `claimSend(draftId)` -> `{ claimed: true } | { claimed: false, reason }`; `markSent(draftId, externalResultId)`; `markSendFailed(draftId)`; `retryFromFailed(draftId)`. Route: `GET /api/ea-drafts`, `GET /api/ea-drafts/:id`, `POST /api/ea-drafts/:id/approve`, `POST /api/ea-drafts/:id/reject`, `POST /api/ea-drafts/:id/retry`.
  - *Hidden:* `withOrgTx` for the dual-insert; optimistic predicate `UPDATE ea_drafts SET send_state = 'sending' WHERE id = $1 AND send_state = 'idle'`; FK to `actions` row; `actionService.transitionState` for approve/reject delegation.
  - Pure helpers: `canTransition(from, to)`, `computeExpiresAt(createdAt)`.
- **contracts:**
  - Send-state machine per §24.3 (`idle -> sending -> sent | send_failed`; `sending -> idle` for stall reset; `send_failed -> sending` for manual retry).
  - **Approval-state ownership invariant (F2/T1):** approval state is owned by the `actions` row (`actions.status: pending_approval -> approved | rejected | expired`). The `ea_drafts` row stores ONLY `send_state` (`idle -> sending -> sent | send_failed`). No code may read or write `ea_drafts.state` or check `ea_drafts.send_state = 'approved'` — those are never valid values.
  - Approval routing: `approve` route -> `actionService.transitionState(actionId, 'approved')` -> commit hook routes to the action handler for the draft's `kind` (Gmail send via existing send_email handler; Calendar write via chunk 7; Slack write via chunk 8).
  - Send-claim precondition (enforced inside the action handler, NOT in the route): handler MAY claim the send only when `actions.status = 'approved'` AND `ea_drafts.send_state = 'idle'`. Claim is the optimistic `UPDATE ea_drafts SET send_state = 'sending' WHERE id = $1 AND send_state = 'idle'` predicate (zero rows updated => `DRAFT_SEND_IN_FLIGHT` 409).
  - Stall-job extension: reads `actions WHERE status = 'pending_approval' AND suspend_until < now() AND metadata_json->>'kind' = 'ea_draft'`; transitions `actions` to `rejected` (expiry) and emits `proposal.expired` (existing event). Linked `ea_drafts.send_state` stays `idle`. 24h reminder fires via existing notification path.
- **error handling:** Typed `DRAFT_SEND_IN_FLIGHT` (409), `DRAFT_NOT_APPROVED` (422), `DRAFT_TERMINAL` (409), `DRAFT_NOT_FOUND` (404).
- **tests:** Vitest unit: `canTransition` (every transition + every forbidden transition); `computeExpiresAt` (createdAt + 7d deterministic).
- **dependencies:** Chunks 1, 3.
- **acceptance:** Drafts created with linked action row; state machine enforced; approval routes through `actionService`; stall job extension covers EA drafts. **Grep gate (code-only, CI-friendly):** `git grep -n -E "ea_drafts\\.state|state = 'approved'|sentMessageId" server/ shared/ client/` MUST return zero matches in current-state source. (plan.md is excluded — it documents the prohibition itself, so it intentionally contains the patterns inside "MUST NOT" rules; only code paths are scanned.)
- **verification commands (local):** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/eaDrafts/eaDraftServicePure.test.ts`, `npm run build:server`.

### Chunk 7 — Calendar action service + pure helpers + skill markdown

- **spec_sections:** §8.3, §8.4, §8.5, §8.6, §24.2, §24.3
- **files:**
  - `server/services/calendar/calendarActionService.ts` (new)
  - `server/services/calendar/calendarActionServicePure.ts` (new)
  - `server/services/calendar/calendarActionServicePure.test.ts` (new — Vitest)
  - `server/skills/calendar-list-events.md` + `calendar-get-event.md` + `calendar-find-free-slot.md` + `calendar-create-event.md` + `calendar-update-event.md` + `calendar-respond-to-invite.md` (new — 6 skill markdown files)
- **logical responsibility:** Implement Calendar action handlers + pure helpers. Single capability: agent-callable Calendar actions with draft-mediated write semantics.
- **module shape:**
  - *Public interface:* `calendarActionService.listEvents(input, ctx)`, `getEvent`, `findFreeSlot`, `createEvent(input, ctx)`, `updateEvent`, `respondToInvite` — each returns a typed result or throws a typed service error.
  - *Hidden:* Google client construction, broker credential resolution, error-mapping table, `extendedProperties.private.ea_draft_id` tagging, unknown-success recovery via `events.list?privateExtendedProperty=`, optimistic predicate against `ea_drafts.send_state`, retry/backoff.
- **contracts:**
  - Pure helpers per §8.5: `validateCreateEventInput`, `validateUpdateEventInput`, `validateRespondToInviteInput`, `deriveIdempotencyKey({ kind, ownerUserId, payload })`, `normaliseAttendees(attendees)`, `computeFreeSlots({ events, timeMin, timeMax, durationMinutes, workingHours })`.
  - Handler responsibilities per §8.4 (resolve credential via broker with `ownerUserId`, validate, idempotency, call Google with backoff, error map, Run Trace emit, write back `external_result_id` to `ea_drafts`).
  - Write actions REJECT calls without `eaDraftId` per §8.4 step 2 — typed `code: 'missing_draft_context'`, 422.
  - **Write-action invariant (F2 enforcement).** For `create_event`, `update_event`, `respond_to_invite`:
    1. Input MUST include `eaDraftId`. Missing → `MISSING_DRAFT_CONTEXT` (422).
    2. Handler loads the linked `ea_drafts` row and its `actions` proposal row inside a single read transaction.
    3. Handler MAY claim the send only when `actions.status = 'approved'` AND `ea_drafts.send_state = 'idle'`. Either precondition false → `DRAFT_NOT_APPROVED` (422) or `DRAFT_SEND_IN_FLIGHT` (409) respectively.
    4. Claim atomically via the optimistic predicate exported from `eaDraftService.claimSend(draftId)` (see chunk 6) — `UPDATE ea_drafts SET send_state = 'sending' WHERE id = $1 AND send_state = 'idle'`. Zero rows updated → `DRAFT_SEND_IN_FLIGHT` (409).
    5. Handler MUST NOT check for `ea_drafts.state = 'approved'`. Approval state is never stored on `ea_drafts`. The grep gate from chunk 6 enforces this across the codebase.
- **error handling:** Typed errors `MISSING_DRAFT_CONTEXT`, `DRAFT_NOT_APPROVED`, `DRAFT_SEND_IN_FLIGHT`, `CREDENTIAL_REVOKED`, `INSUFFICIENT_SCOPE`, `CONFLICT`, `STALE_ETAG`, `RATE_LIMITED`. HTTP mapping per §24.2 table.
- **tests:** Vitest unit (pure helpers only per §25.2): `validateCreateEventInput` (valid + invalid), `validateUpdateEventInput`, `validateRespondToInviteInput`, `deriveIdempotencyKey` (deterministic + collision-resistant), `normaliseAttendees` (dedup + lowercase + flag preservation), `computeFreeSlots` (empty + within-window + outside-hours).
- **dependencies:** Chunks 1, 5, 6. Predecessor broker extension required.
- **acceptance:** All 6 actions registered + handled; pure helpers unit-tested; skill markdown files contain YAML frontmatter with action slug + risk tier + default gate; build-server compiles; write-action invariant (F2) enforced — handler refuses send unless `actions.status = 'approved'` AND `ea_drafts.send_state = 'idle'`.
- **verification commands (local):** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/calendar/calendarActionServicePure.test.ts`, `npm run build:server`.

### Chunk 8 — Slack action service + pure helpers + skill markdown

- **spec_sections:** §9.3, §9.4, §9.5, §9.6, §24.2, §24.3
- **files:**
  - `server/services/slack/slackActionService.ts` (new)
  - `server/services/slack/slackActionServicePure.ts` (new)
  - `server/services/slack/slackActionServicePure.test.ts` (new — Vitest)
  - `server/skills/slack-list-channels.md` + `slack-read-channel.md` + `slack-search-messages.md` + `slack-summarise-thread.md` + `slack-post-message.md` + `slack-post-dm.md` (new — 6 skill markdown files)
- **logical responsibility:** Implement Slack action handlers + pure helpers including the auto-send-scope decision. Single capability: agent-callable Slack actions with V1 fixed send policy.
- **module shape:**
  - *Public interface:* `slackActionService.listChannels`, `readChannel`, `searchMessages`, `summariseThread`, `postMessage`, `postDm` — typed result or typed error.
  - *Hidden:* Slack Web API client + scopes; `client_msg_id` idempotency; `actionService.proposeAction` + `eaDraftService.createDraftWithProposal` co-creation when `decideAutoSendScope === 'review'`; plan-tier downgrade detection.
- **contracts:**
  - Pure helper `decideAutoSendScope({ action, target, ownerUserId })` per §9.3:
    - `post_message` -> always `'review'`
    - `post_dm` + `target === ownerUserId` -> `'auto'`
    - `post_dm` + `target !== ownerUserId` -> `'review'`
  - `validatePostMessageInput`, `validatePostDmInput`, `deriveIdempotencyKey`, `assembleThreadSummaryPrompt` per §9.5.
  - When decision = `'review'`, handler creates BOTH the `actions` row (via `actionService.proposeAction`) AND the `ea_drafts` row (via `eaDraftService.createDraftWithProposal` from chunk 6) in the same `withOrgTx` block. When `'auto'`, handler calls Slack directly.
  - **Write-action invariant (F2 enforcement)** for review-gated writes (`post_message`, non-owner `post_dm`): handler MAY claim the send only when `actions.status = 'approved'` AND `ea_drafts.send_state = 'idle'`. Claim via `eaDraftService.claimSend(draftId)`. Handler MUST NOT check `ea_drafts.state = 'approved'` — approval state is never stored on `ea_drafts`.
  - `PLAN_NOT_SUPPORTED` typed error for `searchMessages` when Slack returns `not_allowed_token_type` / `missing_scope` / `team_not_authorized`.
- **error handling:** Typed errors per spec + `PLAN_NOT_SUPPORTED` + `DRAFT_SEND_IN_FLIGHT` + `DRAFT_NOT_APPROVED`.
- **tests:** Vitest unit: `decideAutoSendScope` (full matrix — 2 actions × 3 targets including owner / non-owner-user / channel-id, plus negative cases), `validatePostMessageInput`, `validatePostDmInput`, `deriveIdempotencyKey`, `assembleThreadSummaryPrompt`.
- **dependencies:** Chunks 1, 3, 5, 6 (eaDraftService).
- **acceptance:** All 6 actions registered + handled; pure helpers unit-tested; skill markdown files complete; build-server compiles; write-action invariant (F2) enforced for review-gated paths.
- **verification commands (local):** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/slack/slackActionServicePure.test.ts`, `npm run build:server`.

### Chunk 9 — External-source triggers service + Slack webhook extension

- **spec_sections:** §10.1, §10.2, §10.3, §10.6, §10.7, §10.9, §24.1
- **files:**
  - `server/services/triggers/externalSourceTriggers.ts` (new)
  - `server/services/triggers/externalSourceTriggersPure.ts` (new)
  - `server/services/triggers/externalSourceTriggersPure.test.ts` (new — Vitest)
  - `server/services/triggerService.ts` (modified — extend `eventType` union per §10.1)
  - `server/routes/webhooks/slackWebhook.ts` (modified — add `url_verification` handler; `app_mention` no-op for V1)
- **logical responsibility:** Implement the dispatch surface from raw external events into `triggerService.fireTriggers`. Plus the Slack URL-verification handshake. Single capability: external-source trigger ingestion + dispatch.
- **module shape:**
  - *Public interface:* `externalSourceTriggers.dispatch(event: ExternalSourceTriggerEvent): Promise<DispatchResult>` — discriminated on `eventType`; returns `{ outcome: 'fired' | 'dedup_hit' | 'rate_capped' | 'owner_unresolved' | 'owner_mismatch', triggerId?, runId? }`.
  - *Hidden:* dedup-row insert with ON CONFLICT; owner-user resolution via `integration_connections.owner_user_id`; rate-cap check via existing `MAX_TRIGGERED_RUNS_PER_MINUTE` plus new `MAX_EXTERNAL_TRIGGERED_RUNS_PER_MINUTE_PER_OWNER = 10`; `trigger.suppressed` event emission per §10.7.
  - Pure helpers: `deriveDedupKey(event)` per §7.1, `computeCalendarLookahead({ event, now, lookaheadMinutes })`.
- **contracts:**
  - Slack webhook route extension: handle `payload.type === 'url_verification'` by echoing `challenge`; `payload.type === 'event_callback' && event.type === 'app_mention'` returns 200 immediately with no internal dispatch (V1 no-op per §10.2 deferred).
  - Existing `block_actions` (approval) path preserved.
- **error handling:** Webhook returns 200 even on dedup-hit; 4xx only on signature/payload failure; trigger dispatch failure emits `trigger.suppressed`.
- **tests:** Vitest unit: `deriveDedupKey` per-event-type shape (Gmail = messageId; Calendar = `calendarId@eventId@startAt@lookaheadMinutes`; Slack = slack_event_id); `computeCalendarLookahead` (within/outside window; edge cases).
- **dependencies:** Chunks 1, 4.
- **acceptance:** Slack URL-verification works; `app_mention` events are no-op'd; dispatch surface parametric in event type; rate-cap honoured.
- **verification commands (local):** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/triggers/externalSourceTriggersPure.test.ts`, `npm run build:server`.

### Chunk 10 — Gmail polling job + Calendar lookahead job

- **spec_sections:** §10.4, §10.5, §24.4, §24.5
- **files:**
  - `server/jobs/gmailInboxPollJob.ts` (new)
  - `server/jobs/calendarLookaheadJob.ts` (new)
  - `server/config/limits.ts` (modified — add `CALENDAR_LOOKAHEAD_MINUTES = 15`, `MAX_EXTERNAL_TRIGGERED_RUNS_PER_MINUTE_PER_OWNER = 10`, `CALENDAR_LOOKAHEAD_FALLBACK_INTERVAL_MS`)
- **logical responsibility:** Implement the two background pollers that produce external-source trigger events. Single capability: scheduled discovery + dispatch into `externalSourceTriggers`.
- **module shape:**
  - *Public interface:* pg-boss job handlers; per-connection cron schedule registered by `recurringTasksService` at provisioning time (chunk 15 wizard provisioning).
  - *Hidden:* advisory-lock acquisition (`pg_try_advisory_lock`); `last_history_id` JSON-config read/write on `integration_connections.config_json`; Gmail `users.history.list` call; Calendar `events.list` call with `singleEvents=true`; 429 cadence-fallback logic.
- **contracts:**
  - Gmail: advisory-lock `('gmail_poll', integration_connection_id)`; read `lastHistoryId`; `users.history.list?startHistoryId=...&historyTypes=messageAdded`; emit per-message `gmail_message_received` events; persist new `lastHistoryId`.
  - Calendar: advisory-lock `('calendar_lookahead', integration_connection_id)`; resolve credential via broker; `events.list?calendarId=primary&timeMin=now&timeMax=now+15m&singleEvents=true&orderBy=startTime`; for each event, compute dedup-key per §7.1, insert into `external_trigger_dedup` ON CONFLICT DO NOTHING; emit `calendar_event_imminent` for new rows.
  - Default cadences: Gmail 5 min; Calendar 1 min, fallback 5 min on sustained 429.
- **error handling:** 401/403 -> mark connection `expired`; 429 -> backoff/fallback; 5xx -> pg-boss retry config; advisory-lock contention -> no-op return.
- **tests:** None at unit level (pure helper `computeCalendarLookahead` was authored in chunk 9). Job-level behaviour verified manually + CI integration.
- **dependencies:** Chunks 1, 4, 9.
- **acceptance:** Both jobs run via pg-boss; single-writer-per-connection enforced; cadence fallback works; 401 surfaces correct connection status flip.
- **verification commands (local):** `npm run lint`, `npm run typecheck`, `npm run build:server`.

### Chunk 11 — `capabilityGroups.ts` + integration-reference slug additions

- **spec_sections:** §17.1, §17.2, §17.3, §17.4
- **files:**
  - `server/config/capabilityGroups.ts` (new)
  - `docs/integration-reference.md` (modified — add Calendar + new Slack capability slugs per Q10)
- **logical responsibility:** Add the UI capability-grouping layer over the existing capability taxonomy. Single capability: wizard + connections-page capability presentation.
- **module shape:**
  - *Public interface:* `CAPABILITY_GROUPS` constant exporting the 4 user-facing groups.
  - *Hidden:* runtime cross-check that every referenced slug exists in `integration-reference.md`.
- **contracts:**
  - `CAPABILITY_GROUPS = { email, calendar, files, team_chat }` with 4 groups per §17.2.
  - New slugs: `calendar_read`, `calendar_event_create`, `calendar_event_update`, `calendar_event_respond` (Google Calendar); `channel_messages_read`, `channel_post_message`, `channel_search_messages`, `dm_send` (Slack).
- **error handling:** None (config + UI rendering).
- **tests:** None.
- **dependencies:** Chunks 1, 5.
- **acceptance:** `verify-integration-reference.ts` (CI) passes; all slugs cross-referenced.
- **verification commands (local):** `npm run lint`, `npm run typecheck`.

### Chunk 12 — VoiceProfile service + samplers

- **spec_sections:** §12.1, §12.2, §12.3, §12.6, §12.7, §24.6, §24.7
- **files:**
  - `server/services/voiceProfile/voiceProfileService.ts` (new)
  - `server/services/voiceProfile/voiceProfileServicePure.ts` (new)
  - `server/services/voiceProfile/voiceProfileServicePure.test.ts` (new — Vitest)
  - `server/services/voiceProfile/samplers/gmailSentSampler.ts` (new)
  - `server/services/voiceProfile/samplers/driveDocSampler.ts` (new)
- **logical responsibility:** Voice-profile derivation, refresh, opt-out, samplers. Single capability: persistent voice-profile lifecycle (refresh job split into 11b for size compliance).
- **module shape:**
  - *Public interface:* `voiceProfileService.deriveProfile({ profileId, ctx })`, `refreshProfile({ profileId, force })`, `getProfile({ profileId })`, `optOut({ profileId })`, `reactivate({ profileId })`. Sampler interface `VoiceSampler.sample(config, ctx) -> Promise<{ samples, sampleSize }>`.
  - *Hidden:* state-machine predicate `UPDATE ... SET state = 'deriving' WHERE state IN ('pending','ready','failed')`; feature distillation; sampler dispatch; the in-memory-only sample lifecycle (samples never persisted).
  - Pure helpers: `distilFeatures(samples)` (greeting/signoff freq, sentence-length stats, formality, em-dash, common phrases, signature); `shouldRefresh({ profile, now })`.
- **contracts:**
  - State machine per §24.6: `pending -> deriving -> ready | failed`; manual retry `failed -> pending -> deriving`.
  - Sampler return type does NOT persist `samples[*].text` — risk R5 mitigation.
- **error handling:** Typed `DERIVATION_IN_PROGRESS`, `SAMPLER_EMPTY`, `OWNER_MISMATCH` (broker bubbling).
- **tests:** Vitest unit (pure): `distilFeatures` determinism + edge cases (multi-ordering per §8.21); `shouldRefresh` periodic + manual (and `on_send_count` always false in V1).
- **dependencies:** Chunks 1, 2.
- **acceptance:** State machine respected; samplers return samples without persisting; pure helpers tested.
- **verification commands (local):** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/voiceProfile/voiceProfileServicePure.test.ts`.

### Chunk 12b — VoiceProfile refresh job

- **spec_sections:** §12.5, §22.2
- **files:**
  - `server/jobs/voiceProfileRefreshJob.ts` (new)
- **logical responsibility:** Nightly pg-boss job; finds rows whose refresh threshold has triggered; invokes `voiceProfileService.refreshProfile`. Split out from chunk 12 to keep chunk-size compliance (chunk 12 is at 5 files).
- **module shape:**
  - *Public interface:* pg-boss handler.
  - *Hidden:* refresh-policy threshold query (uses `voiceProfileServicePure.shouldRefresh`).
- **contracts:** Schedule nightly; processes rows where `refresh_policy = 'periodic' AND last_derived_at + (refresh_config->>'days')::int days < now() AND opt_out_at IS NULL`.
- **error handling:** Per-row try/catch; one row's failure does not block others.
- **tests:** None (job-level).
- **dependencies:** Chunk 12.
- **acceptance:** Job registered; runs nightly; respects opt-out.
- **verification commands (local):** `npm run lint`, `npm run typecheck`.

### Chunk 13 — VoiceProfile route + prompt-assembly extension

- **spec_sections:** §12.4, §22.3
- **files:**
  - `server/routes/voiceProfiles.ts` (new)
  - `server/services/agentExecutionServicePure.ts` (modified — inject `<voice>` block per §12.4)
- **logical responsibility:** API surface for voice profiles + prompt-time consumption. Single capability: voice profile read + write + opt-out + run-time injection.
- **module shape:**
  - *Public interface:* `GET /api/voice-profiles`, `GET /api/voice-profiles/:id`, `POST /api/voice-profiles/:id/refresh`, `POST /api/voice-profiles/:id/opt-out`, `POST /api/voice-profiles/:id/reactivate`. Plus the prompt-assembly helper `assembleVoiceBlock(profile)` that returns a string when `state = 'ready' AND opt_out_at IS NULL`, else null.
  - *Hidden:* `withOrgTx` wrappers; `requirePermission('VOICE_PROFILE_READ' | 'VOICE_PROFILE_WRITE')` gates; SOT check `optOutAt IS NULL AND state = 'ready'` against the agent's memory-block-linked profile id per §12.4 SOT.
- **contracts:**
  - Route uses `asyncHandler`.
  - Prompt-assembly extension reads memory_block `ea.voice_profile_id` -> resolves profile via `voiceProfileService.getProfile` -> conditionally appends `<voice>...</voice>` block to `stablePrefix` cache partition per §22.3.
  - Memory-block-based attachment per §12.4 SOT clarification — no new column on `agents`.
- **error handling:** 404 if profile not found; 403 if not own (RLS catches); 422 on bad payload.
- **tests:** None at unit level — `assembleVoiceBlock` is a small string template; behaviour verified by integration test in chunk 18 + manual.
- **dependencies:** Chunks 1, 2, 12.
- **acceptance:** Route returns profile; opt-out blocks consumption; prompt-assembly respects state.
- **verification commands (local):** `npm run lint`, `npm run typecheck`, `npm run build:server`.

### Chunk 13a — Permissions keys (pre-load)

- **spec_sections:** §21.5, Q8
- **files:**
  - `server/lib/permissions.ts` (modified — add 6 new permission keys per §21.5)
- **logical responsibility:** Pre-register all EA V1 permission keys before any service layer chunk references them. Single capability: permission-registry surface. **Build-order note (round-2 F1):** extracted from old Chunk 17 so Chunk 14 (home-widget service) can call `requirePermission('HOME_WIDGET_READ')` without a forward dependency on Chunk 17.
- **module shape:**
  - *Public interface:* 6 new `Permission` enum members exported from `server/lib/permissions.ts`: `VOICE_PROFILE_READ`, `VOICE_PROFILE_WRITE`, `EA_DRAFT_READ`, `EA_DRAFT_DECIDE`, `HOME_WIDGET_READ`, `EA_PROVISION`.
  - *Hidden:* `ALL_PERMISSIONS` array updates; default-role-grant map updates per Q8.
- **contracts:**
  - All six keys added to the `Permission` union and `ALL_PERMISSIONS` constant.
  - `EA_PROVISION` default-granted to every user (Q8 decision).
  - No admin-only keys.
- **error handling:** None.
- **tests:** None.
- **dependencies:** Chunk 1.
- **acceptance:** `requirePermission('HOME_WIDGET_READ')` resolvable at typecheck without error; all 6 keys in `ALL_PERMISSIONS`; `npm run typecheck` passes.
- **verification commands (local):** `npm run lint`, `npm run typecheck`.

### Chunk 13b — `system_agents.home_widget` schema primitive

- **spec_sections:** §7.6, §13.1
- **files:**
  - `migrations/0330_system_agents_home_widget.sql` (new — generic column add only)
  - `migrations/0330_system_agents_home_widget.down.sql` (new — refuses to drop column while non-NULL rows exist)
  - `server/db/schema/systemAgents.ts` (modified — add `homeWidget: jsonb('home_widget').$type<HomeWidgetDeclaration | null>()`)
- **logical responsibility:** Add the generic `system_agents.home_widget` nullable jsonb column + its refuse-to-drop down-script guard + the Drizzle field that Chunk 14 queries. **Build-order note (round-2 F2):** extracted from old Chunk 15 so Chunk 14 (home-widget service) can join against `system_agents.home_widget` without a forward dependency on the EA seed chunk.
- **module shape:**
  - *Public interface:* `systemAgents` Drizzle table gains `homeWidget` field; column queryable across all `system_agents` rows.
  - *Hidden:* migration guard SQL; the fact that only 0330 touches the DDL (0331 only inserts data).
- **contracts:**
  - `ALTER TABLE system_agents ADD COLUMN IF NOT EXISTS home_widget jsonb` — nullable, default NULL.
  - Down-script refuses to drop the column while any `system_agents` row has `home_widget IS NOT NULL`. Body: `DO $$ BEGIN IF EXISTS (SELECT 1 FROM system_agents WHERE home_widget IS NOT NULL) THEN RAISE EXCEPTION 'Cannot drop system_agents.home_widget while rows still use it'; END IF; ALTER TABLE system_agents DROP COLUMN IF EXISTS home_widget; END $$;`.
  - Drizzle field: `homeWidget: jsonb('home_widget').$type<HomeWidgetDeclaration | null>()` — typed, not `any`.
- **error handling:** Down-script raises a `RAISE EXCEPTION` when guard condition triggered.
- **tests:** None (schema only).
- **dependencies:** Chunk 1.
- **acceptance:** Column nullable, default NULL; down-script guard fires when tested with a non-NULL row (verify by inserting a test row + invoking down + expecting the exception); Drizzle type aligns; `npm run db:generate` produces no drift.
- **verification commands (local):** `npm run lint`, `npm run typecheck`, `npm run db:generate`.

### Chunk 14 — Home-widget service + route + body-provider skill

- **spec_sections:** §7.6, §7.7, §19
- **files:**
  - `server/services/homeWidget/homeWidgetService.ts` (new)
  - `server/services/homeWidget/homeWidgetServicePure.ts` (new)
  - `server/services/homeWidget/homeWidgetServicePure.test.ts` (new — Vitest)
  - `server/routes/agentHomeWidgets.ts` (new)
  - `server/skills/ea-home-widget-summary.md` (new)
- **logical responsibility:** Read user-owned agents for current user, invoke each template's `bodyProviderSkill`, return ordered `WidgetData[]`. Single capability: home Personal zone data source.
- **module shape:**
  - *Public interface:* `homeWidgetService.getWidgets({ userId, subaccountId, ctx })` -> `Array<{ agentId, agentName, widgetData }>`. Route `GET /api/agent-home-widgets`.
  - *Hidden:* per-agent system_agent join; null-`home_widget` skip; skill-invocation primitive call; per-agent error isolation (one skill failure does NOT block others — degraded card).
  - Pure helpers: `orderAgents(agents)` (stable createdAt ASC), `shouldRefetch({ refreshPolicy, lastFetchedAt, now })`.
- **contracts:**
  - EA's body skill `ea.home_widget.summary` returns `summary_card` per §19.4. Data sources: draft count = `actions WHERE status = 'pending_approval' AND metadata_json->>'kind' = 'ea_draft' AND agent_id = $eaAgentId`; latest briefing = `agent_runs WHERE agent_id = $eaAgentId AND trigger_context->>'eventType' = 'daily_briefing' ORDER BY started_at DESC LIMIT 1`; upcoming `calendar_event_imminent` queue.
  - NO LLM call in the body skill (pure data read per §19.4).
- **error handling:** Per-skill try/catch; failed skill -> degraded card data `{ type: 'summary_card', primaryLine: 'Status unavailable', secondaryLines: [], openLink }`.
- **tests:** Vitest unit: `orderAgents` (stable sort + multiple input orderings per DG §8.21), `shouldRefetch` (every-5m + on-login + on-demand).
- **dependencies:** Chunks 1, 13a (permissions), 13b (home_widget column + Drizzle field).
- **acceptance:** Route returns widgets; per-agent isolation works; pure helpers tested.
- **verification commands (local):** `npm run lint`, `npm run typecheck`, `npx vitest run server/services/homeWidget/homeWidgetServicePure.test.ts`.

### Chunk 15a — Workflow skills (briefing, triage, prep)

- **spec_sections:** §11.1, §11.2, §11.3, §11.4
- **files:**
  - `server/skills/ea-daily-briefing.md` (new)
  - `server/skills/ea-inbox-triage.md` (new)
  - `server/skills/ea-meeting-prep.md` (new)
- **logical responsibility:** Author the three V1 workflow skills as markdown files (per spec §11; bodies live entirely in markdown — no separate `.ts` workflow modules per §23.2 chunk-23 footnote). Single capability: V1 workflow trio. **Build-order note (round-2 F3):** moved before Chunk 15 (EA seed) so that `default_org_skill_slugs` in `0331_executive_assistant_seed.sql` references skill slugs (`ea.daily_briefing`, `ea.inbox_triage`, `ea.meeting_prep`) that already exist on disk.
- **module shape:**
  - *Public interface:* skill slugs `ea.daily_briefing`, `ea.inbox_triage`, `ea.meeting_prep`. YAML frontmatter declares allowed actions + risk-tier ceiling.
  - *Hidden:* skill body prose that orchestrates `list_events`, `read_inbox`, `slack.search_messages`, `slack.post_dm`, voice-profile-aware prompt assembly, `actionService.proposeAction` + `eaDraftService.createDraftWithProposal` for review-gated sends.
- **contracts:** Per §11.1, §11.2, §11.3 — each workflow has named steps; outputs are user-facing summaries OR draft creations.
- **error handling:** Failure paths per §20 (auth-expired, timeout, partial). Each workflow emits `workflow.started` at entry and exactly one of `workflow.completed | workflow.failed | workflow.partial` at terminal.
- **tests:** None at unit level (skill markdown is declarative). Behaviour verified by manual run during Phase 3.
- **dependencies:** Chunks 7, 8 (Calendar/Slack actions referenced in skill body). Chunk 13 (voice block referenced).
- **acceptance:** Three markdown files exist with valid YAML frontmatter; each cites the correct actions; skill-verify CI passes.
- **verification commands (local):** `npm run lint`, `npm run typecheck`.

### Chunk 15 — EA system-agent template seed migration + `c.ts` entry

- **spec_sections:** §13.1, §13.2, §13.3, §13.4, §13.5, §13.6, §13.7
- **files:**
  - `migrations/0331_executive_assistant_seed.sql` (new — EA-specific seed + partial index)
  - `migrations/0331_executive_assistant_seed.down.sql` (new — deletes EA row + drops EA-only index; never touches the generic column)
  - `server/config/c.ts` (modified — add EA entry to `SUBACCOUNT_AGENTS`)
- **logical responsibility:** Insert the EA system-agent template row via `0331_executive_assistant_seed.sql` and wire the `c.ts` registry entry. The generic `system_agents.home_widget` column DDL + `systemAgents.ts` Drizzle field were extracted to Chunk 13b (round-2 F2). Single capability: EA template availability + safe rollback contract.
- **module shape:**
  - *Public interface:* The new `system_agents` row queryable by `slug = 'executive-assistant'`; `SUBACCOUNT_AGENTS` array entry consumed by registry.
  - *Hidden:* migration body with the full system-prompt text (Q6 above), default skill allowlist, default approval policy JSONB, `home_widget` JSONB value. The `home_widget` column DDL lives in Chunk 13b (migration 0330); this chunk only populates the column on the EA row.
- **contracts:**
  - `home_widget jsonb` column is already present (added by 0330 in chunk 13b). Migration 0331 only INSERTs the EA row + creates the EA-only partial index; never touches the column DDL.
  - 0331 down-script: `DROP INDEX IF EXISTS agents_personal_assistant_per_user_idx; DELETE FROM system_agents WHERE slug = 'executive-assistant';` — never touches the column itself.
  - Seed row: slug `'executive-assistant'`, name `'Personal Assistant'`, agent_role `'Specialist'`, execution_scope `'subaccount'`, `master_prompt` per Q6 canonical text, `default_org_skill_slugs` includes the 24+ skills per §13.2, `home_widget` populated per §13.1.
  - Partial unique index `agents_personal_assistant_per_user_idx ON agents(subaccount_id, owner_user_id) WHERE slug = 'executive-assistant' AND deleted_at IS NULL` — defence-in-depth concurrency guard per §13.4.
  - No per-user EA agent row at seed time (Q9 decision).
- **error handling:** Migration layer raises `RAISE EXCEPTION` on the 0330 down-script guard if any non-NULL `home_widget` row exists.
- **tests:** None.
- **dependencies:** Chunks 6, 7, 8, 12, 13b (home_widget column landed), 14, 15a (workflow skill files exist before seed references their slugs).
- **acceptance:** 0331 up creates the EA row + partial index; 0331 down removes ONLY those two artefacts (column untouched). `c.ts` mirror matches; `default_org_skill_slugs` references `ea.daily_briefing`, `ea.inbox_triage`, `ea.meeting_prep` — all three markdown files exist (from 15a).
- **verification commands (local):** `npm run lint`, `npm run typecheck`, `npm run db:generate`.

### Chunk 16 — RETIRED (merged into Chunk 15a)

**Round-2 F3 (2026-05-12):** Chunk 16 content (3 workflow skill markdown files) was renamed Chunk 15a and moved BEFORE Chunk 15 (EA seed) to eliminate the circular dependency where the seed migration referenced skill slugs not yet on disk. See [Chunk 15a](#chunk-15a--workflow-skills-briefing-triage-prep) above.

### Chunk 17 — Telemetry event registry + RLS_PROTECTED_TABLES wrap-up

- **spec_sections:** §10.7, §11.4, §24.3, §24.6
- **files:**
  - `shared/types/agentExecutionLog.ts` (modified — add criticality entries per Q11)
  - `server/config/rlsProtectedTables.ts` (verify final state — entries appended across chunks 2/3/4)
- **logical responsibility:** Land the telemetry criticality entries + verify the `RLS_PROTECTED_TABLES` array is complete across all three new tables. Permission keys were extracted to Chunk 13a (round-2 F1). Single capability: telemetry + RLS-coverage completeness.
- **module shape:**
  - *Public interface:* 14 new criticality entries in `AGENT_EXECUTION_EVENT_CRITICALITY`.
  - *Hidden:* verification that all three new table entries (`voice_profiles`, `ea_drafts`, `external_trigger_dedup`) are present in `RLS_PROTECTED_TABLES`.
- **contracts:**
  - Criticality entries per Architecture-notes "Telemetry events introduced" list above.
  - `RLS_PROTECTED_TABLES` has entries for `voice_profiles` (chunk 2), `ea_drafts` (chunk 3), `external_trigger_dedup` (chunk 4) — this chunk verifies, does NOT re-add.
- **error handling:** None.
- **tests:** None.
- **dependencies:** Chunks 2, 3, 4 (RLS_PROTECTED_TABLES entries land in each).
- **acceptance:** `verify-rls-coverage.sh` (CI) passes; `verify-rls-contract-compliance.sh` (CI) passes; all 14 criticality entries present.
- **verification commands (local):** `npm run lint`, `npm run typecheck`.

### Chunk 18 — Integration test — credential isolation

- **spec_sections:** §15, §25.3
- **files:**
  - `tests/integration/userOwnedAgentCredentialIsolation.test.ts` (new — Vitest)
- **logical responsibility:** Prove that the broker's owner-scoping resolves the right credential per user, and a cross-fetch raises `OWNER_MISMATCH`. Single capability: regression test for the most critical safety invariant.
- **module shape:**
  - *Public interface:* one Vitest test file.
  - *Hidden:* Postgres setup via existing `rls.context-propagation.test.ts` precedent; two users in one subaccount; each provisions an EA; each has a Gmail connection; cross-fetch attempts via `injectIntoEnvironment`.
- **contracts:** Asserts `broker.injectIntoEnvironment({ ownerUserId: userA, ... })` returns User A's connection; `{ ownerUserId: userB, ... }` returns User B's; attempting User A's connection while broker resolves User B's `agent.owner_user_id` -> typed `OWNER_MISMATCH`.
- **error handling:** Test asserts on typed error.
- **tests:** This IS the test.
- **dependencies:** Predecessor primitives MERGED; chunks 2, 3, 6, 12, 15 for the EA template to provision.
- **acceptance:** Test passes locally via `npx vitest run tests/integration/userOwnedAgentCredentialIsolation.test.ts`.
- **verification commands (local):** `npm run lint`, `npm run typecheck`, `npx vitest run tests/integration/userOwnedAgentCredentialIsolation.test.ts`.

### Chunk 19 — Client UI — hooks + sidebar + routes + pages

Split into three sub-chunks (19a, 19b, 19c) for chunk-size compliance.

#### Chunk 19a — Hooks

- **spec_sections:** §14.1, §14.2, §14.3, §14.4
- **files:**
  - `client/src/hooks/useUserOwnedAgents.ts` (new)
  - `client/src/hooks/useHomeWidgets.ts` (new)
  - `client/src/hooks/useVoiceProfile.ts` (new)
  - `client/src/hooks/useEADrafts.ts` (new)
- **logical responsibility:** React-Query hooks for the 4 data sources. Single capability: client-side data layer for Personal-zone surfaces.
- **module shape:**
  - *Public interface:* `useUserOwnedAgents()`, `useHomeWidgets()`, `useVoiceProfile(profileId?)`, `useEADrafts()` — each returns `{ data, isLoading, error, refetch }` plus mutation helpers where applicable.
  - *Hidden:* React-Query key shapes, invalidation rules, optimistic update patterns.
- **contracts:** Each hook calls the corresponding API route (chunks 6, 13, 14); queries scoped by `current_user.id` via the existing session context.
- **error handling:** React-Query `error` field surfaces typed errors; consumers render inline error chips.
- **tests:** None.
- **dependencies:** Chunks 6, 13, 14.
- **acceptance:** All hooks return data when authenticated; empty arrays when no user-owned agents.
- **verification commands (local):** `npm run lint`, `npm run typecheck`, `npm run build:client`.

#### Chunk 19b — Sidebar + routes + ConnectionsPage chip

- **spec_sections:** §14.1, §14.5, §16.4
- **files:**
  - `client/src/config/sidebar.ts` (modified — Personal nav group)
  - `client/src/config/routes.ts` (modified — `/personal/setup`, `/personal/:agentId`, `/personal/:agentId/setup`)
  - `client/src/pages/govern/ConnectionsPage.tsx` (modified — Personal/Subaccount chip; capability-group rendering)
- **logical responsibility:** Wire navigation + routes + connection chip. Single capability: app-shell awareness of personal agents.
- **module shape:**
  - *Public interface:* Personal nav group rendered when `useUserOwnedAgents()` non-empty; new routes registered; Personal chip on `integration_connections.owner_user_id IS NOT NULL` rows; capability groups rendered using `CAPABILITY_GROUPS` from chunk 11.
- **contracts:** Sidebar group hidden when hook returns empty. Route `/personal/setup` -> wizard; `/personal/:agentId` -> tabbed shell; `/personal/:agentId/setup` -> edit-setup re-entry.
- **error handling:** Hook errors -> degraded UI (no Personal group rendered).
- **tests:** None.
- **dependencies:** Chunks 11, 19a.
- **acceptance:** Nav group toggles correctly; routes resolve; chip renders per ownership.
- **verification commands (local):** `npm run lint`, `npm run typecheck`, `npm run build:client`.

#### Chunk 19c — Pages + components

- **spec_sections:** §14.2, §14.3, §14.4, §14.7, §14.8, §14.9, §19.5
- **files:**
  - `client/src/pages/personal/PersonalAssistantPage.tsx` (new — tabbed shell)
  - `client/src/pages/personal/EAFirstRunWizard.tsx` (new — wizard)
  - `client/src/components/personal/PersonalZoneCard.tsx` (new — card frame)
  - `client/src/pages/home/HomePage.tsx` (modified — Personal zone at top)
- **logical responsibility:** Render the 3 new user-facing surfaces matching the locked mockups. Single capability: user-facing pages for the Personal experience.
- **module shape:**
  - *Public interface:* React components consumed by the router.
  - *Hidden:* mockup-matching styles; tab logic; wizard step state; provisioning POST payload assembly; OAuth-flow integration during wizard.
- **contracts:**
  - `PersonalAssistantPage` tabs: Workspace (drafts list + JOIN to action approval state), Activity (run history with redaction), Settings (display name, voice profile status, briefing target, briefing time, auto-send static text per spec §9.3, trigger schedule overrides, memory edit).
  - `EAFirstRunWizard` renders the locked mockup `01-first-run-setup.html`; submission posts to a new wizard endpoint (route added inline here — `POST /api/personal/setup` — handled by `eaProvisioningService` in `server/services/eaProvisioningService.ts`; this service is small and lives implicitly inside chunk 15's seed-migration follow-on but is authored here to keep the wizard self-contained).
  - `HomePage` renders `PersonalZoneCard[]` from `useHomeWidgets()` plus an empty-state "Set up my Personal Assistant" card when the user has no user-owned agents.
  - CLAUDE.md user preferences: NO em-dashes in UI copy; NO emojis.
- **error handling:** Loading state -> skeleton shells; error -> inline chip + retry; empty -> CTA card.
- **tests:** None at unit level (visual; covered by manual verification per spec §25.5).
- **dependencies:** Chunk 19b.
- **acceptance:** Pages render; tabbed shell switches tabs; wizard submission creates EA agent + memory blocks + voice profile (if requested) + RRULE rows + agent_triggers rows + recurring poll job + recurring calendar lookahead job per §13.4; home page renders Personal zone or empty-state CTA.
- **manual verification (operator-led, NOT a CI test):** visual diff against `prototypes/personal-assistant-v1/01-first-run-setup.html`, `02-my-ea-home.html`, `03-ea-settings.html`.
- **verification commands (local):** `npm run lint`, `npm run typecheck`, `npm run build:client`.

**Note on the wizard endpoint.** The `POST /api/personal/setup` route is authored as part of chunk 19c rather than a separate "wizard route" chunk because:
1. The wizard's server-side flow is short (advisory-lock acquisition, agent row insert, seed memory blocks, optional voice profile row + derive enqueue, RRULE seeds, trigger row seeds, recurring poll job registration).
2. The flow is intrinsic to the wizard surface — splitting it across chunks would force two PRs in lockstep.
3. The route consumes existing primitives (`scheduledTaskService`, `recurringTasksService`, `triggerService`, `voiceProfileService`) — chunk 19c does NOT introduce new server primitives.
4. Per spec §13.4 + R8 mitigation, the advisory lock + partial unique index guard live in this route's body.

If the builder finds chunk 19c exceeds the chunk-size rule (more than 5 files OR more than 1 logical responsibility), the builder SHALL split the wizard endpoint into a 19d sub-chunk (`server/routes/personalSetup.ts` + `server/services/eaProvisioningService.ts`) and report the split in the chunk's deliverable manifest.

## Acceptance criteria (whole plan)

The plan is COMPLETE when:
1. All chunks 1–19c land on the branch in execution order.
2. Predecessor primitives gate (chunk 0 pre-check) passed.
3. All spec §27 decisions resolved per this plan (no `SPEC_REVISION_NEEDED` findings — Q12 verified satisfiable).
4. Local lint + typecheck pass on every chunk.
5. Every authored Vitest pure-helper test passes via `npx vitest run <path>`.
6. The credential-isolation integration test passes.
7. CI gates pass on the PR (test gates are CI-only — verified at PR time, NOT locally).
8. Manual visual verification of the 3 locked mockups against the implementation.

## Out of plan (acknowledged but not authored here)

Per spec §26 deferred items + the doc-sync convention:
- `architecture.md` / `KNOWLEDGE.md` / `docs/capabilities.md` / strategic parent updates land in Phase 3 finalisation, NOT in any chunk above.
- Operator decision on whether to ship the stub second user-owned agent (Q7) — NOT shipping; integration test is the proof.
- Google Calendar push channels + Gmail Pub/Sub push + Workflow #4 + Workflow #5 + Calendar `delete_event` + Drive writes + per-user budgets + multi-horizon Calendar lookahead + Outlook + Notion — all V1.5+ per §26.
- Cross-ownership delegation (user-owned ↔ subaccount-owned) — out per §15.7.
- Break-glass admin redaction-reveal UI — Phase 1.5 per §26 (typed event ships in predecessor).
- Slack auto-send-scope dropdown — out per §9.3 + §26 (rendered as static text in V1).
