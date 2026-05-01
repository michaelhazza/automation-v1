# Sub-Account Optimiser Meta-Agent — Dev Spec

**Status:** DRAFT (v2 — post-design-review 2026-05-02)
**Build slug:** `subaccount-optimiser`
**Branch:** `claude/subaccount-optimiser`
**Migrations claimed:** `0267`
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

**Prototypes:** `prototypes/subaccount-optimiser/index.html`

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

8 categories. Each scan skill returns raw evidence; the agent renders user-facing copy via a small LLM prompt cached by `dedupe_key`.

**Category slugs are internal vocabulary.** They appear in `agent_recommendations.category`, in skill manifests, and in deferred-items routing. They MUST NOT appear in operator-facing UI — the agent renders plain English titles and details.

Each recommendation row has: `category`, `severity` (`info` / `warn` / `critical`), `title`, `body`, `evidence` (jsonb with metric values), `action_hint`, `dedupe_key`, `dismissed_at`, `acknowledged_at`.

### Original 5 categories (telemetry already shipped)

| Slug | Severity | Trigger | Example user-facing copy (title + detail) |
|------|----------|---------|-------------------------------------------|
| `agent.over_budget` | critical | Agent monthly cost > 1.3× its budget for 2 consecutive months | "Reporting Agent is spending more than expected" / "It used $73 this month against a $50 budget. Same story last month." |
| `playbook.escalation_rate` | critical | Workflow run escalates to HITL > 60% over 14 days | "An outreach workflow keeps needing your help" / "8 of the last 12 runs got stuck on the email step and asked a person to step in." |
| `skill.slow` | warn | Skill p95 latency > 4× cross-tenant median for that skill, sustained 7 days | "Pulling contacts from GHL is slow" / "Around 12 seconds here, around 3 seconds for your other clients." |
| `inactive.workflow` | warn | Workflow with `autoStartOnSchedule: true` hasn't run in (cadence × 1.5) days | "Portfolio Health check stopped running" / "Was scheduled weekly. Hasn't run since 17 April." |
| `escalation.repeat_phrase` | info | Same prohibited phrase / brand-voice violation triggers ≥ 3 HITL escalations in 7 days | "Reviewers keep flagging the word 'guarantee'" / "It came up in 3 of the last 4 emails you reviewed. You might want to add it to your brand voice." |

### Added 3 categories (existing telemetry, not in v1 spec)

| Slug | Severity | Trigger | Example user-facing copy |
|------|----------|---------|--------------------------|
| `memory.low_citation_waste` | warn | > 50% of injected memory entries scored < 0.3 in `memory_citation_scores` over 7 days | "Memory cleanup could speed things up" / "Most of the notes saved for your agents this week went unused. Cleaning them up could trim costs and speed up runs." |
| `agent.routing_uncertainty` | warn | Fast-path confidence < 0.5 on > 30% of decisions, OR `secondLookTriggered` rate > 30%, sustained 7 days | "Outreach Agent is hesitating a lot" / "It's second-guessing itself on about a third of decisions. Worth a quick look." |
| `llm.cache_poor_reuse` | info | `cacheCreationTokens` > sum of `cachedPromptTokens` over 7 days for any agent (cache costs more than it saves) | "Caching isn't paying off this week" / "Building the cache is costing more than it's saving on the Reporting Agent." |

### Per-category evaluator modules

Each category has a template module under `server/services/optimiser/recommendations/<category>.ts` exporting `evaluate(subaccountContext): Recommendation[]`. Pure functions; agent calls them sequentially via scan skills. The render step (raw evidence → operator copy) is a separate small LLM call cached by `dedupe_key`.

### Dedupe keys

| Category | Dedupe key |
|----------|------------|
| `agent.over_budget` | `<agent_id>` |
| `playbook.escalation_rate` | `<workflow_id>` |
| `skill.slow` | `<skill_slug>` |
| `inactive.workflow` | `<workflow_id>` |
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
| HITL escalations | `review_items` joined to `actions` | Yes | playbook.escalation_rate, escalation.repeat_phrase |
| Health snapshots | `client_pulse_health_snapshots` | Yes | context only, not direct trigger |
| Workflow last-run | `flow_runs` | Yes | inactive.workflow, playbook.escalation_rate |
| **LLM requests** | `llm_requests` (`cachedPromptTokens`, `cacheCreationTokens`, `prefixHash`) | Yes | **llm.cache_poor_reuse** (new) |
| **Memory citation scores** | `memory_citation_scores` (`finalScore` per injected entry per run) | Yes (via `agent_runs.subaccount_id`) | **memory.low_citation_waste** (new) |
| **Fast-path decisions** | `fast_path_decisions` (`decidedConfidence`, `secondLookTriggered`, `downstreamOutcome`) | Yes | **agent.routing_uncertainty** (new) |
| **Optimiser cross-tenant median** (peer baseline for `skill.slow`) | derived materialised view over `agent_runs` joined to `skill_instructions` | No (cross-tenant aggregate, sysadmin-bypassed RLS) | skill.slow |

### One spec correction from v1

The original §3 noted "review_items joined to tasks → skill_instructions" with a `reason` text field. The actual schema has `reviewPayloadJson` (JSONB), no explicit `reason` column. Phrase mining for `escalation.repeat_phrase` reads from `reviewPayloadJson` — no migration needed; phrase token extraction handles the JSONB shape.

### Cross-tenant median view

The peer-median view computes p50/p95/p99 per `skill_slug` across all sub-accounts and exposes only the aggregate. No per-tenant rows leak. Documented in `architecture.md` as a sysadmin-bypassed read.

**Minimum-tenant threshold:** the view returns no value for a `skill_slug` used by < 5 sub-accounts. Below threshold, `skill.slow` evaluator skips the recommendation entirely. Prevents single-tenant data leakage when a skill is used by 1-2 clients.

## §4 Agent definition

New agent definition file: `companies/automation-os/agents/subaccount-optimiser/AGENTS.md` + role definition + system prompt.

- **Role:** `subaccount-optimiser`
- **Scope:** `subaccount` (mirrors all 15+ business agents per migration 0106)
- **Schedule:** daily at sub-account local 06:00 (cron derived from sub-account's `timezone`); configurable
- **Default-on:** yes, with opt-out toggle on sub-account settings (`subaccount_settings.optimiser_enabled` boolean, default true)

System prompt (draft):
> "You watch the telemetry of agents operating in this sub-account. Each day, run your evaluation skills, dedupe against open recommendations, render any new findings as plain operator-friendly copy, and write them via the `output.recommend` skill. You do not execute work. You do not modify configuration. You do not surface internal category names in your output — operators read your titles and details, not your slugs. Use concrete numbers in human terms ('$73 against a $50 budget', not '47% over budget')."

---

## §5 Skills

8 scan skills (one per category) + 1 generic write skill (the primitive — see §6).

| Skill slug | Description | Side-effects | Returns |
|------------|-------------|--------------|---------|
| `optimiser.scan_agent_budget` | Per agent: current month + previous month cost vs budget. Flag > 1.3× for 2 months. | None | `Array<{agent_id, this_month, last_month, budget, top_cost_driver}>` |
| `optimiser.scan_workflow_escalations` | Per workflow: run + escalation counts over 14 days. Flag > 60% rate. | None | `Array<{workflow_id, run_count, escalation_count, common_step}>` |
| `optimiser.scan_skill_latency` | Per skill in last 7 days: p95 vs cross-tenant median. Flag > 4× ratio. | None | `Array<{skill_slug, latency_p95_ms, peer_p95_ms, ratio}>` |
| `optimiser.scan_inactive_workflows` | Scheduled workflows where `last_run_at + (cadence × 1.5) < now`. | None | `Array<{workflow_id, expected_cadence, last_run_at}>` |
| `optimiser.scan_escalation_phrases` | Tokenise `review_items.reviewPayloadJson` over 7 days, group, flag phrases ≥ 3 occurrences. | None | `Array<{phrase, count, sample_escalation_ids}>` |
| `optimiser.scan_memory_citation` | Per agent: % of injected `memory_citation_scores.finalScore < 0.3` over 7 days. Flag > 50%. | None | `Array<{agent_id, low_citation_pct, total_injected, projected_token_savings}>` |
| `optimiser.scan_routing_uncertainty` | Per agent: distribution of `fast_path_decisions.decidedConfidence` + `secondLookTriggered` rate over 7 days. | None | `Array<{agent_id, low_confidence_pct, second_look_pct}>` |
| `optimiser.scan_cache_efficiency` | Per agent: sum(`cacheCreationTokens`) vs sum(`cachedPromptTokens`) over 7 days from `llm_requests`. Flag where creation > reused. | None | `Array<{agent_id, creation_tokens, reused_tokens, dominant_skill}>` |
| `output.recommend` (generic — see §6) | Insert a row into `agent_recommendations` with stable `dedupe_key`. Used by the optimiser AND any future agent. | DB write | `{recommendation_id, was_new}` |

All scan skills are pure SQL with no LLM call. The render step (raw evidence → 2-3 sentence operator copy) is one LLM call per new recommendation, batched at the end of a run, cached by `dedupe_key`. Re-renders only when evidence shape changes.

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
  action_hint TEXT,
  dedupe_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  dismissed_reason TEXT
);

CREATE UNIQUE INDEX agent_recommendations_dedupe
  ON agent_recommendations(scope_type, scope_id, category, dedupe_key)
  WHERE dismissed_at IS NULL;

CREATE INDEX agent_recommendations_open_by_scope
  ON agent_recommendations(scope_type, scope_id, created_at DESC)
  WHERE dismissed_at IS NULL AND acknowledged_at IS NULL;

CREATE INDEX agent_recommendations_org
  ON agent_recommendations(organisation_id, created_at DESC);
```

Plus RLS policies (per `0245_all_tenant_tables_rls.sql` pattern), `rlsProtectedTables.ts` entry, `canonicalDictionary.ts` entry.

**Why generic, not `subaccount_recommendations`:** the table supports both `scope_type='org'` and `scope_type='subaccount'` from day one. Org-tier optimiser (deferred) would write `scope_type='org'` rows; today only sub-account rows exist. Schema cost is the same; future cost of retrofitting is high. Decision locked at design review.

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

**Output:** `{ recommendation_id: string, was_new: boolean }`. `was_new=false` means an open recommendation already exists for `(scope_type, scope_id, category, dedupe_key)` and no row was inserted.

**Permission:** any agent with `output.recommend` in its skill manifest can call it. The executor enforces that `scope_id` belongs to the agent's organisation.

**Category naming:** convention only, no schema validation. Convention is `<area>.<finding>` (e.g. `agent.over_budget`, `health.churn_risk_high`). The primitive doesn't enforce a registry — agents own their category namespaces. If two agents pick the same `(scope, category, dedupe_key)`, dedupe will treat them as the same finding; agents should namespace categories to avoid collisions in practice.

### §6.3 Generic component: `<AgentRecommendationsList>`

New React component at `client/src/components/recommendations/AgentRecommendationsList.tsx`.

**Props:**
```ts
{
  scope: { type: 'org', orgId: string } | { type: 'subaccount', subaccountId: string },
  limit?: number,            // default 3 — for top-N "see all" pattern
  emptyState?: 'hide' | 'show', // default 'hide' — section disappears when empty
  onDismiss?: (recId: string) => void,
}
```

Renders a vertical list of open recommendations for the given scope, sorted by severity (critical / warn / info) then by `created_at desc`. Each row: severity dot, plain-English title, one-sentence body, "Help me fix this →" link (deep-links to Configuration Assistant pre-loaded with the recommendation's `action_hint`), small × dismiss with reason input.

**No category labels in the UI.** No severity word labels. No timestamps on individual rows. Dot colour and ordering carry severity; the section header carries the timestamp ("Updated this morning").

### §6.4 What's NOT in the primitive (resist scope creep)

The primitive intentionally does not include:
- A widget registry, layout engine, or general "agent surface" framework. The original v1 design wanted a generalised Views framework; that was deliberately deferred (see `tasks/builds/home-dashboard-reactivity/spec.md` §2). This primitive is narrower — recommendations only.
- Generic dashboards, charts, KPI tiles, trend visualisations.
- Per-agent customisation of the renderer. All recommendations from all agents render the same way.
- Acknowledge / dismiss workflow customisation. The two actions are universal.
- Multi-step actions or threaded discussion. Single-action only.

Future spec can extend the primitive (e.g. add `acknowledge` semantics, add notification surfaces) but those are separate scopes.

---

## §7 Output surface

One new section on the existing Home dashboard at `/` (`client/src/pages/DashboardPage.tsx`). Position: between "Pending your approval" (line ~404) and "Your workspaces" (line ~424).

### Scope-aware rendering

The section reads the active sidebar context from `Layout.tsx` (`activeClientId` from `getActiveClientId()`):

- **Org context** (no sub-account selected) → `<AgentRecommendationsList scope={{ type: 'org', orgId: user.organisationId }} />` plus a virtual rollup that ALSO includes `scope_type='subaccount'` rows for every sub-account the user has access to. Effectively: cross-client view.
- **Sub-account context** (sub-account selected in sidebar) → `<AgentRecommendationsList scope={{ type: 'subaccount', subaccountId: activeClientId }} />`. Single-client view.

Both render the same component with the same layout. Only the data scope changes.

### Section content

Section header: **"A few things to look at"** (h2, matches the `text-[17px] font-bold text-slate-900 tracking-tight mb-3.5` style of sibling sections).

Sub-header line (12.5px, slate-500): "Updated this morning" + a sec-link "See all 12 →" on the right when there are more than 3 open recommendations.

Body: top 3 open recommendations rendered by `<AgentRecommendationsList limit={3}>`. Each row: severity dot, plain-English title (operator copy), one-sentence detail (operator copy with concrete numbers), "Help me fix this →" deep-link to Configuration Assistant.

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

8 categories × 1 daily run × pure SQL scans + 1 LLM render call per new recommendation × ~200 tokens (cached by `dedupe_key`).

| Scenario | Daily LLM cost per sub-account | Monthly cost |
|----------|---------------------------------|--------------|
| Steady state, 0-2 new recs/day | < $0.01 | < $0.30/sub-account/month |
| Initial onboarding burst (8 new recs day 1) | ~$0.04 one-off | — |
| 100 sub-accounts, steady | < $30/month total | well within margin |

Default-on. Opt-out toggle on sub-account settings (`subaccount_settings.optimiser_enabled`, default true). Hard cap of 10 open recommendations per `(scope, producing_agent_id)` pair at any time (per §13 risk mitigation). Per-pair so multiple agents can each contribute up to 10 without one agent saturating the surface.

---

## §9 Build chunks

Total ~28h. Phase 0 builds the reusable primitive; Phases 1-5 are the optimiser as the first consumer.

### Phase 0 — Generic agent-output primitive (~6h)

Builds reusable infrastructure that survives beyond the optimiser.

- [ ] Author migration `migrations/0267_agent_recommendations.sql` (+ `.down.sql`).
- [ ] Add table to `server/db/schema/agentRecommendations.ts`.
- [ ] Register in `rlsProtectedTables.ts` and `canonicalDictionary.ts`.
- [ ] RLS policies migration entry per `0245_all_tenant_tables_rls.sql` pattern (folded into 0267).
- [ ] Author skill `server/skills/output/recommend.md` + executor case in `server/services/skillExecutor.ts`.
- [ ] Author component `client/src/components/recommendations/AgentRecommendationsList.tsx`.
- [ ] Author hook `client/src/hooks/useAgentRecommendations.ts` (fetches by scope, subscribes to socket updates per home-dashboard-reactivity pattern).
- [ ] Acknowledge / dismiss endpoints: `POST /api/recommendations/:recId/acknowledge`, `POST /api/recommendations/:recId/dismiss` (body: `{reason}`). Routes in `server/routes/agentRecommendations.ts`.
- [ ] Pure unit tests: dedupe-key uniqueness, scope enforcement, severity enum, opening row only when no open match exists.

### Phase 1 — Telemetry rollup queries + cross-tenant median view (~8h)

- [ ] Author 8 query modules under `server/services/optimiser/queries/`:
  - `agentBudget.ts` (reads `cost_aggregates`)
  - `escalationRate.ts` (joins `flow_runs` + `review_items` + `actions`)
  - `skillLatency.ts` (per-sub-account p95 over 7 days from `agent_execution_events`)
  - `inactiveWorkflows.ts` (`flow_runs` last_at by `workflow_id`)
  - `escalationPhrases.ts` (tokenises `review_items.reviewPayloadJson`)
  - `memoryCitation.ts` (reads `memory_citation_scores`) — **NEW**
  - `routingUncertainty.ts` (reads `fast_path_decisions`) — **NEW**
  - `cacheEfficiency.ts` (reads `llm_requests` cache columns) — **NEW**
- [ ] Cross-tenant materialised view migration: `optimiser_skill_peer_medians` (folded into 0267 or 0267a). Refreshed nightly via pg-boss job. Minimum-tenant threshold of 5 enforced in view definition.
- [ ] pg-boss job `refresh_optimiser_peer_medians` registered + nightly schedule.
- [ ] Each query has its own pure unit test against fixture data (8 test files).

### Phase 2 — Optimiser agent definition + scan skills (~6h)

- [ ] Author `companies/automation-os/agents/subaccount-optimiser/AGENTS.md` with role, system prompt, skill manifest (8 scan skills + `output.recommend`).
- [ ] Author 8 scan skill markdown specs in `server/skills/optimiser/`. Each maps to a query module from Phase 1.
- [ ] Author 8 evaluator modules under `server/services/optimiser/recommendations/` — pure functions taking query output and emitting `Recommendation[]` shapes ready for `output.recommend`.
- [ ] LLM-render step in agent runtime: small prompt that takes raw evidence + category → 2-3 sentence operator-facing copy. Cached by `dedupe_key`. Uses Sonnet (cheap, no need for Opus).
- [ ] Schedule registration: extend `agentScheduleService.registerSubaccountSchedule` invocation point; daily cron at sub-account local 06:00.
- [ ] Backfill: on first deploy, register schedules for all existing sub-accounts where `optimiser_enabled=true` (one-shot script). Stagger by `created_at` hash across 6-hour window to avoid pg-boss storm.
- [ ] Integration test: full run end-to-end against test sub-account with seeded telemetry, assert recommendation rows appear with expected dedupe_keys.

### Phase 3 — Home dashboard wiring (~3h)

- [ ] Add new section to `client/src/pages/DashboardPage.tsx` between "Pending your approval" and "Your workspaces". Section header: "A few things to look at".
- [ ] Wire `<AgentRecommendationsList>` with scope derived from `Layout.tsx` `activeClientId`:
  - `activeClientId === null` → `scope={ type: 'org', orgId: user.organisationId }`
  - `activeClientId !== null` → `scope={ type: 'subaccount', subaccountId: activeClientId }`
- [ ] Org-scope rollup: list expansion query that includes `scope_type='subaccount'` rows for sub-accounts the user can read (RLS-gated; no application-layer permission filtering needed). Operator sees per-client items rolled up.
- [ ] Hide section entirely when zero open recs for current scope.
- [ ] "See all N →" link expands inline (no navigation in v1).
- [ ] Socket subscription: emit `dashboard.recommendations.changed` from `output.recommend` insert + acknowledge/dismiss endpoints; client refetches on event per the existing reactivity pattern.

### Phase 4 — Brand-voice / phrase classifier (~3h)

- [ ] Tokeniser: simple regex/normalisation, no ML. Strips stopwords, lowercases, splits on punctuation.
- [ ] Phrase grouping: count occurrences per token / bigram / trigram in `review_items.reviewPayloadJson` over 7 days.
- [ ] Threshold: ≥ 3 occurrences within 7 days triggers `escalation.repeat_phrase` recommendation.
- [ ] Suggested-action text in `action_hint`: deep-link to Configuration Assistant pre-loaded with brand-voice context.
- [ ] Pure tests with fixture escalation reason text (~10 cases).

### Phase 5 — Verification (~2h)

- [ ] `npm run lint`, `npm run typecheck` clean.
- [ ] All unit + integration tests pass locally.
- [ ] Manual: enable optimiser on test sub-account with seeded telemetry, trigger run, verify recommendations appear in Home dashboard section in BOTH org and sub-account context, acknowledge/dismiss round-trip.
- [ ] Cost-model sanity: run optimiser for 5 sub-accounts × 7 days, confirm < $0.10 LLM spend.
- [ ] Update `docs/capabilities.md` § Sub-account observability — describe the optimiser AND the new generic primitive.
- [ ] Update `architecture.md` — document the cross-tenant median view as a sysadmin-bypassed read; document `agent_recommendations` as reusable primitive any agent can write to.
- [ ] Update `tasks/builds/subaccount-optimiser/progress.md` with closeout.

---

## §10 Files touched

### Phase 0 — primitive (reusable)

**Server:**
- `migrations/0267_agent_recommendations.sql` (+ `.down.sql`) — table + RLS policies
- `server/db/schema/agentRecommendations.ts` (new)
- `server/db/rlsProtectedTables.ts` (entry)
- `server/db/canonicalDictionary.ts` (entry)
- `server/skills/output/recommend.md` (new generic skill spec)
- `server/services/skillExecutor.ts` (new case for `output.recommend`)
- `server/routes/agentRecommendations.ts` (new — acknowledge / dismiss endpoints)

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
- `server/jobs/refreshOptimiserPeerMedians.ts` (new)
- `migrations/0267_agent_recommendations.sql` extended OR `0267a_optimiser_peer_medians.sql` — cross-tenant materialised view

**Skills + agent:**
- `companies/automation-os/agents/subaccount-optimiser/AGENTS.md` (new)
- `server/skills/optimiser/*.md` (8 scan skill specs)

### Phase 3 — Home dashboard wiring

**Client:**
- `client/src/pages/DashboardPage.tsx` (new section between "Pending your approval" and "Your workspaces")
- `client/src/components/Layout.tsx` (no change to nav; existing `activeClientId` consumed by the new section)

### Tests

- Per-query unit tests (8 files)
- Per-evaluator unit tests (8 files)
- Phrase-tokeniser tests (~10 cases)
- Integration test for full optimiser run

### Docs (Phase 5 closeout)

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
- **Cost overrun on LLM render.** If render copy is regenerated too often. Mitigation: cache by `dedupe_key`, regenerate only when evidence shape changes.
- **Schedule storm.** Registering 100+ daily crons at boot may overwhelm pg-boss. Mitigation: stagger by sub-account `created_at` hash → distribute across 6-hour window.
- **Primitive over-extension.** The new `agent_recommendations` table + `output.recommend` skill + `<AgentRecommendationsList>` component are tempting to extend with widget registries, layout engines, custom renderers per agent. **Resist.** §6.4 lists what's explicitly out of scope. Future spec extends; this spec does not.
- **Pre-existing Home dashboard scope tension.** The new section is context-aware; sibling widgets ("Clients Needing Attention", "Active Agents") are not. Operators in sub-account context see a dashboard that's partially scoped and partially not. This is a pre-existing problem that becomes visible because we're adding the first context-aware element. Documented as out-of-scope; flag for follow-up spec.
- **Slug leakage to UI.** A bug or copy mistake could surface a category slug to operators. Mitigation: render layer enforces operator-facing strings only; integration test asserts no slug appears in rendered title/body.

## §14 Concurrent-build hygiene

- Migration `0267` reserved here. Do not use elsewhere. Cross-tenant median view uses `0267` (folded into the same migration) or `0267a` if separated.
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

These are NOT in v1 scope. **Verified 2026-05-02 against `server/services/agentExecutionService.ts` — no `context.assembly.complete` emit exists today.** When Riley W3 ships, add these as a Phase 6 follow-up to this build (or as v1.1).
