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

8 categories. Each scan skill returns raw evidence; the agent renders user-facing copy via a small LLM prompt. The render output is cached by `(category, dedupe_key, evidence_hash, render_version)` — re-runs with byte-equal evidence and the same render_version reuse the cached copy. An evidence change OR a render_version bump invalidates the cache and triggers re-render. `render_version` is a monotonically-increasing integer constant exported from `server/services/optimiser/renderVersion.ts`; bump it whenever the render-prompt template, the per-category evidence-shape contract, or the output-format contract changes. This keeps stale operator copy from persisting after a prompt tweak.

**Category slugs are internal vocabulary.** They appear in `agent_recommendations.category`, in skill manifests, and in deferred-items routing. They MUST NOT appear in operator-facing UI — the agent renders plain English titles and details.

**Namespace note.** The taxonomy table below uses the short `area.finding` form for readability. The full stored values prepend the agent namespace: `optimiser.agent.over_budget`, `optimiser.playbook.escalation_rate`, etc. (see §6.2 Category naming hard rule). All implementation code and DB values use the full three-segment form; the short form is used throughout this spec only as a typographic convenience.

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
| `llm.cache_poor_reuse` | info | `cacheCreationTokens` > sum of `cachedPromptTokens` over 7 days for any agent (cache costs more than it saves) AND `cacheCreationTokens + cachedPromptTokens >= 5000` over the same window (volume-floor noise guard — agents below this floor produce a too-noisy ratio) | "Caching isn't paying off this week" / "Building the cache is costing more than it's saving on the Reporting Agent." |

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

### Material-change thresholds

A bare evidence hash mismatch is too sensitive to drive re-surfacing — daily fluctuation in costs, latency, and rates would re-clear `acknowledged_at` on every run and train operators to ignore the section. Each category defines a `materialDelta(prev, next): boolean` predicate. Below-threshold deltas are full no-ops: no DB write, no re-render, no re-surface. Above-threshold deltas land the `updated_in_place` path (per §6.2). The predicates live alongside the per-category evidence types in `shared/types/agentRecommendations.ts` (per §6.5).

Each predicate combines a relative threshold with an absolute floor — relative thresholds alone fail when underlying values are small (e.g. `$5 → $5.50` is +10% but operationally trivial). Both branches must hold for the delta to count as material. Rate-based predicates additionally require a minimum supporting-count to ensure the rate itself is meaningful.

| Category | Material-change predicate |
|----------|---------------------------|
| `agent.over_budget` | `abs(next.this_month - prev.this_month) / max(prev.this_month, 1) >= 0.10 AND abs(next.this_month - prev.this_month) >= 1000` (10% relative change AND ≥ 1000 cents = $10 absolute change; codebase stores cost as integer cents) |
| `playbook.escalation_rate` | `abs(next.escalation_pct - prev.escalation_pct) >= 0.10 AND abs(next.escalation_count - prev.escalation_count) >= 3` (10pp rate change AND ≥ 3 escalation-count change) |
| `skill.slow` | `abs(next.ratio - prev.ratio) >= 0.20 AND abs(next.latency_p95_ms - prev.latency_p95_ms) >= 200` (20% ratio change AND ≥ 200ms absolute p95 change) |
| `inactive.workflow` | `next.last_run_at !== prev.last_run_at` (any change is material — a new run resolves the finding entirely; no floor needed) |
| `escalation.repeat_phrase` | `next.count !== prev.count` (any new occurrence is material; the trigger threshold of ≥ 3 occurrences in §2 already enforces volume; no further floor) |
| `memory.low_citation_waste` | `abs(next.low_citation_pct - prev.low_citation_pct) >= 0.10 AND next.total_injected >= 10 AND abs(next.total_injected - prev.total_injected) >= 3` (10pp rate change AND volume floor AND volume change) |
| `agent.routing_uncertainty` | `(abs(next.low_confidence_pct - prev.low_confidence_pct) >= 0.10 OR abs(next.second_look_pct - prev.second_look_pct) >= 0.10) AND next.total_decisions >= 10 AND abs(next.total_decisions - prev.total_decisions) >= 3` |
| `llm.cache_poor_reuse` | `abs(next.creation_tokens - prev.creation_tokens) / max(prev.creation_tokens, 1) >= 0.20 AND abs(next.creation_tokens - prev.creation_tokens) >= 1000` (20% relative AND ≥ 1000 token absolute change; complements the §2 trigger volume floor of ≥ 5000 cache tokens in window) |

Predicates are PURE — no I/O, no clock reads. They take only the prior and current `evidence` shapes. A below-threshold delta is a full no-op: the render-cache key `(category, dedupe_key, evidence_hash, render_version)` does not change (no hash change means no key change), so zero LLM tokens AND zero DB writes.

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

**Refresh staleness is acceptable.** The materialised view refreshes nightly via the `refresh_optimiser_peer_medians` pg-boss job (see §9 Phase 1). Optimiser runs fire at sub-account local 06:00, which means earliest fires (e.g. UTC+13) can land before later UTC-zone refreshes complete. The staleness window is intentional: `skill.slow` uses 7-day-aggregate medians, and a one-day-old peer baseline is still well-correlated with current operator-perceived latency. The job is scheduled at `00:00 UTC` to maximise the cushion before the earliest-timezone optimiser window. No tighter coupling is required for v1.

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
| `optimiser.scan_routing_uncertainty` | Per agent: distribution of `fast_path_decisions.decidedConfidence` + `secondLookTriggered` rate over 7 days. | None | `Array<{agent_id, low_confidence_pct, second_look_pct, total_decisions}>` (`total_decisions` is the count of `fast_path_decisions` rows for the agent in the window — required by the `materialDelta` volume floor in §2) |
| `optimiser.scan_cache_efficiency` | Per agent: sum(`cacheCreationTokens`) vs sum(`cachedPromptTokens`) over 7 days from `llm_requests`. Flag where creation > reused. | None | `Array<{agent_id, creation_tokens, reused_tokens, dominant_skill}>` |
| `output.recommend` (generic — see §6) | Insert / update / no-op a row in `agent_recommendations` keyed by `(scope_type, scope_id, category, dedupe_key)`. Used by the optimiser AND any future agent. Full contract pinned in §6.2. | DB write (sometimes a no-op) | `{recommendation_id: string, was_new: boolean, reason?: 'cap_reached' \| 'updated_in_place'}` (see §6.2 for state transitions) |

All scan skills are pure SQL with no LLM call. The render step (raw evidence → 2-3 sentence operator copy) is one LLM call per new recommendation, batched at the end of a run. The render is keyed on the full cache key `(category, dedupe_key, evidence_hash, render_version)` (see §2 and §6.2) — re-renders fire when, and only when, the `evidence_hash` OR `render_version` changes. Bumping `render_version` in `renderVersion.ts` is the correct way to invalidate cached copy after a prompt-template change; changing only the evidence hash without bumping render_version does not invalidate copy cached under the old prompt. Byte-equal evidence with unchanged render_version is a no-op end-to-end.

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
  dismissed_reason TEXT,
  dismissed_until TIMESTAMPTZ -- cooldown end; NULL when not dismissed; output.recommend skips matches where now() < dismissed_until
);

CREATE UNIQUE INDEX agent_recommendations_dedupe
  ON agent_recommendations(scope_type, scope_id, category, dedupe_key)
  WHERE dismissed_at IS NULL;

CREATE INDEX agent_recommendations_open_by_scope
  ON agent_recommendations(scope_type, scope_id, updated_at DESC)
  WHERE dismissed_at IS NULL AND acknowledged_at IS NULL;

CREATE INDEX agent_recommendations_dismissed_active_cooldown
  ON agent_recommendations(scope_type, scope_id, category, dedupe_key, dismissed_until)
  WHERE dismissed_at IS NOT NULL;

CREATE INDEX agent_recommendations_org
  ON agent_recommendations(organisation_id, created_at DESC);
```

The `dismissed_until` cooldown lookup uses the `agent_recommendations_dismissed_active_cooldown` index — `output.recommend` runs an inner-loop check `SELECT 1 FROM agent_recommendations WHERE scope_type=$1 AND scope_id=$2 AND category=$3 AND dedupe_key=$4 AND dismissed_at IS NOT NULL AND dismissed_until > now() LIMIT 1` before any insert decision. The partial unique index `agent_recommendations_dedupe` cannot widen its `WHERE` clause to reference `now()` (Postgres rejects non-IMMUTABLE expressions in partial-index predicates), so cooldown enforcement is application-side, not constraint-side.

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

**Output:** `{ recommendation_id: string, was_new: boolean, reason?: 'cap_reached' | 'cooldown' | 'updated_in_place' | 'sub_threshold' | 'evicted_lower_priority' }`.

- `was_new=true` (no `reason`) — new row inserted; cap was below 10 for `(scope, producing_agent_id)`.
- `was_new=true, reason='evicted_lower_priority'` — cap was full but the new candidate's priority tuple was higher than the lowest-priority open rec for `(scope, producing_agent_id)`. Executor atomically dismissed the lowest (`dismissed_at=now()`, `dismissed_reason='evicted_by_higher_priority'`, `dismissed_until=now() + interval '6 hours'` — short implicit cooldown so the evicted finding can't oscillate back into the cap on the next run; severity-escalation bypass per the cooldown step still applies) and inserted the new row in the same transaction. Priority ranking (highest to lowest): higher severity rank wins (`critical=3 > warn=2 > info=1`), then **newer `updated_at` wins** (stalest evicted first — rotates eviction by freshness so no single category structurally dominates the cap), then alphabetically-earlier `category` wins, then alphabetically-earlier `dedupe_key` wins. Putting `updated_at` at position 2 (rather than as the final tiebreaker) is deliberate: with category names namespaced (per §6.2 Category naming), alphabetical category ordering would otherwise systematically protect early-alphabet categories (`optimiser.agent.*`) over later-alphabet ones (`optimiser.skill.*`) — every same-severity tie would resolve the same way every run. Freshness-as-second-tiebreaker rotates eviction across categories; full determinism is still preserved by the remaining category/dedupe_key tiebreakers.
- `was_new=false, reason='updated_in_place'` — open recommendation existed for `(scope_type, scope_id, category, dedupe_key)` AND the new `evidence_hash` differs from the stored `evidence_hash` AND the per-category `materialDelta(prev, next)` predicate (per §2 Material-change thresholds) returned TRUE. Executor updates `title`, `body`, `evidence`, `evidence_hash`, `severity`, `action_hint`, and `updated_at` (= `now()`) on the existing row in place; `created_at` is preserved; `acknowledged_at` is set to `NULL` (re-surface the row to the operator since something material changed); `recommendation_id` returned is the existing row's id.
- `was_new=false, reason='sub_threshold'` — open recommendation existed AND the new `evidence_hash` differs from the stored hash, but the per-category `materialDelta(prev, next)` returned FALSE. Full no-op: no DB write, no LLM render, no operator re-surface. `recommendation_id` returned is the existing row's id (callers can correlate). This is the noise-suppression path that prevents day-to-day fluctuation in costs / latency / rates from re-clearing `acknowledged_at`.
- `was_new=false, reason='cap_reached'` — `(scope_type, scope_id, producing_agent_id)` already has 10 open (non-dismissed) recommendations AND the new candidate's priority tuple was NOT higher than the lowest-priority open rec. Insert refused; `recommendation_id` returned is `''`. Executor emits a structured log line `recommendations.dropped_due_to_cap` (per the "tagged-log-as-metric" convention in KNOWLEDGE.md) with fields `{scope_type, scope_id, producing_agent_id, category, severity, dedupe_key}` so cap drops are auditable without a separate observability table.
- `was_new=false, reason='cooldown'` — a dismissed row exists for `(scope_type, scope_id, category, dedupe_key)` with `dismissed_until > now()` AND `severity_rank(new) <= severity_rank(matched_row)`. Insert refused; `recommendation_id` returned is the existing dismissed row's id. Cooldown durations: dismiss-driven cooldowns are per-severity (see §6.5 dismiss endpoint — `critical → now() + 1 day`, `warn → now() + 7 days`, `info → now() + 14 days`); eviction-driven cooldowns are a fixed `now() + 6 hours` (see eviction step of the decision flow). Defaults encoded in `server/services/agentRecommendationsService.ts`; the dismiss endpoint's optional admin-only `cooldown_hours` body param overrides per-call. **Severity-escalation bypass:** if the candidate's severity rank is greater than the dismissed row's, cooldown is ignored and the candidate falls through to insert as a fresh finding (per the cooldown step of the decision flow).
- `was_new=false` (no `reason`) — open match existed AND `evidence_hash` matches exactly. No write performed. The operator-facing copy and the row's `acknowledged_at` state are preserved.

**Decision flow + advisory lock.** All five paths above are decided inside a single transaction guarded by `pg_advisory_xact_lock(hashtext('output.recommend.cap:' || scope_type || ':' || scope_id || ':' || producing_agent_id))`. The lock pattern is lifted from `feature_requests` (per `architecture.md` → "Feature request pipeline"). Within the lock, the executor runs in this order:

1. **Cooldown check.** `SELECT id, severity FROM agent_recommendations WHERE scope_type=$1 AND scope_id=$2 AND category=$3 AND dedupe_key=$4 AND dismissed_at IS NOT NULL AND dismissed_until > now() ORDER BY dismissed_at DESC LIMIT 1`. If a row matches:
   - **Severity-escalation bypass:** if `severity_rank(new) > severity_rank(matched_row)` (where rank is `critical=3 / warn=2 / info=1`), the cooldown is bypassed. The matched dismissed row stays dismissed; the executor falls through to step 2 and the candidate is treated as a fresh finding (insert path). Rationale: a "slightly over budget" dismiss must not lock out re-surfacing when the situation becomes 3× worse.
   - **No bypass:** return `{was_new: false, reason: 'cooldown', recommendation_id: <matched_row_id>}`.
   The bypass uses the dismissed row's severity (not the original-finding severity) — re-bypass requires another severity escalation.
2. **Open-match lookup.** `SELECT id, evidence, evidence_hash FROM agent_recommendations WHERE scope_type=$1 AND scope_id=$2 AND category=$3 AND dedupe_key=$4 AND dismissed_at IS NULL FOR UPDATE`. If hit:
   - Hashes equal → return `{was_new: false, recommendation_id: <existing_id>}` (no `reason`).
   - Hashes differ + `materialDelta(prev, next)` is FALSE → return `{was_new: false, reason: 'sub_threshold', recommendation_id: <existing_id>}`.
   - Hashes differ + `materialDelta` is TRUE → UPDATE row (per `updated_in_place` bullet) + return `{was_new: false, reason: 'updated_in_place', recommendation_id: <existing_id>}`.
3. **Cap check.** `SELECT count(*) FROM agent_recommendations WHERE scope_type=$1 AND scope_id=$2 AND producing_agent_id=$5 AND dismissed_at IS NULL`. If `< 10` → INSERT new row, return `{was_new: true, recommendation_id: <new_id>}`.
4. **Eviction check** (cap reached). `SELECT id, severity, category, dedupe_key, updated_at FROM agent_recommendations WHERE scope_type=$1 AND scope_id=$2 AND producing_agent_id=$5 AND dismissed_at IS NULL ORDER BY <severity rank asc>, updated_at asc, category desc, dedupe_key desc LIMIT 1` (i.e. the lowest-severity + stalest open rec; category/dedupe_key act as final deterministic tiebreakers). Compare new candidate's priority to that lowest row:
   - New > lowest → UPDATE lowest (`dismissed_at=now()`, `dismissed_reason='evicted_by_higher_priority'`, `dismissed_until=now() + interval '6 hours'` — implicit short cooldown so the evicted finding can't immediately reappear and oscillate against the cap on the next run), then INSERT new row. Emit a structured log line `recommendations.evicted_lower_priority` with `{scope_type, scope_id, producing_agent_id, evicted_recommendation_id, evicted_category, evicted_severity, evicted_dedupe_key, incoming_category, incoming_severity, incoming_dedupe_key}` so the displacement is auditable in production. Return `{was_new: true, reason: 'evicted_lower_priority', recommendation_id: <new_id>}`.
   - New ≤ lowest → emit `recommendations.dropped_due_to_cap` log line, return `{was_new: false, reason: 'cap_reached', recommendation_id: ''}`.

The advisory lock + `FOR UPDATE` row lock together eliminate every race: two agents can't insert the 11th row, an evict-and-insert can't be split by an interleaving insert, and a concurrent dismiss can't land between the open-match `FOR UPDATE` and the in-place update (the `FOR UPDATE` blocks the dismiss until this transaction commits or rolls back).

**Evidence hash.** `evidence_hash = sha256(canonical_json(evidence))` where `canonical_json` is RFC 8785 (or equivalent) — recursive sort of object keys, no insignificant whitespace, lowercase hex digest. Computed inside the skill executor before any DB call. Hash compares the full `evidence` value (including numeric values), not just its shape. The hash drives cache-key invalidation and is the trigger for the per-category `materialDelta(prev, next)` check (per §2 Material-change thresholds): byte-equal evidence is a full no-op (no `reason`); a hash delta where `materialDelta` returns FALSE is a `sub_threshold` no-op (no DB write, no re-render, no operator re-surface); a hash delta where `materialDelta` returns TRUE lands the `updated_in_place` path (DB row updated, copy re-rendered, `acknowledged_at` cleared). The hash itself is not the gate for re-surfacing — `materialDelta` is.

**Numeric canonicalisation (avoiding phantom `updated_in_place`).** Number serialisation across JS Number / TypeScript / JSONB / RFC 8785 round-trips can produce hash drift even when the semantic value is unchanged (`1000` vs `1000.0` vs `"1000"`). The hash input is normalised before the SHA call:
- All integer-typed evidence fields (cost in cents, latency in ms, counts, token counts) use TypeScript `number` constrained to integer values; the canonicalisation step asserts `Number.isInteger(value)` and emits the bare integer with no trailing `.0`.
- All percentage / ratio fields are rounded to 4 decimal places (`Math.round(value * 10000) / 10000`) and emitted with exactly 4 decimal places; this fixes the precision that downstream materialDelta predicates compare against.
- All string fields pass through unchanged (RFC 8785's string canonicalisation is already deterministic).
- **All array fields are sorted in ascending lexicographic order before hashing by default.** RFC 8785 does NOT sort arrays — it preserves insertion order — so two calls that produce the same IDs in different orders would generate different hashes and trigger a phantom `updated_in_place`. Default-safe is better than opt-in-safe: forgetting to document an array's order semantics cannot produce hash drift if sorting is the default. To OPT OUT of sorting (i.e. order IS semantically meaningful), annotate the field with `/** @preserveOrder - order carries meaning; do not sort before hashing */` in the TypeScript evidence type. The canonicalisation step reads this annotation and skips sorting for that field only. Currently there are no `@preserveOrder` fields — all list-type evidence (including `sample_escalation_ids`) is sorted ascending.
The canonicalisation lives in `shared/types/agentRecommendations.ts` next to the evidence types and is invoked by `output.recommend` before hashing. Evidence types (per §6.5) carry the integer-vs-percentage-vs-array distinction at the type level so the canonicalisation step is statically routable.

**Pre-write candidate ordering.** When an agent run produces more candidate recommendations than the per-`(scope, producing_agent_id)` cap of 10, the executor's caller (the optimiser agent loop OR any future producer) SHOULD sort candidates before invoking `output.recommend` so cap-eviction churn is minimised. Sort order: severity descending (`critical` > `warn` > `info`), then `category` ascending, then `dedupe_key` ascending. The producer-side sort intentionally omits `updated_at` (the executor's position-2 tiebreaker against open rows) because not-yet-inserted candidates have no stored `updated_at` to participate in. This is a producer-side optimisation, not a correctness requirement: cap eviction is executor-side and priority-aware (per §6.2 — higher-priority candidates displace lower-priority open recs regardless of arrival order), so an unsorted producer is correct but causes more `evicted_lower_priority` outcomes than an ordered one.

**Idempotency posture (per spec-authoring-checklist §10).** Key-based on `(scope_type, scope_id, category, dedupe_key) WHERE dismissed_at IS NULL`. Same-`producing_agent_id` races are serialised by the per-`(scope, producing_agent_id)` advisory lock + `FOR UPDATE` row lock from §6.2 Decision flow — they never reach the unique-index race in practice. Cross-`producing_agent_id` races (two different agents picking the same `(scope, category, dedupe_key)`, which is unusual since agents own their category namespaces per §6.2 Category naming, but legal) hold different advisory locks and can both reach the INSERT step concurrently; the unique index resolves them — first commit wins; the loser catches Postgres `23505` and returns `{ was_new: false, recommendation_id: <existing row id> }` (looked up after the catch). Never bubbles `23505` as a 500. The skill executor maps the exception inside the transaction. Update-in-place path uses the `FOR UPDATE` row lock from step 2 of the decision flow — a concurrent dismiss is blocked until the in-place update commits; no optimistic-CAS predicate needed.

**Retry classification.** `output.recommend` is `safe` (key-based idempotency); callers may retry on transport failure without further coordination. The acknowledge / dismiss HTTP routes are `guarded` — both use `UPDATE agent_recommendations SET … WHERE id = $1 AND dismissed_at IS NULL` (or `acknowledged_at IS NULL` for acknowledge); a second call lands as a 200-idempotent-no-op rather than a 409.

**Permission:** any agent with `output.recommend` in its skill manifest can call it. The executor enforces that `scope_id` belongs to the agent's organisation by resolving `scope_id → organisation_id` and comparing to `req.orgId` / the agent's organisation.

**`producing_agent_id` provenance.** `producing_agent_id` is NOT part of the `output.recommend` input contract — it is derived from the calling agent's execution context inside the executor (`SkillExecutionContext.agentId`). Callers cannot supply or override it. Non-agent invocations of `output.recommend` (e.g. a route handler trying to call the skill directly outside an `agent_runs` context) are rejected with `failure(FailureReason.InvalidInput, 'output.recommend requires an agent execution context')`. This guarantees the cap-lock key `(scope_type, scope_id, producing_agent_id)` is always honestly populated and prevents one agent from saturating another's slot in the open-rec cap.

**Run-level atomicity invariant.** A single optimiser agent run MUST produce a deterministic final set of open recommendations regardless of execution interleaving. This invariant is guaranteed by three interlocking properties:
1. **Pre-sort:** the optimiser's evaluator-orchestration layer sorts all candidates by the priority tuple before the first `output.recommend` call (per the Pre-write candidate ordering paragraph above). Every run with the same candidates produces the same call sequence.
2. **Sequential calls:** `output.recommend` is called sequentially within a run, not concurrently. No two calls for the same `(scope, producing_agent_id)` overlap within a single run.
3. **One-at-a-time scheduling:** the pg-boss schedule for each sub-account's daily optimiser run MUST be registered with a per-`(subaccount_id, agent_id)` singleton key (`singletonKey` in pg-boss terminology) to prevent two concurrent runs from racing on the same subaccount's cap. If a previous run is still executing when the next schedule fires, the second run is dropped rather than queued. This is a Phase 2 implementation requirement on `agentScheduleService.registerSubaccountSchedule`.

Together these guarantee that the surface visible to an operator after a run is the same as if all candidate recommendations had been evaluated atomically. Partial failure (a scan skill erroring mid-run) is observable via `recommendations.scan_failed` but does not invalidate the determinism guarantee for the categories that did complete.

**Category naming: hard rule.** Format is `<agent_namespace>.<area>.<finding>` — three segments, no exceptions. No schema constraint enforces this, but the unique index on `(scope_type, scope_id, category, dedupe_key)` means two agents using the same short-form category name will silently share the same dedupe slot and overwrite each other's findings. The three-segment format prevents this by scoping each agent's categories to its namespace. Examples:
- `optimiser.agent.over_budget` — sub-account optimiser, agent area, budget finding
- `portfolio.agent.cross_client_outlier` — portfolio health agent (future), if it writes recommendations
- `custom.crm.contact_sync_lag` — a hypothetical user-authored agent

The primitive does not enforce a registry of valid namespaces or areas — agents own their category strings. The **executor enforces the three-segment format at runtime**: before any DB operation, `output.recommend` validates `category.split('.').length >= 3` and that `category.startsWith(agentNamespace + '.')` where `agentNamespace` is derived from the calling agent's `AGENTS.md` role definition. Categories failing this check throw a hard `failure(FailureReason.InvalidInput, 'Category must follow <agent_namespace>.<area>.<finding> format')` — no silent overwrite, no partial write. The spec's taxonomy table uses the short `area.finding` form as a typographic shorthand (per §2 Namespace note); DB values always use the full three-segment form.

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
  collapsedDistinctScopeId?: boolean, // default true when scope.type='org' AND
                                      // includeDescendantSubaccounts=true AND mode='collapsed'.
                                      // When effective, the component dedupes rows by scope_id
                                      // BEFORE applying limit, keeping only the highest-priority
                                      // row per scope_id. Prevents one noisy subaccount from
                                      // dominating the top-3 in cross-client rollup. The dedupe
                                      // is purely a render-layer rule; the underlying fetch and
                                      // total-count are unchanged.
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

**Org-rollup collapsed-mode dedupe.** When `collapsedDistinctScopeId` is effective (per the prop default rule above), the component groups fetched rows by `scope_id`, keeps only the highest-priority row per scope_id (using the same priority tuple as the cap-eviction in §6.2 — severity desc → category asc → dedupe_key asc), then slices to `limit`. Expanded mode skips this dedupe and renders all visible rows. Sub-account context never triggers the dedupe (only one scope_id present). The `total` reported via `onTotalChange` always reflects the full post-RLS row count, NOT the post-dedupe count, so "See all N →" matches what the operator finds in the expanded view.

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
    "category": "optimiser.agent.over_budget",
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

**Per-category evidence shapes.** The `evidence` column is JSONB, but each optimiser category emits a stable shape so evaluators, the render prompt, the `materialDelta` predicate, and downstream consumers can rely on the field set. Shapes live in `shared/types/agentRecommendations.ts` as a discriminated union keyed on `category`. Future agents adding new categories MUST add their shape to the same file. No DB-level constraint enforces these — they are a TypeScript contract the producer side honours.

```ts
// shared/types/agentRecommendations.ts (excerpt)
export type AgentOverBudgetEvidence = { agent_id: string; this_month: number; last_month: number; budget: number; top_cost_driver: string };
export type PlaybookEscalationRateEvidence = { workflow_id: string; run_count: number; escalation_count: number; escalation_pct: number; common_step_id: string };
export type SkillSlowEvidence = { skill_slug: string; latency_p95_ms: number; peer_p95_ms: number; ratio: number };
export type InactiveWorkflowEvidence = { subaccount_agent_id: string; agent_id: string; agent_name: string; expected_cadence: string; last_run_at: string | null };
export type EscalationRepeatPhraseEvidence = { phrase: string; count: number; sample_escalation_ids: string[] };
export type MemoryLowCitationWasteEvidence = { agent_id: string; low_citation_pct: number; total_injected: number; projected_token_savings: number };
export type AgentRoutingUncertaintyEvidence = { agent_id: string; low_confidence_pct: number; second_look_pct: number; total_decisions: number };
export type LlmCachePoorReuseEvidence = { agent_id: string; creation_tokens: number; reused_tokens: number; dominant_skill: string };

export type RecommendationEvidence =
  | { category: 'agent.over_budget' } & AgentOverBudgetEvidence
  | { category: 'playbook.escalation_rate' } & PlaybookEscalationRateEvidence
  | { category: 'skill.slow' } & SkillSlowEvidence
  | { category: 'inactive.workflow' } & InactiveWorkflowEvidence
  | { category: 'escalation.repeat_phrase' } & EscalationRepeatPhraseEvidence
  | { category: 'memory.low_citation_waste' } & MemoryLowCitationWasteEvidence
  | { category: 'agent.routing_uncertainty' } & AgentRoutingUncertaintyEvidence
  | { category: 'llm.cache_poor_reuse' } & LlmCachePoorReuseEvidence;

export const materialDelta: Record<RecommendationEvidence['category'], (prev: any, next: any) => boolean> = {
  // per-category predicates — see §2 Material-change thresholds for the exact rules
};
```

The `evidence` row column persists the shape MINUS the `category` discriminator (since the row already has its own `category` column). Producer code constructs the discriminated-union value, and the `output.recommend` executor strips `category` before insert.

**`output.recommend` input/output** — already pinned in §6.2 (input contract + output discriminated by `was_new` and `reason`). Producer: any agent with the skill in its manifest. Consumer: `skillExecutor.ts`.

**Read endpoint** (the GET that `useAgentRecommendations` calls).
- `GET /api/recommendations?scopeType=org|subaccount&scopeId=<uuid>&includeDescendantSubaccounts=<bool>&limit=<int>` — returns `{ rows: AgentRecommendationRow[], total: number }` where `AgentRecommendationRow` matches the §6.3 row-data contract (including the `subaccount_display_name` field populated only for rolled-up sub-account rows). Default `limit=20`; cap at 100. Sort: severity desc → `updated_at` desc (so a recently-re-rendered finding bubbles to the top of the list). Filters out `acknowledged_at IS NOT NULL` and `dismissed_at IS NOT NULL` rows by default (no query param to surface them in v1).
- `total` is the post-RLS open-row count for the requested scope, NOT clamped to `limit`. The `<AgentRecommendationsList>` component fires `onTotalChange(total)` so the parent can render "See all N →" with the real N.
- Auth-gated (`authenticate`); RLS scopes rows to the caller's org. When `scopeType=org AND includeDescendantSubaccounts=true`, the route does a single SQL with `OR (scope_type='subaccount' AND scope_id IN (SELECT id FROM subaccounts WHERE organisation_id = $orgId))` — RLS does the per-subaccount visibility filter automatically, no app-layer permission filter.
- 404 when `scopeId` doesn't exist or isn't visible to the caller. 422 on bad `scopeType`/`scopeId` shape.

**Acknowledge / dismiss HTTP endpoints.**
- `POST /api/recommendations/:recId/acknowledge` — request body `{}`; response `{ success: true, alreadyAcknowledged: boolean }`. Idempotent: a second call returns `alreadyAcknowledged: true` rather than 409. 404 when `:recId` doesn't exist or isn't visible to the caller (RLS-filtered).
- `POST /api/recommendations/:recId/dismiss` — request body `{ reason: string, cooldown_hours?: number }` (`reason` max 500 chars; `cooldown_hours` admin-only — silently ignored if the caller is not a system admin per the standard `requireSystemAdmin` guard pattern). Response `{ success: true, alreadyDismissed: boolean, dismissed_until: string }` (ISO 8601 timestamp). Idempotent on the dismiss path; the second call's `reason` and `cooldown_hours` are ignored. 404 same as above. Cooldown defaults are computed from the row's `severity` at dismiss time: `critical → +1d`, `warn → +7d`, `info → +14d`. Admin override via `cooldown_hours` clamps to `[1, 24*90]` (1 hour to 90 days). The cooldown end date is what blocks future `output.recommend` calls from recreating the row (per §6.2 cooldown path) — once `dismissed_until` is in the past, a new evaluation will produce a fresh row with a new `id`.
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

  Same shape for dismiss with `acknowledged_at` swapped for `dismissed_at`, `reason` recorded in `dismissed_reason`, AND `dismissed_until` set to `now() + interval '<H> hours'` where `H` is `cooldown_hours` (admin-only override) or the per-severity default (`critical=24`, `warn=168`, `info=336`). The `dismissed_until` column is computed inside the same `UPDATE` so the cooldown landing is atomic with the dismiss transition. `updated_at` is bumped on both transitions. No `23505` edge applies — there is no unique-constraint involvement on the UPDATE path.

**Implicit acknowledge on deep-link click.** The "Help me fix this →" UI affordance triggers the acknowledge endpoint client-side as a fire-and-forget `POST` immediately after the deep-link navigation begins (the user has acted on the recommendation, so it should leave the operator's list). The dismiss × button is the only explicitly-visible alternate row action in v1 — there is no separate visible "Acknowledge" button. This keeps the row contract clean (one primary action + one dismiss) per the frontend design principles. If the user does NOT click the deep-link and instead returns to the dashboard later, the recommendation remains visible.

**Click feedback before navigation.** The click-to-deep-link transition needs a beat of visible feedback so the row's later disappearance feels caused, not arbitrary. The component fades the row to 50% opacity and replaces the "Help me fix this →" text with "Marked as resolved" inline for a 250ms beat before initiating navigation. The fire-and-forget `POST /acknowledge` runs in parallel with the visual beat, not after it — total user-perceived latency stays at 250ms regardless of network state. If the user navigates away during the beat (back button, sidebar nav), the acknowledge POST has already been dispatched and lands when the network resolves; the row will be hidden by the socket-driven refetch on next dashboard mount.

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
- **Refetch debounce.** Bulk runs can produce many events in close succession (e.g. 8 new recs in one optimiser run → 8 `created` events). The hook debounces refetches with a 250ms trailing window: events arriving within 250ms of each other coalesce into a single refetch. Ref-held timer; cancellation on unmount; no leading-edge fire (the trailing-only debounce keeps the surface stable while the bulk batch lands rather than rendering twice).

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

Sub-header line (12.5px, slate-500): the freshness label, plus a sec-link "See all N →" on the right when there are more than 3 open recommendations. The freshness label is rendered from the maximum `updated_at` across the rows in the current scope (e.g. "Updated this morning" if the most-recent `updated_at` was within the last 4 hours; "Updated yesterday" otherwise — exact thresholds in `client/src/lib/relativeTime.ts`). The N comes from the `onTotalChange` callback fired by `<AgentRecommendationsList>` after each fetch (per §6.3). DashboardPage holds `[mode, setMode] = useState<'collapsed'|'expanded'>('collapsed')` and `[total, setTotal] = useState(0)`; clicking the "See all N →" link calls `setMode('expanded')` to flip the same component into expanded mode in place — no navigation in v1. Expanded mode fetches `limit=100` (the GET endpoint's hard cap); if `total > 100`, the truncation is acknowledged in the UI with the copy **"Showing top 100 of N"** (no link to /suggestions — that page is a v1.1 deferred item that doesn't exist yet; linking to it would create a dead-end for operators who know more exists but can't access it).

Body: top 3 open recommendations rendered by `<AgentRecommendationsList limit={3} mode={mode} onTotalChange={setTotal} … />` with the props above. Each row: severity dot, plain-English title (operator copy), one-sentence detail (operator copy with concrete numbers), "Help me fix this →" deep-link to Configuration Assistant. In org context with cross-client rollup (`includeDescendantSubaccounts={true}`), the collapsed top-3 dedupes by `scope_id` (per §6.3 "Org-rollup collapsed-mode dedupe") so one noisy subaccount cannot dominate the surface — the operator sees up to one row per subaccount in the top-3, with the rest available via "See all N →".

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

- [ ] Author migration `migrations/0267_agent_recommendations.sql` (+ `.down.sql`). Same migration adds the boolean column `subaccounts.optimiser_enabled NOT NULL DEFAULT true` (the opt-out toggle referenced in §1, §4, §8, §9, §11) AND the four `agent_recommendations` indexes (dedupe partial-unique, open-by-scope, dismissed-active-cooldown, organisation-id rollup) per §6.1. Not added as a separate migration because all are conceptually owned by the optimiser feature; a dedicated migration would be heavier overhead than the primitive itself.
- [ ] Add table to `server/db/schema/agentRecommendations.ts` (including `dismissed_until TIMESTAMPTZ` column and discriminated-union `RecommendationEvidence` type).
- [ ] Register in `rlsProtectedTables.ts` and `canonicalDictionary.ts`.
- [ ] RLS policies migration entry per `0245_all_tenant_tables_rls.sql` pattern (folded into 0267).
- [ ] Author `shared/types/agentRecommendations.ts` — discriminated-union evidence types per §6.5 + `materialDelta` registry per §2 Material-change thresholds.
- [ ] Author `server/services/optimiser/renderVersion.ts` exporting `RENDER_VERSION` (integer constant, currently `1`). Bump policy: prompt-template change, evidence-shape change, output-format change.
- [ ] Author skill `server/skills/output/recommend.md` + executor case in `server/services/skillExecutor.ts` implementing the §6.2 decision flow (cooldown check → open-match lookup with `materialDelta` → cap check → eviction-or-drop). Drop log uses the existing tagged-log-as-metric convention.
- [ ] Author component `client/src/components/recommendations/AgentRecommendationsList.tsx` (including `collapsedDistinctScopeId` prop per §6.3 and click-feedback beat per §6.5).
- [ ] Author hook `client/src/hooks/useAgentRecommendations.ts` (fetches by scope, subscribes to socket updates per home-dashboard-reactivity pattern).
- [ ] Read + acknowledge / dismiss endpoints in `server/routes/agentRecommendations.ts`: `GET /api/recommendations?scopeType=&scopeId=&includeDescendantSubaccounts=&limit=` (list), `POST /api/recommendations/:recId/acknowledge`, `POST /api/recommendations/:recId/dismiss` (body: `{reason, cooldown_hours?}`; admin-only `cooldown_hours` override). All three exact contracts pinned in §6.5.
- [ ] Pure unit tests: dedupe-key uniqueness, scope enforcement, severity enum, opening row only when no open match exists, per-category `materialDelta` predicates against fixture deltas (relative threshold, absolute floor, volume floor for rate-based predicates), cap-eviction priority comparison, dismiss-cooldown behaviour (cooldown-active → no-op; cooldown-expired → fresh row), eviction implicit 6h cooldown (evicted row carries `dismissed_until`), severity-escalation bypass (cooldown-active → bypass when `severity_rank(new) > severity_rank(matched)`).

### Phase 1 — Telemetry rollup queries + cross-tenant median view (~8h)

- [ ] Author 8 query modules under `server/services/optimiser/queries/`:
  - `agentBudget.ts` (reads `cost_aggregates`)
  - `escalationRate.ts` (joins `flow_runs` + `flow_step_outputs` + `review_items` + `actions`; aggregates by `workflow_id` for run/escalation counts and uses modal `flow_step_outputs.stepId` of the escalating runs as `common_step_id` for the §6.5 `step=` deep-link parameter)
  - `skillLatency.ts` (per-sub-account p95 over 7 days from `agent_execution_events`)
  - `inactiveWorkflows.ts` (joins `subaccount_agents` rows where `scheduleEnabled=true AND scheduleCron IS NOT NULL` to `agent_runs.startedAt` last-run; expected cadence computed via `scheduleCalendarServicePure.computeNextHeartbeatAt`)
  - `escalationPhrases.ts` (tokenises `review_items.reviewPayloadJson`; ships the regex-based tokeniser, stopword filter, and n-gram counter required by `escalation.repeat_phrase` — no separate later phase). Tokeniser pre-processes input via lowercase + strip punctuation + suffix-stem the basic English suffixes (`-ing`, `-ed`, `-s`) before n-gram counting, so casing and inflection variants ("guarantee" / "Guarantee" / "guaranteed" / "guarantees") collapse into one count. Suffix-stripping is intentionally minimal — no full Porter / Snowball stemmer, just the three suffix patterns.
  - `memoryCitation.ts` (reads `memory_citation_scores`) — **NEW**
  - `routingUncertainty.ts` (reads `fast_path_decisions`) — **NEW**
  - `cacheEfficiency.ts` (reads `llm_requests` cache columns) — **NEW**
- [ ] Cross-tenant materialised view migration: `migrations/0267a_optimiser_peer_medians.sql` (separate from 0267 so the generic primitive can ship before the optimiser-specific view is needed). Refreshed nightly via pg-boss job. Minimum-tenant threshold of 5 enforced inside the view definition (HAVING clause), not just application logic.
- [ ] **Query cost guardrails for scan modules.** Every scan module's SQL MUST include `WHERE created_at >= now() - interval '7 days'` (or the equivalent timestamp filter for tables without `created_at` — e.g. `agent_runs.startedAt`, `agent_execution_events.timestamp`). The 7-day window is the hard scan ceiling — it bounds query cost as the source tables grow. Phase 1 verification: each query module's unit test asserts the WHERE clause filters by the date column (parser check, not just behaviour). Composite-index check (Phase 1 verification step): confirm via `pg_indexes` that source tables carry `(subaccount_id|organisation_id|agent_id, created_at|started_at|timestamp)` composite indexes — `agent_runs(organisation_id, started_at)`, `agent_execution_events(run_id, timestamp)`, `cost_aggregates(scope_id, created_at)`, `memory_citation_scores(run_id, created_at)`, `fast_path_decisions(agent_id, created_at)`, `llm_requests(agent_id, created_at)`. If a required index is missing, add it as part of the optimiser query module's test (the test file lists the assumed indexes; the assertion runs on a fresh DB and fails if any index is absent). No new index migration is added unless verification fails — the existing schema is the source of truth.
- [ ] pg-boss job `refresh_optimiser_peer_medians` registered + nightly schedule.
- [ ] Each query has its own pure unit test against fixture data (8 test files). The `escalationPhrases.ts` test file is the source-of-truth for ~10 fixture phrase-extraction cases (n-gram counting, stopword filtering, threshold detection).

### Phase 2 — Optimiser agent definition + scan skills (~6h)

- [ ] Author `companies/automation-os/agents/subaccount-optimiser/AGENTS.md` with role, system prompt, skill manifest (8 scan skills + `output.recommend`).
- [ ] Author 8 scan skill markdown specs in `server/skills/optimiser/`. Each maps to a query module from Phase 1.
- [ ] Author 8 evaluator modules under `server/services/optimiser/recommendations/` — pure functions taking query output and emitting `Recommendation[]` shapes ready for `output.recommend`.
- [ ] Wrap each scan-skill invocation in the agent runtime with a try/catch that emits a structured log line `recommendations.scan_failed` with `{category, error_type, error_message_redacted}` on failure. The run continues with the remaining scan skills rather than aborting on the first failure — silent partial failures must be observable. Log shape follows the tagged-log-as-metric convention (sister to `recommendations.dropped_due_to_cap` and `recommendations.evicted_lower_priority`).
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
- `migrations/0267_agent_recommendations.sql` (+ `.down.sql`) — `agent_recommendations` table (including `dismissed_until` cooldown column) + four indexes per §6.1 + RLS policies + `subaccounts.optimiser_enabled` boolean column (default true)
- `server/db/schema/subaccounts.ts` — add `optimiser_enabled` column to existing schema export
- `server/db/schema/agentRecommendations.ts` (new — includes `dismissed_until` column)
- `server/db/rlsProtectedTables.ts` (entry)
- `server/db/canonicalDictionary.ts` (entry)
- `server/services/optimiser/renderVersion.ts` (new — `RENDER_VERSION` integer constant; bumped on prompt / evidence / output-format change)
- `server/services/agentRecommendationsService.ts` (new — per-severity cooldown defaults, eviction priority comparator, drop-log helper)
- `server/skills/output/recommend.md` (new generic skill spec)
- `server/services/skillExecutor.ts` (new case for `output.recommend` implementing the §6.2 decision flow)
- `server/routes/agentRecommendations.ts` (new — list / acknowledge / dismiss endpoints per §6.5; dismiss accepts optional admin `cooldown_hours`)
- `server/websocket/emitters.ts` (extend — add `dashboard.recommendations.changed` emitter alongside the existing `dashboard.*` emitters from PR #218)
- `server/index.ts` (extend — mount the new `agentRecommendations.ts` router on `/api`)

**Shared:**
- `shared/types/agentRecommendations.ts` (new — discriminated-union evidence types per §6.5 + `materialDelta` registry per §2)

**Client:**
- `client/src/components/recommendations/AgentRecommendationsList.tsx` (new — includes `collapsedDistinctScopeId` rendering rule and click-feedback beat per §6.5)
- `client/src/hooks/useAgentRecommendations.ts` (new)

**Tests:**
- Pure unit tests for primitive: dedupe, scope enforcement, severity enum, per-category `materialDelta` predicates, cap-eviction priority comparison, dismiss-cooldown behaviour.

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

- **Recommendation noise.** Too many low-value recommendations train operators to ignore the surface. Mitigations: severity tuning, dedupe by `(scope, category, dedupe_key)`, hard cap of 10 open per `(scope, producing_agent_id)` with priority-aware eviction (per §6.2 — higher-priority candidates displace lower-priority open recs rather than getting silently dropped, with a 6h implicit cooldown on the evicted row to prevent oscillation against the cap), per-category material-change thresholds combining relative AND absolute floors (per §2 — sub-threshold deltas are full no-ops, never re-surface), per-severity dismiss cooldown (`dismissed_until` blocks recreation for 1d / 7d / 14d after dismiss per §6.5), severity-escalation bypass (a finding becoming materially worse during cooldown is allowed to re-surface per §6.2 cooldown step), top-3 + "see all" pattern hides the rest by default. Cap drops emit `recommendations.dropped_due_to_cap` log lines and evictions emit `recommendations.evicted_lower_priority` log lines (per the tagged-log-as-metric convention) so silent suppression and displacement both stay auditable.
- **Cross-tenant median view leakage.** The view exposes aggregate p50/p95/p99 per skill across tenants. If a single skill is used by 1-2 tenants, "peer median" reveals their data. Mitigation: minimum 5-tenant threshold per skill before peer comparison fires; below threshold, `skill.slow` evaluator skips the recommendation entirely. Enforced in view definition, not just application logic.
- **Cost overrun on LLM render.** If render copy is regenerated too often. Mitigation: render is keyed on `(category, dedupe_key, evidence_hash, render_version)` — re-renders fire only when evidence_hash OR render_version changes (per §2 and §6.2). Byte-equal evidence with unchanged render_version is a complete no-op. RENDER_VERSION bumps are intentional and infrequent (prompt-template or output-format change only).
- **Schedule storm.** Registering 100+ daily crons at boot may overwhelm pg-boss. Mitigation: stagger by sub-account `created_at` hash → distribute across 6-hour window.
- **Primitive over-extension.** The new `agent_recommendations` table + `output.recommend` skill + `<AgentRecommendationsList>` component are tempting to extend with widget registries, layout engines, custom renderers per agent. **Resist.** §6.4 lists what's explicitly out of scope. Future spec extends; this spec does not.
- **Pre-existing Home dashboard scope tension.** The new section is context-aware; sibling widgets ("Clients Needing Attention", "Active Agents") are not. Operators in sub-account context see a dashboard that's partially scoped and partially not. This is a pre-existing problem that becomes visible because we're adding the first context-aware element. Documented as out-of-scope; flag for follow-up spec.
- **Slug leakage to UI.** A bug or copy mistake could surface a category slug to operators. Mitigation: render layer enforces operator-facing strings only; integration test asserts no slug appears in rendered title/body.
- **Silent scan failures.** A single broken evaluator module could cause a category to silently stop producing recommendations — operators see "fewer issues" but the underlying detection is dead. Mitigation: each scan-skill invocation is wrapped in try/catch; failures emit `recommendations.scan_failed` structured log lines (per §9 Phase 2) so partial failures are observable in production logs and the run continues with the remaining categories.

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
- **Routing-uncertainty trigger refinement using `downstreamOutcome`** (per ChatGPT review F8 — 2026-05-02). Current trigger: confidence < 0.5 OR secondLook > 30%. Refined trigger would couple the signal to outcome quality (e.g. low confidence + bad outcome rate, OR high secondLook + low improvement) so healthy "cautious" agents aren't flagged. Deferred until v1 ships and baseline outcome-quality data exists to tune thresholds against.
- **Periodic schedule-rebalancing job** (per ChatGPT review F10 — 2026-05-02). The Phase 2 backfill staggers daily-cron registration by sub-account `created_at` hash across a 6-hour window, which prevents pg-boss storms at deploy time but does not rebalance when many new sub-accounts are added at once post-deploy. A periodic redistribution job (compute target slot per sub-account, re-issue `agentScheduleService.updateSchedule` if drift > N) is deferred until sub-account creation rate becomes a measurable concern.
- **Stateful empty-state UX for the suggestions section** (per ChatGPT review F14 — 2026-05-02). Current spec is "hide section when empty" (aligns with `frontend-design-principles.md` "Default to hidden"). A more sophisticated rule — show the section after first-ever appearance for a scope, then hide only when transitioning from non-empty back to empty — would prevent the "expected section disappeared" surprise but introduces stateful UX that needs design. Defer to v1.1 or until operator feedback indicates the simpler rule causes confusion.
- **Cap-eviction category-diversity bias** (per ChatGPT review R2-F3 — 2026-05-02). Current eviction priority tuple is `severity desc → category asc → dedupe_key asc`. ChatGPT proposed a soft diversity preference (prefer evicting same-category-as-incoming first, fallback to global lowest priority) to prevent any single category from dominating long-term. Deferred because the simple form of the rule has hidden correctness risks — without a priority floor it could evict a `critical` rec of the same category to make room for a `warn` rec of the same category. Revisit when production data shows actual category dominance, then design a correctness-safe variant (likely "prefer same-category at-or-below incoming severity" rather than unconditional category preference).
- **`evidence_version` field for evidence-shape evolution** (per ChatGPT review R2-F7 — 2026-05-02). ChatGPT proposed adding an optional `evidence_version: number` to evidence shapes and including it in the `evidence_hash` input so that evolving an evidence shape doesn't trigger unintended re-surfacing across already-stored rows. Deferred because (a) `render_version` already covers the prompt-template change axis (the most common reason to invalidate cached copy) and (b) pre-production posture means an evidence-shape change can ship with a one-shot DB rewrite (no deployed users to disrupt). Revisit when the first evidence-shape evolution is needed and the migration pattern's complexity warrants the indirection.
- **Acknowledge-clear ramp threshold** (per ChatGPT review R3-F3 — 2026-05-02). Current rule: `updated_in_place` clears `acknowledged_at` whenever `materialDelta` returns TRUE. ChatGPT proposed an additional ramp: only clear if severity increased OR delta > 2× threshold, so borderline-material oscillations don't aggressively re-surface. Deferred because the current `materialDelta` floors already absorb most micro-noise, and tuning the 2× multiplier requires production usage data. Revisit if operators report that just-over-threshold deltas are training them to ignore the surface.
- **Soft global per-scope cap across producing agents** (per ChatGPT review R3-F4 — 2026-05-02). Current cap is `(scope, producing_agent_id)` = 10 open. ChatGPT flagged future fragmentation risk: when multiple agents write to the same surface, an operator could see 10 from each producer = 30+ items without an upper bound. Deferred because v1 ships only one optimiser agent; multi-producer fragmentation isn't a real risk yet. Revisit when a second agent (e.g. Portfolio Health, system-monitoring) starts writing recommendations to the same scope.
- **Eviction priority reorder: severity → updated_at → category → dedupe_key** (per ChatGPT review R4-F3 — 2026-05-02). Current tuple is severity → category → dedupe_key → updated_at. ChatGPT proposed moving `updated_at` to position 2 to remove alphabetical-category bias (`agent.*` always beating `memory.*`). Deferred because the R4-F1 category-namespace hard rule (`optimiser.agent.*` vs `optimiser.memory.*`) scopes all bias within a single agent's namespace, eliminating the cross-agent concern that motivated the reorder. Within one agent's namespace, alphabetical category ordering is an arbitrary but stable tiebreaker — predictability across daily runs is worth more than removing within-agent alphabetical ordering. Revisit if production eviction logs reveal that one category systematically blocks others within the same namespace in ways an operator notices.
- **Bypass-once-per-cooldown-window guard** (per ChatGPT review R4-F5 — 2026-05-02). Severity-escalation bypass can oscillate: warn → dismiss → critical → bypass → warn → cooldown → critical → bypass again. Fix: track `last_escalation_bypass_at` on the row and allow bypass only once per cooldown window. Deferred because the scenario requires multi-severity oscillations within one cooldown window, which won't appear in pre-production telemetry. Revisit after launch if `recommendations.evicted_lower_priority` or cooldown bypass logs show oscillation patterns for specific categories.
- **"Ongoing for X days" UI persistence indicator** (per ChatGPT review R3-F7 — 2026-05-02). `created_at` and `updated_at` are both stored; the UI today sorts by `updated_at` desc but doesn't expose persistence (e.g. "this finding has been open for 5 days"). Deferred because v1's surface is "what to look at right now" — persistence indicators require an established operator workflow that benefits from them, and that workflow doesn't exist pre-launch. No schema change needed when this is revisited; UI-only enhancement.
