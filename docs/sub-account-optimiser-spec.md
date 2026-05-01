# Sub-Account Optimiser Meta-Agent — Dev Spec

**Status:** DRAFT
**Build slug:** `subaccount-optimiser`
**Branch:** `claude/subaccount-optimiser`
**Migrations claimed:** `0267`
**Concurrent peers:** F1 `subaccount-artefacts` (0266), F3 `baseline-capture` (0268-0270)
**Related code:** `companies/automation-os/agents/portfolio-health-agent/`, `server/services/agentScheduleService.ts`, `server/services/agentExecutionService.ts`, `server/services/canonicalDataService.ts`, `server/services/costAggregateService.ts`, `server/db/schema/agentRuns.ts`, `server/db/schema/agentExecutionEvents.ts`, `server/db/schema/reviewItems.ts`, `client/src/pages/ClientPulseDashboardPage.tsx`
**Related specs:** `docs/automation-os-system-agents-master-brief-v7.1.md`, `docs/riley-observations-dev-spec.md` (W3 telemetry would enrich this; not blocking)

---

## Goal

A passive-observation agent that runs at the sub-account level, watches telemetry of all other agents in that sub-account, and surfaces optimisation recommendations to the agency operator. It does NOT execute work — only recommends.

## Distinction from existing system agents

| Agent | Scope | Audience | Output |
|-------|-------|----------|--------|
| Portfolio Health Agent (`companies/automation-os/agents/portfolio-health-agent/`) | Org / platform | Synthetos platform team + agency operators reading org-level insights | Org-level insights (`org_memories`) |
| Sub-account optimiser (this spec) | Single sub-account | Agency operator + sub-account primary user | Recommendations attached to the sub-account |

The two share telemetry sources but serve different consumers. Do not merge.

## Sections

- §1 Scope
- §2 Recommendation taxonomy
- §3 Telemetry sources (already shipped)
- §4 Agent definition
- §5 Skills (4 telemetry-query skills + 1 recommendation-write skill)
- §6 Storage model
- §7 Output surface
- §8 Cost model
- §9 Build chunks
  - Phase 1 — Schema + recommendation taxonomy
  - Phase 2 — Telemetry rollup queries
  - Phase 3 — Optimiser agent definition + skills
  - Phase 4 — Recommendations digest UI
  - Phase 5 — Brand-voice / phrase classifier
  - Phase 6 — Verification
- §10 Files touched
- §11 Done definition
- §12 Dependencies
- §13 Risks
- §14 Concurrent-build hygiene
- §15 What Riley W3 would unlock (when it ships)

---

## §1 Scope

In:
- Single sub-account observability — read its own agent runs, costs, escalations, skills, memory
- Recommendation generation — text recommendations attached to the sub-account
- Scheduled execution — daily by default, configurable per sub-account
- Opt-in / opt-out toggle at sub-account level

Out:
- Cross-sub-account comparison (that's the Portfolio Health Agent's job)
- Auto-execution of recommendations (this is observation only)
- Notifications outside the dashboard (in-app surface only for v1; email/Slack deferred)
- Brand voice ML classification beyond a keyword/phrase match (deferred until volume justifies)

## §2 Recommendation taxonomy

Each recommendation has: `category`, `severity` (info / warn / critical), `title`, `body`, `evidence` (jsonb with metric values), `action_hint` (suggested next step), `dismissed_at`, `acknowledged_at`.

Categories for v1:

| Category | Trigger | Example |
|----------|---------|---------|
| `skill.slow` | Skill p95 latency > 4× cross-sub-account median for that skill, sustained 7 days | "`ghl.fetch_contacts` is taking 12s vs. 3s average. Possible filter inefficiency." |
| `playbook.escalation_rate` | Workflow run escalates to HITL > 60% over 14 days | "`outreach-followup` workflow escalated 8/12 times this fortnight. Step 3 (email send) is the most common cause." |
| `agent.over_budget` | Agent's monthly cost > 1.3× its budget for 2 consecutive months | "`reporting-agent` is 47% over its $50/mo budget for the second month. Top driver: 38% of cost on `compute_health_score` runs." |
| `inactive.workflow` | Workflow flagged `autoStartOnSchedule: true` hasn't run in N days (N = workflow's expected cadence × 1.5) | "Portfolio Health check hasn't run in 14 days for this client." |
| `escalation.repeat_phrase` | Same prohibited phrase / brand-voice violation triggers ≥3 HITL escalations in 7 days | "Three of four `email-outreach` escalations cited 'guarantee' in the draft — consider updating brand voice profile." |

Each category has a template module under `server/services/optimiser/recommendations/<category>.ts` exporting `evaluate(subaccountContext): Recommendation[]`. Pure functions; agent calls them sequentially via skills.

## §3 Telemetry sources (already shipped)

| Source | Table | Per-sub-account? | Notes |
|--------|-------|------------------|-------|
| Agent runs | `agent_runs` | Yes | duration, cost, status, run_source |
| Step events | `agent_execution_events` | Yes | step-level events; can derive skill timing |
| Cost aggregates | `cost_aggregates` | Yes | pre-rolled per agent / task_type |
| HITL escalations | `review_items` joined to `tasks` → `skill_instructions` | Yes | escalation reason text field |
| Health snapshots | `client_pulse_health_snapshots` | Yes | for context, not direct trigger |
| Workflow last-run | `flow_runs` (Riley W1 rename of `workflow_runs`) | Yes | last `created_at` per workflow_id |
| Optimiser-cross-tenant median (peer comparison for `skill.slow`) | derived view over `agent_runs` joined to `skill_instructions` | No (cross-tenant query, sysadmin-bypassed RLS) | new materialised view, refreshed nightly |

The "peer median" view is the only new query that crosses tenant boundaries. It computes p50/p95/p99 per `skill_slug` across all sub-accounts and exposes only the aggregate. Reasoning: a single sub-account can't tell whether its own latency is "slow" without a peer baseline. The view returns no per-tenant rows — only aggregates — so RLS is not violated semantically; documented in `architecture.md`.

## §4 Agent definition

New agent definition file: `companies/automation-os/agents/subaccount-optimiser/AGENTS.md` + role definition + system prompt.

- **Role:** `subaccount-optimiser`
- **Scope:** `subaccount` (mirrors all 15+ business agents per migration 0106)
- **Schedule:** daily at sub-account local 06:00 (cron derived from sub-account's `timezone`); configurable
- **Default-on:** yes, but opt-out toggle on sub-account settings

System prompt: "You watch the telemetry of agents operating in this sub-account. Each day, run your evaluation skills, dedupe against open recommendations, and write any new recommendations. You do not execute work. You do not modify configuration. Your output is a list of recommendations the operator will read or dismiss."

## §5 Skills

| Skill slug | Description | Side-effects | Returns |
|------------|-------------|--------------|---------|
| `optimiser.scan_skill_latency` | For each skill used in the last 7 days, compare p95 to cross-tenant median. | None | `Array<{skill_slug, latency_p95_ms, peer_p95_ms, ratio}>` |
| `optimiser.scan_workflow_escalations` | For each workflow run in the last 14 days, compute escalation rate. Flag > 60%. | None | `Array<{workflow_id, run_count, escalation_count, common_step}>` |
| `optimiser.scan_agent_budget` | For each agent, compute current month + previous month cost vs budget. Flag agents > 1.3× for 2 months. | None | `Array<{agent_id, this_month, last_month, budget, top_cost_driver}>` |
| `optimiser.scan_inactive_workflows` | List scheduled workflows that haven't run in (cadence × 1.5). | None | `Array<{workflow_id, expected_cadence, last_run_at}>` |
| `optimiser.scan_escalation_phrases` | For HITL escalations in the last 7 days where reason text is present, group by tokenised phrase. Flag any phrase with ≥3 occurrences. | None | `Array<{phrase, count, sample_escalation_ids}>` |
| `optimiser.write_recommendation` | Insert a row into `subaccount_recommendations` with a stable `dedupe_key` so same finding doesn't recreate. | DB write | `{recommendation_id, was_new}` |

All scan skills are pure SQL with no LLM call. Only the recommendation phrasing is LLM-rendered (small prompt: takes raw evidence → 2-3 sentence operator-facing copy). One LLM call per recommendation, batched.

## §6 Storage model

New table: `subaccount_recommendations` (migration 0267).

```sql
CREATE TABLE subaccount_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL,
  subaccount_id UUID NOT NULL,
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

CREATE UNIQUE INDEX subaccount_recommendations_dedupe
  ON subaccount_recommendations(subaccount_id, category, dedupe_key)
  WHERE dismissed_at IS NULL;

CREATE INDEX subaccount_recommendations_open
  ON subaccount_recommendations(subaccount_id, created_at DESC)
  WHERE dismissed_at IS NULL AND acknowledged_at IS NULL;
```

Plus RLS policies (per `0245_all_tenant_tables_rls.sql` pattern), `rlsProtectedTables.ts` entry, `canonicalDictionary.ts` entry.

`dedupe_key` example: for `skill.slow` it's `<skill_slug>`; for `playbook.escalation_rate` it's `<workflow_id>`; for `escalation.repeat_phrase` it's `<phrase_token>`. Open recommendation in same dedupe key → skill returns `was_new=false`, no insert.

## §7 Output surface

- New `<RecommendationsCard>` component on `/subaccounts/:id` overview page (top of right column).
- Lists open recommendations, severity-coloured, with Acknowledge / Dismiss / "Open in Configuration Assistant" actions.
- Dismiss requires a one-line reason; both actions write back to the row.
- Badge on sidebar nav showing open-recommendation count for currently-selected sub-account.
- Agency-operator view (cross-sub-account roll-up): `/recommendations` route — filterable by severity / category / sub-account.

No email. No Slack. In-app only for v1.

## §8 Cost model

- ~5 sub-accounts × 1 daily run × 5 scan skills × ~0 LLM tokens (pure SQL) + ~1 LLM call per new recommendation × ~200 tokens.
- Estimated per-sub-account daily cost: < $0.02.
- For 100 sub-accounts: ~$60/month. Well within margin.
- Default-on. Opt-out toggle on sub-account settings (`subaccount_settings.optimiser_enabled` boolean, default true).

---

## §9 Build chunks

### Phase 1 — Schema + recommendation taxonomy (~4h)

- [ ] Author migration `migrations/0267_subaccount_recommendations.sql` (+ `.down.sql`).
- [ ] Add table to `server/db/schema/subaccountRecommendations.ts`.
- [ ] Register in `rlsProtectedTables.ts` and `canonicalDictionary.ts` per existing conventions.
- [ ] Add RLS policies migration entry per `0245_all_tenant_tables_rls.sql` pattern (or fold into 0267).
- [ ] Add `optimiser_enabled` flag to `subaccount_settings` (or equivalent settings JSONB key).
- [ ] Pure validator unit tests for taxonomy keys, severity enum, dedupe-key generation per category (1 file, ~12 cases).

### Phase 2 — Telemetry rollup queries + cross-tenant median view (~6h)

- [ ] Author module `server/services/optimiser/queries/skillLatency.ts` — pure SQL builder + executor for per-sub-account p95 latency over last 7 days, joined to `agent_execution_events`.
- [ ] Author cross-tenant materialised view migration (folded into 0267 or separate 0267a) — `optimiser_skill_peer_medians`, refreshed via pg-boss nightly job.
- [ ] Author `server/services/optimiser/queries/escalationRate.ts` — joins `flow_runs` to `review_items` to `tasks` to `skill_instructions`.
- [ ] Author `server/services/optimiser/queries/agentBudget.ts` — reads `cost_aggregates` for current + previous month per agent, joins `subaccount_agents.budget_cents` (or org budget if not set).
- [ ] Author `server/services/optimiser/queries/inactiveWorkflows.ts` — `flow_runs` last_at per `workflow_id` filtered by `autoStartOnSchedule=true`.
- [ ] Author `server/services/optimiser/queries/escalationPhrases.ts` — tokenises `review_items.reason` over last 7 days, groups, returns ≥3-occurrence phrases.
- [ ] Each query has its own pure unit test against fixture data.
- [ ] pg-boss job `refresh_optimiser_peer_medians` registered + nightly schedule.

### Phase 3 — Optimiser agent definition + skills (~5h)

- [ ] Author `companies/automation-os/agents/subaccount-optimiser/AGENTS.md`.
- [ ] Define role + system prompt + skill manifest.
- [ ] Author 5 scan skills + 1 write skill in `server/skills/optimiser/`. Each scan skill is markdown spec + executor function in `server/services/skillExecutor.ts` switch.
- [ ] LLM-render step: small prompt that takes raw evidence → 2-3 sentence operator-facing copy. Caches by `dedupe_key` (recommendation copy is regenerated only when evidence shape changes).
- [ ] Schedule registration: extend `agentScheduleService.registerSubaccountSchedule` invocation point, or add boot-time hook that registers a daily cron for any sub-account with `optimiser_enabled=true`.
- [ ] Backfill: on first deploy, register schedules for all existing sub-accounts (one-shot script).
- [ ] Integration test: full run end-to-end against test sub-account with seeded telemetry, assert recommendation row appears.

### Phase 4 — Recommendations digest UI (~4h)

- [ ] `<RecommendationsCard>` component on `/subaccounts/:id` overview. List open recs, severity colour, action buttons.
- [ ] Sidebar badge with open-rec count for currently-selected sub-account.
- [ ] Acknowledge / dismiss endpoints: `POST /api/subaccounts/:id/recommendations/:recId/acknowledge`, `POST /api/subaccounts/:id/recommendations/:recId/dismiss` (body: `{reason}`).
- [ ] Agency-operator cross-sub-account view: `/recommendations` route. Filter by severity, category, sub-account.
- [ ] "Open in Configuration Assistant" action wires to existing `ConfigAssistantPopup` deep-link, pre-loaded with recommendation context.

### Phase 5 — Brand-voice / phrase classifier (~3h)

- [ ] Tokeniser: simple regex/normalisation, no ML. Strips stopwords, lowercases, splits on punctuation.
- [ ] Phrase grouping: count occurrences per token / bigram / trigram.
- [ ] Threshold: ≥3 occurrences within 7 days triggers `escalation.repeat_phrase` recommendation.
- [ ] Suggested-action text: "Consider updating the brand voice profile to flag this phrase. Open Configuration Assistant → Voice / Tone."
- [ ] Pure tests with fixture escalation reason text (~10 cases).

### Phase 6 — Verification (~2h)

- [ ] `npm run lint`, `npm run typecheck` clean.
- [ ] All unit tests pass.
- [ ] Manual: enable optimiser on test sub-account with seeded telemetry, trigger run, verify recommendations appear in UI, acknowledge/dismiss round-trip.
- [ ] Cost-model sanity: run optimiser for 5 sub-accounts × 7 days, confirm < $0.10 LLM spend.
- [ ] Update `docs/capabilities.md` § Sub-account observability — describe optimiser.
- [ ] Update `architecture.md` — document the cross-tenant median view as a sysadmin-bypassed read.
- [ ] Update `tasks/builds/subaccount-optimiser/progress.md` with closeout.

---

## §10 Files touched

### Server
- `server/db/schema/subaccountRecommendations.ts` (new)
- `server/db/rlsProtectedTables.ts` (entry)
- `server/db/canonicalDictionary.ts` (entry)
- `server/services/optimiser/queries/{skillLatency,escalationRate,agentBudget,inactiveWorkflows,escalationPhrases}.ts` (5 new files)
- `server/services/optimiser/recommendations/{skillSlow,playbookEscalation,agentBudget,inactiveWorkflow,repeatPhrase}.ts` (5 new files — pure evaluators)
- `server/services/optimiser/recommendationWriter.ts` (insert + dedupe)
- `server/services/skillExecutor.ts` (switch cases for 6 new skills)
- `server/services/agentScheduleService.ts` (register optimiser schedule for sub-accounts)
- `server/routes/subaccountRecommendations.ts` (acknowledge / dismiss endpoints, ~80 LOC)
- `server/jobs/refreshOptimiserPeerMedians.ts` (new)

### Skills + agent
- `companies/automation-os/agents/subaccount-optimiser/AGENTS.md` (new)
- `server/skills/optimiser/*.md` (6 markdown skill specs)

### Client
- `client/src/components/optimiser/RecommendationsCard.tsx` (new)
- `client/src/pages/RecommendationsPage.tsx` (new agency cross-sub view)
- `client/src/components/Sidebar.tsx` (badge wiring)
- `client/src/pages/SubaccountOverviewPage.tsx` (card wiring)

### Tests
- One test file per query module
- One test file per recommendation evaluator
- Integration test for full optimiser run

### Docs (Phase 6 closeout)
- `docs/capabilities.md`, `architecture.md`

## §11 Done definition

- Optimiser agent runs daily for every active sub-account with `optimiser_enabled=true`.
- Each scan skill produces deterministic output against fixture telemetry.
- Recommendations dedupe correctly — same finding doesn't recreate a row.
- Acknowledge / dismiss round-trips via UI.
- Cost stays under $0.02 per sub-account per day in measured production runs.
- Sidebar badge accurately reflects open-rec count.

## §12 Dependencies

- F1 (subaccount-artefacts) — not strictly required, but the `escalation.repeat_phrase` category becomes much more useful when the brand-voice profile (F1 tier-1 artefact) is captured. Without F1, the action hint "update brand voice profile" points at nothing. Recommend F1 lands first; F2 can build in parallel and gracefully degrade the action hint.
- GHL OAuth (Module C) — not required. Optimiser reads internal telemetry, not GHL data.
- Riley W3 telemetry — not required. See §15 for what it would unlock.

## §13 Risks

- **Recommendation noise** — too many low-value recommendations train operators to ignore the surface. Mitigate: severity tuning, dedupe, configurable thresholds per sub-account, hard caps (max 10 open recs at any time per sub-account).
- **Cross-tenant median view leakage** — the view exposes aggregate p50/p95/p99 per skill across all tenants. If a single skill is used by only 1-2 tenants, "peer median" reveals their data. Mitigate: minimum 5-tenant threshold per skill before peer comparison fires; below threshold, skip the recommendation entirely.
- **Cost overrun** — if LLM-rendered recommendation copy is regenerated too often. Mitigate: cache by `dedupe_key`, regenerate only when evidence shape changes.
- **Schedule storm** — registering 100+ daily crons at boot may overwhelm pg-boss. Mitigate: stagger by sub-account creation hash → distribute across 6-hour window.

## §14 Concurrent-build hygiene

- Migration `0267` reserved here. Do not use elsewhere.
- Branch `claude/subaccount-optimiser`. Worktree at `../automation-v1.subaccount-optimiser`.
- Progress lives in `tasks/builds/subaccount-optimiser/progress.md`.
- Touches `server/services/skillExecutor.ts` switch — F1 and F3 don't touch this; safe.
- Touches `server/services/agentScheduleService.ts` — neither F1 nor F3 touches; safe.
- Fully independent of F1 and F3. Can land any time.

## §15 What Riley W3 would unlock (when it ships)

W3 (`context.assembly.complete` event in `agentExecutionService.ts`) would emit per-run gap flags: `briefing_missing`, `beliefs_missing`, `memory_missing`, `integration_status`, `pressure`. With that event in place, two new optimiser categories become trivial:

| Category (Riley W3-dependent) | Trigger |
|-------------------------------|---------|
| `context.gap.persistent` | Same gap flag fires > 50% of runs over 7 days for an agent |
| `context.token_pressure` | `pressure='high'` fires consistently — recommend extracting workspace memory entries to reference docs |

These are NOT in v1 scope. When Riley W3 ships, add them as Phase 7 of this build (or as a v1.1 follow-up). Doc this dependency in the optimiser AGENTS.md.
