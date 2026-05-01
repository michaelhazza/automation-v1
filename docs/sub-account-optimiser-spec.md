# Sub-Account Optimiser Meta-Agent — Dev Spec

**Status:** DRAFT (v2 — post-design-review 2026-05-02)
**Build slug:** `subaccount-optimiser`
**Branch:** `claude/subaccount-optimiser`
**Migrations claimed:** `0267`, `0267a`
**Concurrent peers:** F1 `subaccount-artefacts` (0266), F3 `baseline-capture` (0268-0270)

**Related code:**
- `companies/automation-os/agents/portfolio-health-agent/` (org-tier sibling, do not merge)
- `server/services/agentScheduleService.ts`, `server/services/agentExecutionService.ts`
- `server/services/canonicalDataService.ts`, `server/services/costAggregateService.ts`
- `server/db/schema/agentRuns.ts`, `server/db/schema/agentExecutionEvents.ts`
- `server/db/schema/reviewItems.ts`, `server/db/schema/llmRequests.ts`
- `server/db/schema/memoryCitationScores.ts`, `server/db/schema/fastPathDecisions.ts`
- `client/src/pages/DashboardPage.tsx` (the surface this spec extends)
- `client/src/components/Layout.tsx` (sidebar context that drives scope)

**Related specs:**
- `docs/automation-os-system-agents-master-brief-v7.1.md`
- `docs/riley-observations-dev-spec.md` (W3 telemetry would enrich this; not blocking)

**Prototypes:** `prototypes/subaccount-optimiser/home-dashboard.html` (org context, cross-client rollup); `prototypes/subaccount-optimiser/home-dashboard-subaccount-context.html` (sub-account context, single-client view)

---

## Sections

- §0 Design summary (what changed from v1)
- §1 Scope
- §2 Recommendation taxonomy (8 categories)
- §3 Telemetry sources
- §4 Agent definition
- §5 Skills
- §6 Storage model + generic agent-output primitive
- §7 Output surface
- §8 Cost model
- §9 Build chunks
- §10 Files touched
- §11 Done definition
- §12 Dependencies
- §13 Risks
- §14 Concurrent-build hygiene
- §15 What Riley W3 would unlock (when it ships)

---

## §0 Design summary (what changed from v1)

Five architectural decisions were made during design review. They shape every section below.

1. **Generic primitive, not bespoke surface.** The optimiser writes to a new generic table `agent_recommendations` via a new generic skill `output.recommend`, rendered by a new generic component `<AgentRecommendationsList>`. Any agent can produce recommendations through the same path. The optimiser is the first consumer; the primitive is reusable infrastructure. Replaces the v1 plan to ship a bespoke `subaccount_recommendations` table + `<RecommendationsCard>` component for one agent.

2. **8 categories, not 5.** Three categories added that read existing telemetry already in production: `memory.low_citation_waste` (citation scores), `agent.routing_uncertainty` (fast-path decisions), `llm.cache_poor_reuse` (cache token attribution). All hard-coded SQL; intelligent free-form discovery deferred.

3. **One context-aware section on the Home dashboard.** Suggestions live in a new section on `DashboardPage` at `/`, between "Pending your approval" and "Your workspaces". Sidebar context drives scope: org context shows cross-client rollup; sub-account context shows that sub-account only. No new pages, no new nav item, no `/suggestions` route in v1.

4. **Plain language only in UI.** Category slugs (`agent.over_budget`, `memory.low_citation_waste`, etc.) are internal vocabulary. The agent renders user-facing copy in plain English with operator-friendly numbers ("$73 against a $50 budget", not "47% over"). One primary action per row: "Help me fix this →".

5. **Org-tier optimiser deferred.** Portfolio Health Agent already occupies the org-tier observation role at `companies/automation-os/agents/portfolio-health-agent/`. Building a parallel org-tier optimiser would duplicate cross-tenant comparative analysis. Revisit after F2 ships and operator behaviour is observed.

## Distinction from existing system agents

| Agent | Scope | Audience | Output | Surface |
|-------|-------|----------|--------|---------|
| Portfolio Health Agent | Org / cross-tenant | Synthetos platform team + agency operators | Org insights (`org_memories`) | No UI today; insights consumed via agent chat |
| System-monitoring agent (`server/services/systemMonitor/`) | Org-wide, sysadmin-bypassed | Sysadmins | Incidents (`system_incidents`) | `/system/incidents` admin triage page |
| Sub-account optimiser (this spec) | Single sub-account | Agency operator + sub-account primary user | Recommendations (`agent_recommendations`) | New section on Home dashboard `/` |

System-monitoring is reactive fault detection (something broke). The optimiser is proactive efficiency advice (something could be better). They share read access to several telemetry tables but write to different surfaces with different lifecycles. No collision risk on writes.

---

## §1 Scope

### In scope

- Single sub-account observability — read its own agent runs, costs, escalations, skills, memory.
- 8 recommendation categories (see §2) — all hard-coded SQL scans, no LLM-driven discovery.
- New generic primitive (table + skill + component) so any agent can produce recommendations through a single path.
- Daily scheduled execution per sub-account (configurable).
- Opt-in / opt-out toggle at sub-account level.
- Operator-facing UI: one new section on `DashboardPage` (`/`), scope-aware via sidebar context.

### Out of scope

- **Cross-sub-account comparison** — Portfolio Health Agent's job (org-tier sibling).
- **Org-tier optimiser meta-agent** — deferred. Revisit after F2 ships.
- **Auto-execution of recommendations** — observation only; operator acts via Configuration Assistant deep-link.
- **Standalone `/suggestions` page** — deferred to v1.1. Top 3 + "See all" inline in v1.
- **Brand voice ML classification** beyond keyword/phrase frequency — deferred until volume justifies.
- **Wider Home dashboard scope-awareness** — pre-existing tension where "Clients Needing Attention", "Active Agents", etc. don't make sense in sub-account context. Out of scope to fix here. The new suggestions section is the only context-aware element this spec ships; other widgets behave as they do today. Worth a follow-up spec.

## §2 Recommendation taxonomy

8 categories. Each scan skill returns raw evidence; the agent renders user-facing copy via a small LLM prompt. The render output is cached by `(category, dedupe_key, evidence_hash)` — re-runs with byte-equal evidence reuse the cached copy; an evidence change invalidates the cache and triggers re-render.

**Category slugs are internal vocabulary.** They appear in `agent_recommendations.category`, in skill manifests, and in deferred-items routing. They MUST NOT appear in operator-facing UI — the agent renders plain English titles and details.

Each recommendation row has: `category`, `severity` (`info` / `warn` / `critical`), `title`, `body`, `evidence` (jsonb with metric values), `evidence_hash` (sha256 over canonical-JSON of `evidence` — drives update-in-place per §6.2), `action_hint`, `dedupe_key`, `dismissed_at`, `acknowledged_at`.

### Original 5 categories (telemetry already shipped)

| Slug | Severity | Trigger | Example user-facing copy (title + detail) |
|------|----------|---------|-------------------------------------------|
| `agent.over_budget` | critical | Agent monthly cost > 1.3× its budget for 2 consecutive months | "Reporting Agent is spending more than expected" / "It used $73 this month against a $50 budget. Same story last month." |
| `playbook.escalation_rate` | critical | Workflow run escalates to HITL > 60% over 14 days | "An outreach workflow keeps needing your help" / "8 of the last 12 runs got stuck on the email step and asked a person to step in." |
| `skill.slow` | warn | Skill p95 latency > 4× cross-tenant median for that skill, sustained 7 days | "Pulling contacts from GHL is slow" / "Around 12 seconds here, around 3 seconds for your other clients." |
| `inactive.workflow` | warn | Sub-account agent with `subaccountAgents.scheduleEnabled = true AND scheduleCron IS NOT NULL` whose most recent `agent_runs` row is older than (1.5 × the expected cadence implied by `scheduleCron`, computed via `scheduleCalendarServicePure`) | "Portfolio Health check stopped running" / "Was scheduled weekly. Hasn't run since 17 April." |
| `escalation.repeat_phrase` | info | Same prohibited phrase / brand-voice violation triggers ≥ 3 HITL escalations in 7 days | "Reviewers keep flagging the word 'guarantee'" / "It came up in 3 of the last 4 emails you reviewed. You might want to add it to your brand voice." |

### Added 3 categories (existing telemetry, not in v1 spec)

| Slug | Severity | Trigger | Example user-facing copy |
|------|----------|---------|--------------------------|
| `memory.low_citation_waste` | warn | > 50% of injected memory entries scored < 0.3 in `memory_citation_scores` over 7 days | "Memory cleanup could speed things up" / "Most of the notes saved for your agents this week went unused. Cleaning them up could trim costs and speed up runs." |
| `agent.routing_uncertainty` | warn | Fast-path confidence < 0.5 on > 30% of decisions, OR `secondLookTriggered` rate > 30%, sustained 7 days | "Outreach Agent is hesitating a lot" / "It's second-guessing itself on about a third of decisions. Worth a quick look." |
| `llm.cache_poor_reuse` | info | `cacheCreationTokens` > sum of `cachedPromptTokens` over 7 days for any agent (cache costs more than it saves) | "Caching isn't paying off this week" / "Building the cache is costing more than it's saving on the Reporting Agent." |

### Per-category evaluator modules

Each category has a template module under `server/services/optimiser/recommendations/<category>.ts` exporting `evaluate(subaccountContext): Recommendation[]`. Pure functions; agent calls them sequentially via scan skills. The render step (raw evidence → operator copy) is a separate small LLM call whose output is cached by `(category, dedupe_key, evidence_hash)` (see §6.2 for the hash definition).

### Dedupe keys

| Category | Dedupe key |
|----------|------------|
| `agent.over_budget` | `<agent_id>` |
| `playbook.escalation_rate` | `<workflow_id>` |
| `skill.slow` | `<skill_slug>` |
| `inactive.workflow` | `<subaccount_agent_id>` |
| `escalation.repeat_phrase` | `<phrase_token>` |
| `memory.low_citation_waste` | `<agent_id>` |
| `agent.routing_uncertainty` | `<agent_id>` |
| `llm.cache_poor_reuse` | `<agent_id>` |

Open recommendation in same `(subaccount_id, category, dedupe_key)` → write skill returns `was_new=false`, no insert.

---

## §3 Telemetry sources

All sources below are already shipped except the cross-tenant median view (built in Phase 1 of this spec).

| Source | Table / view | Per-sub-account? | Used by which categories |
|--------|--------------|-------------------|--------------------------|
| Agent runs | `agent_runs` | Yes | budget, routing_uncertainty (via join) |
| Step events | `agent_execution_events` | Yes | skill.slow (timing extraction) |
| Cost aggregates | `cost_aggregates` | Yes (multi-scope) | agent.over_budget |
| HITL escalations | `review_items` joined to `actions`; modal escalating step from `flow_step_outputs` (`flow_run_id`, `step_id`, `status='failed'`) joined to `flow_runs` | Yes | playbook.escalation_rate, escalation.repeat_phrase |
| Health snapshots | `client_pulse_health_snapshots` | Yes | context only, not direct trigger |
| Workflow last-run | `flow_runs` | Yes | playbook.escalation_rate |
| Scheduled sub-account agents | `subaccount_agents` (`scheduleEnabled`, `scheduleCron`, `scheduleTimezone`) joined to `agent_runs` (last started_at per `subaccountAgentId`) | Yes | inactive.workflow |
| **LLM requests** | `llm_requests` (`cachedPromptTokens`, `cacheCreationTokens`, `prefixHash`) | Yes | **llm.cache_poor_reuse** (new) |
| **Memory citation scores** | `memory_citation_scores` (`finalScore` per injected entry per run) | Yes (via `agent_runs.subaccount_id`) | **memory.low_citation_waste** (new) |
| **Fast-path decisions** | `fast_path_decisions` (`decidedConfidence`, `secondLookTriggered`, `downstreamOutcome`) | Yes | **agent.routing_uncertainty** (new) |
| **Optimiser cross-tenant median** (peer baseline for `skill.slow`) | derived materialised view `optimiser_skill_peer_medians` over `agent_execution_events` (skill_slug + duration extracted from the JSONB `payload` of `tool_call.completed` events) keyed by `skill_slug` | No (cross-tenant aggregate, sysadmin-bypassed RLS) | skill.slow |

### One spec correction from v1

The original §3 noted "review_items joined to tasks → skill_instructions" with a `reason` text field. The actual schema has `reviewPayloadJson` (JSONB), no explicit `reason` column. Phrase mining for `escalation.repeat_phrase` reads from `reviewPayloadJson` — no migration needed; phrase token extraction handles the JSONB shape.

### Cross-tenant median view

`optimiser_skill_peer_medians` is a materialised view defined over `agent_execution_events` filtered to `event_type='tool_call.completed'`. Both `skill_slug` and the per-call duration are extracted from the event's JSONB `payload` (the discriminated-union shape pinned in `shared/types/agentExecutionLog.ts`). The view computes p50/p95/p99 per `skill_slug` across all sub-accounts and exposes only the aggregate. No per-tenant rows leak.

**Access posture.** The view contains only cross-tenant aggregates and carries no `organisation_id` / `subaccount_id` columns. Read via `withAdminConnection()` from inside `server/services/optimiser/queries/skillLatency.ts`. Not added to `rlsProtectedTables.ts` because there are no per-tenant rows to protect — opt-out rationale documented in `architecture.md` per the §3 sysadmin-bypassed-read pattern.

**Minimum-tenant threshold:** the view returns no value for a `skill_slug` used by < 5 sub-accounts. Below threshold, `skill.slow` evaluator skips the recommendation entirely. Prevents single-tenant data leakage when a skill is used by 1-2 clients. Threshold is enforced inside the view definition (HAVING clause), not just application logic.

## §4 Agent definition

New agent definition file: `companies/automation-os/agents/subaccount-optimiser/AGENTS.md` + role definition + system prompt.

- **Role:** `subaccount-optimiser`
- **Scope:** `subaccount` (mirrors all 15+ business agents per migration 0106)
- **Schedule:** daily at sub-account local 06:00 (cron derived from sub-account's `timezone`). Stored on the sub-account agent's existing `subaccount_agents.scheduleCron` / `scheduleEnabled` / `scheduleTimezone` columns — no new schedule surface. Overriding the cron is the same operation as overriding any other sub-account agent's schedule (via `agentScheduleService.updateSchedule`).
- **Sub-account-agent row bootstrap.** Schedule writes presuppose a `subaccount_agents` row linking the optimiser org agent (role `subaccount-optimiser`) to each sub-account where `subaccounts.optimiser_enabled = true`. Two paths ensure that row exists:
  - **Backfill at deploy time** — the Phase 2 backfill script (`scripts/backfill-optimiser-schedules.ts`) does an idempotent `INSERT … ON CONFLICT DO NOTHING` of the `subaccount_agents` link before issuing the schedule write. Re-running the backfill is safe.
  - **New sub-accounts after deploy** — `subaccountService.create` (or the equivalent admin onboarding path) gets a hook that creates the optimiser link + schedule when `optimiser_enabled = true` (the column defaults to true, so this fires by default). A sub-account that opts out skips both.

  Without these two paths, the daily cron has nothing to bind to and the optimiser silently no-ops for that sub-account.
- **Default-on:** yes. Opt-out is a backend boolean column `subaccounts.optimiser_enabled` (default true). v1 has no operator-visible UI toggle — the column is flipped via admin SQL or a Configuration Assistant prompt that writes it. A dedicated subaccount-settings UI surface is deferred (see Deferred Items).

System prompt (draft):
> "You watch the telemetry of agents operating in this sub-account. Each day, run your evaluation skills, dedupe against open recommendations, render any new findings as plain operator-friendly copy, and write them via the `output.recommend` skill. You do not execute work. You do not modify configuration. You do not surface internal category names in your output — operators read your titles and details, not your slugs. Use concrete numbers in human terms ('$73 against a $50 budget', not '47% over budget')."

---

## §5 Skills

8 scan skills (one per category) + 1 generic write skill (the primitive — see §6).

| Skill slug | Description | Side-effects | Returns |
|------------|-------------|--------------|---------|
| `optimiser.scan_agent_budget` | Per agent: current month + previous month cost vs budget. Flag > 1.3× for 2 months. | None | `Array<{agent_id, this_month, last_month, budget, top_cost_driver}>` |
| `optimiser.scan_workflow_escalations` | Per workflow: run + escalation counts over 14 days. Flag > 60% rate. | None | `Array<{workflow_id, run_count, escalation_count, common_step_id}>` (the modal `flow_step_outputs.stepId` of escalating runs; populates the `step=` parameter of the `playbook.escalation_rate` action_hint per §6.5) |
| `optimiser.scan_skill_latency` | Per skill in last 7 days: p95 vs cross-tenant median. Flag > 4× ratio. | None | `Array<{skill_slug, latency_p95_ms, peer_p95_ms, ratio}>` |
| `optimiser.scan_inactive_workflows` | Scheduled sub-account agents (`subaccount_agents.scheduleEnabled = true AND scheduleCron IS NOT NULL`) whose most recent `agent_runs.startedAt` is older than 1.5× expected cadence (computed via `scheduleCalendarServicePure`). | None | `Array<{subaccount_agent_id, agent_id, agent_name, expected_cadence, last_run_at}>` |
| `optimiser.scan_escalation_phrases` | Tokenise `review_items.reviewPayloadJson` over 7 days, group, flag phrases ≥ 3 occurrences. | None | `Array<{phrase, count, sample_escalation_ids}>` |
| `optimiser.scan_memory_citation` | Per agent: % of injected `memory_citation_scores.finalScore < 0.3` over 7 days. Flag > 50%. | None | `Array<{agent_id, low_citation_pct, total_injected, projected_token_savings}>` |
| `optimiser.scan_routing_uncertainty` | Per agent: distribution of `fast_path_decisions.decidedConfidence` + `secondLookTriggered` rate over 7 days. | None | `Array<{agent_id, low_confidence_pct, second_look_pct}>` |
| `optimiser.scan_cache_efficiency` | Per agent: sum(`cacheCreationTokens`) vs sum(`cachedPromptTokens`) over 7 days from `llm_requests`. Flag where creation > reused. | None | `Array<{agent_id, creation_tokens, reused_tokens, dominant_skill}>` |
| `output.recommend` (generic — see §6) | Insert / update / no-op a row in `agent_recommendations` keyed by `(scope_type, scope_id, category, dedupe_key)`. Used by the optimiser AND any future agent. Full contract pinned in §6.2. | DB write (sometimes a no-op) | `{recommendation_id: string, was_new: boolean, reason?: 'cap_reached' \| 'updated_in_place'}` (see §6.2 for state transitions) |

All scan skills are pure SQL with no LLM call. The render step (raw evidence → 2-3 sentence operator copy) is one LLM call per new recommendation, batched at the end of a run. The render is keyed on `evidence_hash` (see §6.2) — re-renders fire when, and only when, the hash changes between runs (the `was_new=true` and `was_new=false, reason='updated_in_place'` paths). Byte-equal re-runs are a no-op end-to-end.

## §6 Storage model + generic agent-output primitive

This section defines reusable infrastructure. The optimiser is the first consumer; future agents (Portfolio Health surfacing insights, system-monitoring surfacing patterns, custom user agents producing findings) reuse the same primitive.

### §6.1 New table: `agent_recommendations` (migration 0267)

```sql
CREATE TABLE agent_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('org', 'subaccount')),
  scope_id UUID NOT NULL, -- organisation_id when scope_type='org'; subaccount_id when scope_type='subaccount'
  producing_agent_id UUID NOT NULL REFERENCES agents(id),
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'critical')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_hash TEXT NOT NULL DEFAULT '', -- sha256(canonical_json(evidence)); update-in-place trigger
  action_hint TEXT,
  dedupe_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), -- set on insert; bumped on every update_in_place, acknowledge, dismiss
  acknowledged_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  dismissed_reason TEXT
);

CREATE UNIQUE INDEX agent_recommendations_dedupe
  ON agent_recommendations(scope_type, scope_id, category, dedupe_key)
  WHERE dismissed_at IS NULL;

CREATE INDEX agent_recommendations_open_by_scope
  ON agent_recommendations(scope_type, scope_id, updated_at DESC)
  WHERE dismissed_at IS NULL AND acknowledged_at IS NULL;

CREATE INDEX agent_recommendations_org
  ON agent_recommendations(organisation_id, created_at DESC);
```

Plus RLS policies (per `0245_all_tenant_tables_rls.sql` pattern), `rlsProtectedTables.ts` entry, `canonicalDictionary.ts` entry.

**Why generic, not `subaccount_recommendations`:** the table supports both `scope_type='org'` and `scope_type='subaccount'` from day one. Org-tier optimiser (deferred) would write `scope_type='org'` rows; today only sub-account rows exist. Schema cost is the same; future cost of retrofitting is high. Decision locked at design review.

**Why not extend an existing primitive.** The closest existing primitives are (a) `system_incidents` (system-monitoring agent's surface — sysadmin-only, fault-detection lifecycle with severity tiers and auto-resolution), (b) `feature_requests` (Orchestrator's Path C/D output — keyed by capability slugs, fires Slack/email/Synthetos-task notifications, 30-day per-org dedupe), (c) `org_memories` / `workspace_memory` (Portfolio Health Agent's surface — long-form narrative insights stored as agent-readable memory, not operator-facing). Each carries a different lifecycle and audience: incidents resolve when the fault clears; feature requests notify external pipelines; memories are agent-context, not UI rows. Recommendations need a fourth lifecycle — operator-facing rows that dedupe by stable finding keys, render plain-English copy, and acknowledge/dismiss in the UI without notifying anyone — which doesn't fit any of the three. A new table is justified; the schema deliberately mirrors `system_incidents`'s dedupe + severity shape so future consolidation stays open.

**Acknowledged-row semantics.** `acknowledged_at` marks "operator has seen this; don't surface it again until the underlying evidence changes" but DOES NOT clear the dedupe slot. The dedupe unique index keys on `WHERE dismissed_at IS NULL` deliberately — recreating an acknowledged finding behind the operator's back is worse than leaving it suppressed. The list view filters out acknowledged rows (already in the `agent_recommendations_open_by_scope` index predicate); the dedupe slot only frees when the row is dismissed. Re-surfacing IS triggered when `output.recommend` lands the `updated_in_place` path: an evidence_hash mismatch means the finding has materially changed and the row's `acknowledged_at` is set back to NULL so it returns to the operator's list. See §6.2 for the exact rule.

### §6.2 Generic skill: `output.recommend`

New skill defined in `server/skills/output/recommend.md`, executor in `server/services/skillExecutor.ts`.

**Input contract** (any agent can call this):
```ts
{
  scope_type: 'org' | 'subaccount',
  scope_id: string,
  category: string,           // agent's choice; namespaced by convention (e.g. 'agent.over_budget', 'health.churn_risk_high')
  severity: 'info' | 'warn' | 'critical',
  title: string,              // operator-facing, plain English
  body: string,               // operator-facing, plain English with concrete numbers
  evidence: Record<string, unknown>,
  action_hint?: string,       // suggested next step
  dedupe_key: string          // stable per finding
}
```

**Output:** `{ recommendation_id: string, was_new: boolean, reason?: 'cap_reached' | 'updated_in_place' }`.
- `was_new=true` — new row inserted.
- `was_new=false, reason='updated_in_place'` — open recommendation existed for `(scope_type, scope_id, category, dedupe_key)` AND the new `evidence_hash` differs from the stored `evidence_hash`. Executor updates `title`, `body`, `evidence`, `evidence_hash`, `severity`, `action_hint`, and `updated_at` (= `now()`) on the existing row in place; `created_at` is preserved; `acknowledged_at` is set to `NULL` (re-surface the row to the operator since something material changed); `recommendation_id` returned is the existing row's id.
- `was_new=false, reason='cap_reached'` — `(scope_type, scope_id, producing_agent_id)` already has 10 open (non-dismissed) recommendations. Insert refused; `recommendation_id` returned is `''`. Cap is enforced inside the executor via `pg_advisory_xact_lock(hashtext('output.recommend.cap:' || scope_type || ':' || scope_id || ':' || producing_agent_id))` taken before the `SELECT count(*)` that gates the insert. The advisory lock serialises insert decisions per `(scope, producing_agent_id)` triple within a transaction, eliminating the count-then-insert TOCTOU race. Pattern lifted from `feature_requests` (per architecture.md → "Feature request pipeline" → `pg_advisory_xact_lock(orgId + dedupeHash)` inside the insert transaction).
- `was_new=false` (no `reason`) — open match existed and `evidence_hash` matches; no write performed. The operator-facing copy and the row's `acknowledged_at` state are preserved.

**Evidence hash.** `evidence_hash = sha256(canonical_json(evidence))` where `canonical_json` is RFC 8785 (or equivalent) — recursive sort of object keys, no insignificant whitespace, lowercase hex digest. Computed inside the skill executor before any DB call. Hash compares the full `evidence` value (including numeric values), not just its shape. A delta of `{ "this_month": 7300 }` → `{ "this_month": 7400 }` is a hash change and triggers update-in-place + acknowledged_at clear; rerunning the same scan with byte-equal evidence is a no-op.

**Pre-write candidate ordering.** When an agent run produces more candidate recommendations than the per-`(scope, producing_agent_id)` cap of 10, the executor's caller (the optimiser agent loop OR any future producer) MUST sort candidates before invoking `output.recommend` to make cap-eviction deterministic: severity descending (`critical` > `warn` > `info`), then `category` ascending, then `dedupe_key` ascending. This is a producer-side contract, not enforced inside `output.recommend` itself; the optimiser's evaluator-orchestration layer applies it before the per-recommendation calls.

**Idempotency posture (per spec-authoring-checklist §10).** Key-based on `(scope_type, scope_id, category, dedupe_key) WHERE dismissed_at IS NULL`. Two agents racing on the same key resolve via the unique index — first commit wins; the loser catches Postgres `23505` and returns `{ was_new: false, recommendation_id: <existing row id> }` (looked up after the catch). Never bubbles `23505` as a 500. The skill executor maps the exception inside the transaction. Update-in-place path uses an optimistic `UPDATE … WHERE id = $existing AND dismissed_at IS NULL` predicate — 0 rows affected = a concurrent dismiss won; falls through to the no-op `was_new=false` path.

**Retry classification.** `output.recommend` is `safe` (key-based idempotency); callers may retry on transport failure without further coordination. The acknowledge / dismiss HTTP routes are `guarded` — both use `UPDATE agent_recommendations SET … WHERE id = $1 AND dismissed_at IS NULL` (or `acknowledged_at IS NULL` for acknowledge); a second call lands as a 200-idempotent-no-op rather than a 409.

**Permission:** any agent with `output.recommend` in its skill manifest can call it. The executor enforces that `scope_id` belongs to the agent's organisation by resolving `scope_id → organisation_id` and comparing to `req.orgId` / the agent's organisation.

**`producing_agent_id` provenance.** `producing_agent_id` is NOT part of the `output.recommend` input contract — it is derived from the calling agent's execution context inside the executor (`SkillExecutionContext.agentId`). Callers cannot supply or override it. Non-agent invocations of `output.recommend` (e.g. a route handler trying to call the skill directly outside an `agent_runs` context) are rejected with `failure(FailureReason.InvalidInput, 'output.recommend requires an agent execution context')`. This guarantees the cap-lock key `(scope_type, scope_id, producing_agent_id)` is always honestly populated and prevents one agent from saturating another's slot in the open-rec cap.

**Category naming:** convention only, no schema validation. Convention is `<area>.<finding>` (e.g. `agent.over_budget`, `health.churn_risk_high`). The primitive doesn't enforce a registry — agents own their category namespaces. If two agents pick the same `(scope, category, dedupe_key)`, dedupe will treat them as the same finding; agents should namespace categories to avoid collisions in practice.

### §6.3 Generic component: `<AgentRecommendationsList>`

New React component at `client/src/components/recommendations/AgentRecommendationsList.tsx`.

**Props:**
```ts
{
  scope: { type: 'org', orgId: string } | { type: 'subaccount', subaccountId: string },
  includeDescendantSubaccounts?: boolean, // default false. Only meaningful when scope.type='org'.
                                          // When true, the hook's fetch query also returns
                                          // scope_type='subaccount' rows for every sub-account
                                          // the caller can read (RLS-gated; no app-layer filter).
  mode?: 'collapsed' | 'expanded', // default 'collapsed'. 'collapsed' renders only the first
                                   // `limit` rows; 'expanded' ignores `limit` and renders all
                                   // visible rows. Parent controls toggle via state.
  limit?: number,            // default 3 — used only when mode='collapsed'.
  emptyState?: 'hide' | 'show', // default 'hide' — section disappears when empty
  onTotalChange?: (total: number) => void, // fires after each fetch with the full
                                           // (post-RLS) row count. Lets the parent render
                                           // "See all N →" with the real N instead of guessing.
  onExpandRequest?: () => void,            // fires when the "See all N →" affordance is clicked
                                           // inside the component (the parent flips mode to
                                           // 'expanded'). If the parent renders its own affordance,
                                           // this callback is never used and the parent handles
                                           // its own toggle.
  onDismiss?: (recId: string) => void,
}
```

Renders a vertical list of open recommendations for the given scope, sorted by severity (critical / warn / info) then by `updated_at desc` (so re-rendered findings rise to the top — the row's freshness, not its first-seen-time, drives ordering). Each row: severity dot, plain-English title, one-sentence body, "Help me fix this →" link (deep-links to Configuration Assistant pre-loaded with the recommendation's `action_hint`; clicking this link also fires the acknowledge endpoint as fire-and-forget per §6.5), small × dismiss with reason input.

**Row-data contract from the hook.** `useAgentRecommendations` returns rows shaped as `{ id, scope_type, scope_id, subaccount_display_name?: string, category, severity, title, body, action_hint, evidence, created_at, updated_at, acknowledged_at, dismissed_at }`. `subaccount_display_name` is populated ONLY for `scope_type='subaccount'` rows fetched in org-rollup mode (`includeDescendantSubaccounts=true`); the hook joins to `subaccounts.name` server-side and returns the resolved string. Sub-account scope and org-only-row queries omit the field.

**Org-rollup row label.** When `scope_type='subaccount'` rows are rendered in org-rollup mode, the row prepends a small slate-500 label `<subaccount_display_name> · ` before the operator-facing title (e.g. "Smith Dental · Reporting Agent is spending more than expected"). In single-scope mode (sub-account context, or `includeDescendantSubaccounts=false`), the label is omitted.

**No category labels in the UI.** No severity word labels. No timestamps on individual rows. Dot colour and ordering carry severity; the section header carries the timestamp ("Updated this morning").

### §6.4 What's NOT in the primitive (resist scope creep)

The primitive intentionally does not include:
- A widget registry, layout engine, or general "agent surface" framework. The original v1 design wanted a generalised Views framework; that was deliberately deferred (see `tasks/builds/home-dashboard-reactivity/spec.md` §2). This primitive is narrower — recommendations only.
- Generic dashboards, charts, KPI tiles, trend visualisations.
- Per-agent customisation of the renderer. All recommendations from all agents render the same way.
- Acknowledge / dismiss workflow customisation. The two actions are universal.
- Multi-step actions or threaded discussion. Single-action only.

Future spec can extend the primitive (e.g. add `acknowledge` semantics, add notification surfaces) but those are separate scopes.

### §6.5 Contracts

Pinned shapes for the four boundaries this primitive crosses. Source-of-truth: `agent_recommendations` row > evidence JSONB > socket event payload > UI render.

**`agent_recommendations` row** (DB authoritative).
- Producer: `output.recommend` skill executor (every agent) and the acknowledge / dismiss HTTP routes (mutation only).
- Consumer: `useAgentRecommendations` hook, the optimiser's own dedupe pre-check, and any future UI surface.
- Nullability: `acknowledged_at`, `dismissed_at`, `dismissed_reason`, `action_hint` are nullable. All other columns NOT NULL.
- Defaults: `evidence` defaults to `'{}'::jsonb`, `evidence_hash` defaults to `''` (executor always overwrites with the real hash), `created_at` defaults to `now()`, `id` defaults to `gen_random_uuid()`.
- Example row:
  ```json
  {
    "id": "9f3e…",
    "organisation_id": "org-uuid",
    "scope_type": "subaccount",
    "scope_id": "sub-uuid",
    "producing_agent_id": "agent-uuid",
    "category": "agent.over_budget",
    "severity": "critical",
    "title": "Reporting Agent is spending more than expected",
    "body": "It used $73 this month against a $50 budget. Same story last month.",
    "evidence": { "agent_id": "agent-uuid", "this_month": 7300, "last_month": 6800, "budget": 5000, "top_cost_driver": "ghl.contacts.search" },
    "evidence_hash": "f1c4…",
    "action_hint": "configuration-assistant://agent/agent-uuid?focus=budget",
    "dedupe_key": "agent-uuid",
    "created_at": "2026-05-02T06:00:00Z",
    "updated_at": "2026-05-02T06:00:00Z",
    "acknowledged_at": null,
    "dismissed_at": null,
    "dismissed_reason": null
  }
  ```

**`output.recommend` input/output** — already pinned in §6.2 (input contract + output discriminated by `was_new` and `reason`). Producer: any agent with the skill in its manifest. Consumer: `skillExecutor.ts`.

**Read endpoint** (the GET that `useAgentRecommendations` calls).
- `GET /api/recommendations?scopeType=org|subaccount&scopeId=<uuid>&includeDescendantSubaccounts=<bool>&limit=<int>` — returns `{ rows: AgentRecommendationRow[], total: number }` where `AgentRecommendationRow` matches the §6.3 row-data contract (including the `subaccount_display_name` field populated only for rolled-up sub-account rows). Default `limit=20`; cap at 100. Sort: severity desc → `updated_at` desc (so a recently-re-rendered finding bubbles to the top of the list). Filters out `acknowledged_at IS NOT NULL` and `dismissed_at IS NOT NULL` rows by default (no query param to surface them in v1).
- `total` is the post-RLS open-row count for the requested scope, NOT clamped to `limit`. The `<AgentRecommendationsList>` component fires `onTotalChange(total)` so the parent can render "See all N →" with the real N.
- Auth-gated (`authenticate`); RLS scopes rows to the caller's org. When `scopeType=org AND includeDescendantSubaccounts=true`, the route does a single SQL with `OR (scope_type='subaccount' AND scope_id IN (SELECT id FROM subaccounts WHERE organisation_id = $orgId))` — RLS does the per-subaccount visibility filter automatically, no app-layer permission filter.
- 404 when `scopeId` doesn't exist or isn't visible to the caller. 422 on bad `scopeType`/`scopeId` shape.

**Acknowledge / dismiss HTTP endpoints.**
- `POST /api/recommendations/:recId/acknowledge` — request body `{}`; response `{ success: true, alreadyAcknowledged: boolean }`. Idempotent: a second call returns `alreadyAcknowledged: true` rather than 409. 404 when `:recId` doesn't exist or isn't visible to the caller (RLS-filtered).
- `POST /api/recommendations/:recId/dismiss` — request body `{ reason: string }` (`reason` max 500 chars). Response `{ success: true, alreadyDismissed: boolean }`. Idempotent on the dismiss path; the second call's `reason` is ignored. 404 same as above.
- Both routes are auth-gated (`authenticate`); no additional permission guard since RLS scopes the row to the caller's org. Idempotency is state-based, not key-based, and the route distinguishes "row missing / RLS-hidden" from "already in target state" via a two-step CTE pattern:

  ```sql
  WITH existing AS (
    SELECT id, acknowledged_at, dismissed_at
    FROM agent_recommendations
    WHERE id = $1
    FOR UPDATE
  ),
  updated AS (
    UPDATE agent_recommendations
    SET acknowledged_at = now(), updated_at = now()
    WHERE id = $1 AND acknowledged_at IS NULL
    RETURNING id
  )
  SELECT
    (SELECT count(*) FROM existing) AS existed,
    (SELECT count(*) FROM updated)  AS updated_rows;
  ```

  Decision matrix:
  - `existed = 0` → 404 (row absent or RLS-hidden — RLS makes the row invisible to a non-owning org so 404 is the correct response, not 403).
  - `existed = 1, updated_rows = 0` → 200 `{ alreadyAcknowledged: true }` (target state already reached; no-op).
  - `existed = 1, updated_rows = 1` → 200 `{ alreadyAcknowledged: false }` (this call performed the transition).

  Same shape for dismiss with `acknowledged_at` swapped for `dismissed_at` and `reason` recorded in `dismissed_reason`. `updated_at` is bumped on both transitions. No `23505` edge applies — there is no unique-constraint involvement on the UPDATE path.

**Implicit acknowledge on deep-link click.** The "Help me fix this →" UI affordance triggers the acknowledge endpoint client-side as a fire-and-forget `POST` immediately after the deep-link navigation begins (the user has acted on the recommendation, so it should leave the operator's list). The dismiss × button is the only explicitly-visible alternate row action in v1 — there is no separate visible "Acknowledge" button. This keeps the row contract clean (one primary action + one dismiss) per the frontend design principles. If the user does NOT click the deep-link and instead returns to the dashboard later, the recommendation remains visible.

**`action_hint` deep-link schema.** `action_hint` is a string in the form `<surface>://<entity>/<id>?<params>` parsed by the Configuration Assistant front-door router. The primitive does not validate the format — agents own their hints — but optimiser categories MUST follow the table below so the operator deep-link experience is consistent. Unknown / malformed hints fall through to a generic `configuration-assistant://` landing page.

| Category | `action_hint` shape | Worked example |
|----------|--------------------|----------------|
| `agent.over_budget` | `configuration-assistant://agent/<agent_id>?focus=budget` | `configuration-assistant://agent/8c1e…?focus=budget` |
| `playbook.escalation_rate` | `configuration-assistant://workflow/<workflow_id>?focus=escalation-step&step=<step_id>` | `configuration-assistant://workflow/d4a2…?focus=escalation-step&step=email-send` |
| `skill.slow` | `configuration-assistant://skill/<skill_slug>?focus=latency&subaccountId=<subaccount_id>` | `configuration-assistant://skill/ghl.contacts.search?focus=latency&subaccountId=…` |
| `inactive.workflow` | `configuration-assistant://subaccount-agent/<subaccount_agent_id>?focus=schedule` | `configuration-assistant://subaccount-agent/ab12…?focus=schedule` |
| `escalation.repeat_phrase` | `configuration-assistant://brand-voice/<subaccount_id>?phrase=<urlencoded_phrase>` | `configuration-assistant://brand-voice/sub-uuid?phrase=guarantee` |
| `memory.low_citation_waste` | `configuration-assistant://agent/<agent_id>?focus=memory-cleanup` | `configuration-assistant://agent/8c1e…?focus=memory-cleanup` |
| `agent.routing_uncertainty` | `configuration-assistant://agent/<agent_id>?focus=routing` | `configuration-assistant://agent/8c1e…?focus=routing` |
| `llm.cache_poor_reuse` | `configuration-assistant://agent/<agent_id>?focus=cache-prefix` | `configuration-assistant://agent/8c1e…?focus=cache-prefix` |

The Configuration Assistant landing routes for these surfaces are NOT implemented in this spec — that's the surface the deep-link drops the operator into. If a target surface doesn't exist yet, the Configuration Assistant lands on its closest parent (e.g. `agent/<agent_id>` without `?focus=…`) rather than 404. F2 (this spec) ships the hints; F-future ships the surfaces.

**Socket event payload** (`dashboard.recommendations.changed`).
- Emitted from `output.recommend` (after a `was_new=true` insert OR a `reason='updated_in_place'` update) AND from acknowledge / dismiss endpoints.
- Payload: `{ recommendation_id: string, scope_type: 'org' | 'subaccount', scope_id: string, change: 'created' | 'updated' | 'acknowledged' | 'dismissed' }`.
- Producer: skill executor + HTTP routes. Consumer: `useAgentRecommendations` hook (refetches on event per the existing `dashboard.*` reactivity pattern from PR #218).

---

## §7 Output surface

One new section on the existing Home dashboard at `/` (`client/src/pages/DashboardPage.tsx`). Position: between "Pending your approval" (line ~404) and "Your workspaces" (line ~424).

### Scope-aware rendering

The section reads the active sidebar context from `Layout.tsx` (`activeClientId` from `getActiveClientId()`):

- **Org context** (no sub-account selected) → `<AgentRecommendationsList scope={{ type: 'org', orgId: user.organisationId }} includeDescendantSubaccounts={true} />`. The `includeDescendantSubaccounts={true}` prop is what produces the cross-client rollup — without it, only `scope_type='org'` rows would render. RLS scopes the descendant rows to sub-accounts the user can read.
- **Sub-account context** (sub-account selected in sidebar) → `<AgentRecommendationsList scope={{ type: 'subaccount', subaccountId: activeClientId }} />`. Single-client view.

Both render the same component with the same layout. Only the data scope changes.

### Section content

Section header: **"A few things to look at"** (h2, matches the `text-[17px] font-bold text-slate-900 tracking-tight mb-3.5` style of sibling sections).

Sub-header line (12.5px, slate-500): the freshness label, plus a sec-link "See all N →" on the right when there are more than 3 open recommendations. The freshness label is rendered from the maximum `updated_at` across the rows in the current scope (e.g. "Updated this morning" if the most-recent `updated_at` was within the last 4 hours; "Updated yesterday" otherwise — exact thresholds in `client/src/lib/relativeTime.ts`). The N comes from the `onTotalChange` callback fired by `<AgentRecommendationsList>` after each fetch (per §6.3). DashboardPage holds `[mode, setMode] = useState<'collapsed'|'expanded'>('collapsed')` and `[total, setTotal] = useState(0)`; clicking the "See all N →" link calls `setMode('expanded')` to flip the same component into expanded mode in place — no navigation in v1. Expanded mode fetches `limit=100` (the GET endpoint's hard cap); if `total > 100`, the truncation is acknowledged in the UI ("Showing 100 of N — see /suggestions for the full list" — the standalone page is a v1.1 deferred item).

Body: top 3 open recommendations rendered by `<AgentRecommendationsList limit={3} mode={mode} onTotalChange={setTotal} … />` with the props above. Each row: severity dot, plain-English title (operator copy), one-sentence detail (operator copy with concrete numbers), "Help me fix this →" deep-link to Configuration Assistant.

**Hidden when empty.** Zero open recommendations for the current scope = entire section is not rendered. No "Nothing to optimise" empty state — the section simply isn't there.

### Pre-existing scope-inconsistency

The Home dashboard has a pre-existing tension: sibling widgets like "Clients Needing Attention" and "Active Agents" are org-scoped today and don't cleanly handle sub-account context. This spec does NOT solve that. The new suggestions section is the only context-aware element shipped here. A follow-up spec ("Make Home dashboard fully context-aware") can pick up the wider problem.

### v1.1 deferred: standalone `/suggestions` page

The "See all 12 →" link in v1 expands the section inline (not navigating away). v1.1 adds a standalone `/suggestions` page with filters (severity, category, sub-account) and grouping. Out of scope here.

### Mockups

Two HTML prototypes in `prototypes/subaccount-optimiser/`:
- `home-dashboard.html` — org context, cross-client rollup
- `home-dashboard-subaccount-context.html` — sub-account context (Smith Dental selected)

Both faithful to current `DashboardPage.tsx` structure with the new section inserted in the right position.

## §8 Cost model

8 categories × 1 daily run × pure SQL scans + 1 LLM render call per new-or-evidence-changed recommendation × ~200 tokens. Render output cached by `(category, dedupe_key, evidence_hash)` so byte-equal re-runs incur zero LLM spend.

| Scenario | Daily LLM cost per sub-account | Monthly cost |
|----------|---------------------------------|--------------|
| Steady state, 0-2 new recs/day | < $0.01 | < $0.30/sub-account/month |
| Initial onboarding burst (8 new recs day 1) | ~$0.04 one-off | — |
| 100 sub-accounts, steady | < $30/month total | well within margin |

Default-on. Opt-out is the backend boolean `subaccounts.optimiser_enabled` (default true) — flipped via admin SQL or Configuration Assistant in v1; operator UI deferred per §4 and Deferred Items. Hard cap of 10 open recommendations per `(scope, producing_agent_id)` pair at any time (per §13 risk mitigation). Per-pair so multiple agents can each contribute up to 10 without one agent saturating the surface.

---

## §9 Build chunks

Total ~25h. Phase 0 builds the reusable primitive; Phases 1-4 are the optimiser as the first consumer (the previous Phase 4 phrase tokeniser was folded into Phase 1 since the work is part of the same query module — see §9 / Phase 1 / `escalationPhrases.ts`).

### Phase 0 — Generic agent-output primitive (~6h)

Builds reusable infrastructure that survives beyond the optimiser.

- [ ] Author migration `migrations/0267_agent_recommendations.sql` (+ `.down.sql`). Same migration adds the boolean column `subaccounts.optimiser_enabled NOT NULL DEFAULT true` (the opt-out toggle referenced in §1, §4, §8, §9, §11). Not added as a separate migration because it's a single-column boolean conceptually owned by the optimiser feature; a dedicated migration would be heavier overhead than the primitive itself.
- [ ] Add table to `server/db/schema/agentRecommendations.ts`.
- [ ] Register in `rlsProtectedTables.ts` and `canonicalDictionary.ts`.
- [ ] RLS policies migration entry per `0245_all_tenant_tables_rls.sql` pattern (folded into 0267).
- [ ] Author skill `server/skills/output/recommend.md` + executor case in `server/services/skillExecutor.ts`.
- [ ] Author component `client/src/components/recommendations/AgentRecommendationsList.tsx`.
- [ ] Author hook `client/src/hooks/useAgentRecommendations.ts` (fetches by scope, subscribes to socket updates per home-dashboard-reactivity pattern).
- [ ] Read + acknowledge / dismiss endpoints in `server/routes/agentRecommendations.ts`: `GET /api/recommendations?scopeType=&scopeId=&includeDescendantSubaccounts=&limit=` (list), `POST /api/recommendations/:recId/acknowledge`, `POST /api/recommendations/:recId/dismiss` (body: `{reason}`). All three exact contracts pinned in §6.5.
- [ ] Pure unit tests: dedupe-key uniqueness, scope enforcement, severity enum, opening row only when no open match exists.

### Phase 1 — Telemetry rollup queries + cross-tenant median view (~8h)

- [ ] Author 8 query modules under `server/services/optimiser/queries/`:
  - `agentBudget.ts` (reads `cost_aggregates`)
  - `escalationRate.ts` (joins `flow_runs` + `flow_step_outputs` + `review_items` + `actions`; aggregates by `workflow_id` for run/escalation counts and uses modal `flow_step_outputs.stepId` of the escalating runs as `common_step_id` for the §6.5 `step=` deep-link parameter)
  - `skillLatency.ts` (per-sub-account p95 over 7 days from `agent_execution_events`)
  - `inactiveWorkflows.ts` (joins `subaccount_agents` rows where `scheduleEnabled=true AND scheduleCron IS NOT NULL` to `agent_runs.startedAt` last-run; expected cadence computed via `scheduleCalendarServicePure.computeNextHeartbeatAt`)
  - `escalationPhrases.ts` (tokenises `review_items.reviewPayloadJson`; ships the regex-based tokeniser, stopword filter, and n-gram counter required by `escalation.repeat_phrase` — no separate later phase)
  - `memoryCitation.ts` (reads `memory_citation_scores`) — **NEW**
  - `routingUncertainty.ts` (reads `fast_path_decisions`) — **NEW**
  - `cacheEfficiency.ts` (reads `llm_requests` cache columns) — **NEW**
- [ ] Cross-tenant materialised view migration: `migrations/0267a_optimiser_peer_medians.sql` (separate from 0267 so the generic primitive can ship before the optimiser-specific view is needed). Refreshed nightly via pg-boss job. Minimum-tenant threshold of 5 enforced inside the view definition (HAVING clause), not just application logic.
- [ ] pg-boss job `refresh_optimiser_peer_medians` registered + nightly schedule.
- [ ] Each query has its own pure unit test against fixture data (8 test files). The `escalationPhrases.ts` test file is the source-of-truth for ~10 fixture phrase-extraction cases (n-gram counting, stopword filtering, threshold detection).

### Phase 2 — Optimiser agent definition + scan skills (~6h)

- [ ] Author `companies/automation-os/agents/subaccount-optimiser/AGENTS.md` with role, system prompt, skill manifest (8 scan skills + `output.recommend`).
- [ ] Author 8 scan skill markdown specs in `server/skills/optimiser/`. Each maps to a query module from Phase 1.
- [ ] Author 8 evaluator modules under `server/services/optimiser/recommendations/` — pure functions taking query output and emitting `Recommendation[]` shapes ready for `output.recommend`.
- [ ] LLM-render step in agent runtime: small prompt that takes raw evidence + category → 2-3 sentence operator-facing copy. Cached by `(category, dedupe_key, evidence_hash)`. Uses Sonnet (cheap, no need for Opus).
- [ ] Schedule registration: extend `agentScheduleService.registerSubaccountSchedule` invocation point; daily cron at sub-account local 06:00.
- [ ] Backfill (`scripts/backfill-optimiser-schedules.ts`): for every sub-account where `subaccounts.optimiser_enabled=true`, idempotently `INSERT INTO subaccount_agents (...) ON CONFLICT DO NOTHING` to create the optimiser link, then call `agentScheduleService.updateSchedule(linkId, { scheduleCron, scheduleEnabled: true, scheduleTimezone })`. Re-running is safe. Stagger by `created_at` hash across 6-hour window to avoid pg-boss storm.
- [ ] Hook in `subaccountService.create` (or the canonical admin onboarding path): when a new sub-account is created with `optimiser_enabled=true` (the default), create the optimiser `subaccount_agents` link + register its schedule. Idempotent (same `INSERT … ON CONFLICT DO NOTHING` shape as the backfill).
- [ ] Integration test: full run end-to-end against test sub-account with seeded telemetry, assert recommendation rows appear with expected dedupe_keys.

### Phase 3 — Home dashboard wiring (~3h)

- [ ] Add new section to `client/src/pages/DashboardPage.tsx` between "Pending your approval" and "Your workspaces". Section header: "A few things to look at".
- [ ] Wire `<AgentRecommendationsList>` with scope derived from `Layout.tsx` `activeClientId`:
  - `activeClientId === null` → `scope={ type: 'org', orgId: user.organisationId } includeDescendantSubaccounts={true}`
  - `activeClientId !== null` → `scope={ type: 'subaccount', subaccountId: activeClientId }` (no `includeDescendantSubaccounts` — not meaningful in single-subaccount scope)
- [ ] Org-scope rollup verified: with `includeDescendantSubaccounts={true}`, the GET endpoint returns `scope_type='subaccount'` rows for every sub-account the user can read (RLS-gated; no application-layer permission filtering needed) plus any `scope_type='org'` rows. Operator sees per-client items rolled up.
- [ ] Hide section entirely when zero open recs for current scope.
- [ ] "See all N →" link expands inline (no navigation in v1).
- [ ] Socket subscription: emit `dashboard.recommendations.changed` from `output.recommend` insert + acknowledge/dismiss endpoints; client refetches on event per the existing reactivity pattern.

### Phase 4 — Verification (~2h)

- [ ] `npm run lint`, `npm run typecheck` clean.
- [ ] Targeted unit + integration test files authored for this build pass via `npx tsx <path-to-test>`. Full gate suites are CI-only per CLAUDE.md.
- [ ] Manual: enable optimiser on test sub-account with seeded telemetry, trigger run, verify recommendations appear in Home dashboard section in BOTH org and sub-account context, acknowledge/dismiss round-trip.
- [ ] Cost-model sanity: run optimiser for 5 sub-accounts × 7 days, confirm < $0.10 LLM spend.
- [ ] Update `docs/capabilities.md` § Sub-account observability — describe the optimiser AND the new generic primitive.
- [ ] Update `architecture.md` — document the cross-tenant median view as a sysadmin-bypassed read; document `agent_recommendations` as reusable primitive any agent can write to.
- [ ] Update `tasks/builds/subaccount-optimiser/progress.md` with closeout.

---

## §10 Files touched

### Phase 0 — primitive (reusable)

**Server:**
- `migrations/0267_agent_recommendations.sql` (+ `.down.sql`) — `agent_recommendations` table + RLS policies + `subaccounts.optimiser_enabled` boolean column (default true)
- `server/db/schema/subaccounts.ts` — add `optimiser_enabled` column to existing schema export
- `server/db/schema/agentRecommendations.ts` (new)
- `server/db/rlsProtectedTables.ts` (entry)
- `server/db/canonicalDictionary.ts` (entry)
- `server/skills/output/recommend.md` (new generic skill spec)
- `server/services/skillExecutor.ts` (new case for `output.recommend`)
- `server/routes/agentRecommendations.ts` (new — list / acknowledge / dismiss endpoints per §6.5)
- `server/websocket/emitters.ts` (extend — add `dashboard.recommendations.changed` emitter alongside the existing `dashboard.*` emitters from PR #218)
- `server/index.ts` (extend — mount the new `agentRecommendations.ts` router on `/api`)

**Client:**
- `client/src/components/recommendations/AgentRecommendationsList.tsx` (new)
- `client/src/hooks/useAgentRecommendations.ts` (new)

**Tests:**
- Pure unit tests for primitive: dedupe, scope enforcement, severity enum.

### Phase 1-2 — optimiser as first consumer

**Server:**
- `server/services/optimiser/queries/{agentBudget,escalationRate,skillLatency,inactiveWorkflows,escalationPhrases,memoryCitation,routingUncertainty,cacheEfficiency}.ts` (8 new query modules)
- `server/services/optimiser/recommendations/{agentBudget,playbookEscalation,skillSlow,inactiveWorkflow,repeatPhrase,memoryCitation,routingUncertainty,cacheEfficiency}.ts` (8 new evaluator modules)
- `server/services/skillExecutor.ts` (8 cases for scan skills)
- `server/services/agentScheduleService.ts` (register optimiser schedule for sub-accounts)
- `server/services/subaccountService.ts` (extend — hook into sub-account creation to create the optimiser `subaccount_agents` link + register its schedule when `optimiser_enabled=true`; idempotent insert)
- `server/jobs/refreshOptimiserPeerMedians.ts` (new)
- `scripts/backfill-optimiser-schedules.ts` (new) — one-shot script registering daily schedules for existing sub-accounts where `subaccounts.optimiser_enabled = true`; staggered by `created_at` hash across 6-hour window
- `migrations/0267a_optimiser_peer_medians.sql` (+ `.down.sql`) — cross-tenant materialised view `optimiser_skill_peer_medians` over `agent_execution_events`

**Skills + agent:**
- `companies/automation-os/agents/subaccount-optimiser/AGENTS.md` (new)
- `server/skills/optimiser/*.md` (8 scan skill specs)

### Phase 3 — Home dashboard wiring

**Client:**
- `client/src/pages/DashboardPage.tsx` (new section between "Pending your approval" and "Your workspaces"; reads `activeClientId` from the existing `Layout.tsx` context — no edit to `Layout.tsx`)

### Tests

- Per-query unit tests (8 files)
- Per-evaluator unit tests (8 files)
- Phrase-tokeniser tests (~10 cases) — folded into the `escalationPhrases.ts` query unit-test file
- Integration test for full optimiser run

### Docs (Phase 4 closeout)

- `docs/capabilities.md` — sub-account observability + reusable agent recommendations primitive
- `architecture.md` — cross-tenant median view, `agent_recommendations` primitive

---

## §11 Done definition

- `agent_recommendations` table + RLS + `output.recommend` skill + `<AgentRecommendationsList>` component all shipped and reusable by any future agent.
- Optimiser agent runs daily for every active sub-account with `optimiser_enabled=true`.
- Each scan skill produces deterministic output against fixture telemetry.
- Recommendations dedupe correctly — same finding doesn't recreate a row.
- Home dashboard suggestions section renders correctly in BOTH org and sub-account context.
- Section is hidden when zero open recommendations for the current scope.
- Acknowledge / dismiss round-trips via UI.
- Cost stays under $0.02 per sub-account per day in measured production runs.
- All 8 categories produce realistic recommendations against fixture telemetry; user-facing copy is plain English with no category slugs visible to operators.

## §12 Dependencies

- **F1 `subaccount-artefacts`** — not strictly required, but `escalation.repeat_phrase`'s `action_hint` becomes more useful when the brand-voice profile (F1 tier-1 artefact) is captured. Without F1, the action hint points to a generic Configuration Assistant entry. Recommend F1 lands first; F2 can build in parallel and gracefully degrade the action hint.
- **GHL OAuth (Module C)** — not required. Optimiser reads internal telemetry, not GHL data.
- **Riley W3 telemetry** — not required. See §15 for what it would unlock.
- **Home dashboard reactivity (PR #218, merged)** — required and already shipped. The new section piggybacks on the existing `dashboard.*` socket emitter pattern.

## §13 Risks

- **Recommendation noise.** Too many low-value recommendations train operators to ignore the surface. Mitigations: severity tuning, dedupe by `(scope, category, dedupe_key)`, hard cap of 10 open per `(scope, producing_agent_id)`, top-3 + "see all" pattern hides the rest by default.
- **Cross-tenant median view leakage.** The view exposes aggregate p50/p95/p99 per skill across tenants. If a single skill is used by 1-2 tenants, "peer median" reveals their data. Mitigation: minimum 5-tenant threshold per skill before peer comparison fires; below threshold, `skill.slow` evaluator skips the recommendation entirely. Enforced in view definition, not just application logic.
- **Cost overrun on LLM render.** If render copy is regenerated too often. Mitigation: re-render only when `evidence_hash` (sha256 over canonical-JSON of `evidence`) changes between runs (per §6.2). Byte-equal re-runs do not re-render and do not even write to the DB.
- **Schedule storm.** Registering 100+ daily crons at boot may overwhelm pg-boss. Mitigation: stagger by sub-account `created_at` hash → distribute across 6-hour window.
- **Primitive over-extension.** The new `agent_recommendations` table + `output.recommend` skill + `<AgentRecommendationsList>` component are tempting to extend with widget registries, layout engines, custom renderers per agent. **Resist.** §6.4 lists what's explicitly out of scope. Future spec extends; this spec does not.
- **Pre-existing Home dashboard scope tension.** The new section is context-aware; sibling widgets ("Clients Needing Attention", "Active Agents") are not. Operators in sub-account context see a dashboard that's partially scoped and partially not. This is a pre-existing problem that becomes visible because we're adding the first context-aware element. Documented as out-of-scope; flag for follow-up spec.
- **Slug leakage to UI.** A bug or copy mistake could surface a category slug to operators. Mitigation: render layer enforces operator-facing strings only; integration test asserts no slug appears in rendered title/body.

## §14 Concurrent-build hygiene

- Migrations `0267` (table + RLS for `agent_recommendations`) and `0267a` (cross-tenant materialised view `optimiser_skill_peer_medians`) reserved here. Do not use elsewhere. Two-file split is deliberate — the primitive (Phase 0) and the optimiser-specific peer-median view (Phase 1) live on different migration boundaries because the primitive is intended to outlive the optimiser.
- Branch `claude/subaccount-optimiser`. Worktree at `../automation-v1.subaccount-optimiser`.
- Progress lives in `tasks/builds/subaccount-optimiser/progress.md`.
- Touches `server/services/skillExecutor.ts` switch — F1 and F3 don't touch this; safe.
- Touches `server/services/agentScheduleService.ts` — neither F1 nor F3 touches; safe.
- Touches `client/src/pages/DashboardPage.tsx` — F1 and F3 don't touch this; safe.
- Fully independent of F1 and F3. Can land any time.

## §15 What Riley W3 would unlock (when it ships)

W3 (`context.assembly.complete` event in `agentExecutionService.ts`) would emit per-run gap flags: `briefing_missing`, `beliefs_missing`, `memory_missing`, `integration_status`, `pressure`. With that event in place, two new optimiser categories become trivial:

| Category (Riley W3-dependent) | Trigger |
|-------------------------------|---------|
| `context.gap.persistent` | Same gap flag fires > 50% of runs over 7 days for an agent |
| `context.token_pressure` | `pressure='high'` fires consistently — recommend extracting workspace memory entries to reference docs |

These are NOT in v1 scope. **Verified 2026-05-02 against `server/services/agentExecutionService.ts` — no `context.assembly.complete` emit exists today.** When Riley W3 ships, add these as a Phase 5 follow-up to this build (or as v1.1).

---

## Deferred Items

Aggregated from prose markers throughout the spec ("deferred", "later", "v1.1", "future", "out of scope here", "revisit after F2 ships").

- **Org-tier optimiser meta-agent.** Portfolio Health Agent already occupies that role (§0.5). Revisit after F2 ships and operator behaviour with the sub-account optimiser is observed.
- **Auto-execution of recommendations.** v1 is observation-only; operators act via Configuration Assistant deep-link. Out of scope to add an "auto-fix" path to recommendations.
- **Standalone `/suggestions` page.** v1 expands the section inline via "See all N →". v1.1 ships a dedicated page with severity / category / sub-account filters and grouping (§7).
- **Brand-voice ML classification beyond keyword/phrase frequency.** v1 is regex tokeniser + n-gram counts. ML-driven classification deferred until volume justifies (§1).
- **Wider Home dashboard scope-awareness.** Sibling widgets ("Clients Needing Attention", "Active Agents") remain org-scoped today and don't cleanly handle sub-account context. v2 follow-up spec — not solved here (§1, §7, §13).
- **Riley W3 telemetry-dependent categories.** `context.gap.persistent` and `context.token_pressure` become trivial once `context.assembly.complete` ships in `agentExecutionService.ts`; add as Phase 5 follow-up (§15).
- **`agent_recommendations` primitive extensions.** Per §6.4: widget registry, layout engine, charts/KPI tiles, per-agent renderer customisation, multi-step actions, threaded discussion. Deferred indefinitely — separate scope each.
- **Notification surfaces for recommendations** (Slack, email, in-app push). Recommendations are pull-only in v1; future spec can add notification routing on `dashboard.recommendations.changed` events.
- **Sub-account-settings UI toggle for `subaccounts.optimiser_enabled`.** v1 ships the column only; flipping it is admin-SQL or via a Configuration Assistant prompt. A proper settings page (whether a sub-account preferences panel or an integration into existing admin tooling) is deferred until the broader sub-account-settings surface is designed (out of scope here).
