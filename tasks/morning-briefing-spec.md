# Morning Briefing — Development Spec

**Date:** 2026-04-05
**Classification:** Standard (3-4 files, clear approach, uses existing patterns)

---

## Executive Summary

The Morning Briefing is a **read-only daily evaluation cycle** where an org-level orchestrator agent wakes up each morning, assesses the state of all client workspaces, and delivers a summary email to agency stakeholders.

**What it does:** Every morning at a configured time, an AI agent reviews portfolio health, flags anomalies, identifies priority actions, and emails a digest — "here's how your clients are doing, here's what needs attention."

**What it doesn't do:** No autonomous actions. No task creation. No outbound client communication. Pure observation and reporting. This is the "Observer" tier of proactive autonomy — the safest possible starting point.

**Why it matters:**
- **Testing signal** — if the briefing produces garbage, our agents aren't ready for autonomy. If it's accurate and useful, we've validated the evaluation pipeline.
- **Sellable feature** — agencies can immediately offer clients "your AI team sends a daily status report."
- **Foundation** — the evaluation cycle (gather signals → analyse → report) is the same architecture needed for Advisor/Operator/Autonomous modes later. We build the read path now; write paths come after testing.

**What already exists vs what we build:**

| Component | Status | Notes |
|-----------|--------|-------|
| Org-level agent execution | Built | `executionScope: 'org'` fully implemented |
| Cross-subaccount data skills | Built | `query_subaccount_cohort`, `compute_health_score`, `detect_anomaly`, `read_org_insights`, `generate_portfolio_report` all exist |
| Email sending skill | Built | `send_email` exists, routes through HITL review queue |
| Org memory (read/write) | Built | `orgMemories` + `orgMemoryEntries` with semantic search |
| Cron-based scheduling | Built | `agentScheduleService` handles org-level cron via pg-boss |
| Org agent config | Built | `orgAgentConfigs` table with schedule fields |
| **System agent definition** | **Needs creation** | New system agent with briefing masterPrompt |
| **Briefing skill** | **Needs creation** | New skill to structure and store the briefing output |
| **Briefing storage table** | **Needs creation** | Schema for audit trail and historical access |
| **Email auto-send policy** | **Decision needed** | Whether briefing emails skip HITL or go through review |

**Estimated effort:** 3-5 days for core implementation. No new architectural patterns required.

---

## Architecture

### How it works (end-to-end flow)

```
1. pg-boss fires cron job (e.g. "0 8 * * *" = 8 AM UTC)
       ↓
2. agentScheduleService picks up job, calls agentExecutionService.executeRun()
   with executionScope: 'org', runType: 'scheduled'
       ↓
3. Agent executes with masterPrompt that instructs it to:
   a. Call query_subaccount_cohort → get portfolio snapshot
   b. Call compute_health_score for flagged accounts
   c. Call detect_anomaly for each account
   d. Call read_org_insights for cross-portfolio patterns
   e. Call generate_portfolio_report to synthesise
   f. Call store_briefing (new skill) to persist the report
   g. Call send_email to deliver the digest
       ↓
4. Email either auto-sends (policy rule) or queues for admin approval
       ↓
5. Agent writes key findings to org memory via write_org_insight
```

### Why org-level, not subaccount-level

The briefing needs cross-client visibility. Org-level execution:
- Can query across all subaccounts via `query_subaccount_cohort`
- Writes to org memory (cross-subaccount patterns)
- Sends one email per day covering the whole portfolio
- Respects `allowedSubaccountIds` in org agent config for scoping

Subaccount-level runs only see their own workspace — wrong abstraction for a portfolio briefing.

---

## Implementation Plan

### Step 1: Schema — `morning_briefings` table

New Drizzle schema file: `server/db/schema/morningBriefings.ts`

```typescript
export const morningBriefings = pgTable('morning_briefings', {
  id: uuid('id').defaultRandom().primaryKey(),
  organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
  agentRunId: uuid('agent_run_id').references(() => agentRuns.id),
  briefingDate: date('briefing_date').notNull(),
  reportHtml: text('report_html'),           // formatted briefing content
  reportStructured: jsonb('report_structured'), // machine-readable summary
  accountsReviewed: integer('accounts_reviewed'),
  anomaliesDetected: integer('anomalies_detected'),
  priorityActions: jsonb('priority_actions'),  // [{accountName, action, urgency}]
  sentAt: timestamp('sent_at', { withTimezone: true }),
  sentTo: jsonb('sent_to').$type<string[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  orgDateIdx: index('morning_briefings_org_date_idx').on(table.organisationId, table.briefingDate),
  orgCreatedIdx: index('morning_briefings_org_created_idx').on(table.organisationId, table.createdAt),
}));
```

Migration file via `npm run db:generate`.

### Step 2: Skill — `store_briefing`

New skill definition: `server/skills/store_briefing.md`

Purpose: Persists the generated briefing to the `morning_briefings` table. Allows the agent to structure its output in a storable format.

```json
{
  "name": "store_briefing",
  "description": "Store a morning briefing report for the organisation. Call this after generating the portfolio analysis.",
  "input_schema": {
    "type": "object",
    "properties": {
      "report_html": { "type": "string", "description": "HTML-formatted briefing content" },
      "report_structured": {
        "type": "object",
        "description": "Machine-readable summary with keys: portfolio_overview, accounts_requiring_attention, positive_signals, cross_portfolio_patterns, recommended_actions"
      },
      "accounts_reviewed": { "type": "number" },
      "anomalies_detected": { "type": "number" },
      "priority_actions": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "account_name": { "type": "string" },
            "action": { "type": "string" },
            "urgency": { "type": "string", "enum": ["low", "medium", "high", "critical"] }
          }
        }
      }
    },
    "required": ["report_html", "report_structured"]
  }
}
```

Processor in `skillExecutor.ts`: Insert into `morning_briefings` table with `organisationId` from context and `briefingDate` as today. No approval gate needed — it's internal storage only.

### Step 3: System Agent — `morning_briefing`

Seed via system agent creation (admin API or migration seed script).

Key fields:
```
slug: 'morning_briefing'
name: 'Morning Briefing'
description: 'Daily portfolio health digest for agency stakeholders'
executionScope: 'org'
heartbeatEnabled: true
heartbeatIntervalHours: 24
defaultSystemSkillSlugs: [
  'query_subaccount_cohort',
  'compute_health_score',
  'detect_anomaly',
  'read_org_insights',
  'generate_portfolio_report',
  'write_org_insight',
  'store_briefing',
  'send_email'
]
```

**masterPrompt** (core logic — this is the "brain" of the briefing):

```markdown
You are the Morning Briefing agent. Your job is to evaluate the state of
all client accounts in this agency's portfolio and produce a clear,
actionable daily digest.

## Your Process

1. **Gather portfolio data**
   Call `query_subaccount_cohort` with `metric_focus: "all"` to get a
   snapshot of all active client accounts.

2. **Identify concerns**
   For any account showing declining metrics or low activity, call
   `compute_health_score` to get a detailed breakdown. Call
   `detect_anomaly` for accounts with health scores below 60 or
   significant metric changes.

3. **Check for patterns**
   Call `read_org_insights` to see if current findings match or
   contradict existing cross-portfolio patterns.

4. **Generate the briefing**
   Call `generate_portfolio_report` with format "email" and verbosity
   "standard" for the 7-day reporting period.

5. **Store the briefing**
   Call `store_briefing` with both HTML and structured versions of
   the report.

6. **Record learnings**
   If you identify a new cross-portfolio pattern or insight, call
   `write_org_insight` to persist it for future reference.

7. **Send the digest**
   Call `send_email` with the briefing content to the configured
   recipients. Use a clear subject line:
   "Morning Briefing — [date] — [N] accounts reviewed, [N] need attention"

## Output Guidelines

- Lead with what needs attention. Don't bury problems in positive news.
- For each flagged account: state the issue, the evidence, and a
  suggested next step.
- Include a "no action needed" section for accounts doing well — agency
  teams want confirmation that things are fine, not just silence.
- Keep it scannable. Use headers, bullet points, and bold for key numbers.
- End with 1-3 recommended priority actions for today.

## Constraints

- You are read-only. Do NOT create tasks, move tasks, reassign agents,
  or trigger processes. Your job is to observe and report.
- Do NOT contact clients. The email goes to internal agency stakeholders only.
- If you have insufficient data for an account (new account, no recent
  activity), say so rather than speculating.
```

### Step 4: Schedule Wiring

The scheduler already supports org-level cron. When an org installs the morning briefing agent:

1. Create `orgAgentConfigs` row with:
   - `scheduleCron: '0 8 * * *'` (or user-configured time)
   - `scheduleEnabled: true`
   - `scheduleTimezone: 'America/New_York'` (or user's timezone)
   - `tokenBudgetPerRun: 50000` (briefings need more tokens than typical runs)
   - `maxToolCallsPerRun: 30` (multiple skill calls across accounts)

2. `agentScheduleService.registerAllActiveSchedules()` picks it up on next cycle (or call `registerOrgSchedule()` directly).

No changes needed to the scheduler itself — this uses existing infrastructure.

### Step 5: Email Delivery Decision

**Option A: HITL approval (recommended for v1)**
- `send_email` goes through normal review queue
- Agency admin sees the briefing in their review queue, approves, email sends
- Pro: Zero risk of bad emails. Admin reviews the briefing quality daily during early usage.
- Con: Briefing doesn't arrive until someone approves it.

**Option B: Auto-approve via policy rule**
- Add a policy rule: `{ agentSlug: 'morning_briefing', skillSlug: 'send_email', gateLevel: 'auto' }`
- Pro: Truly automated — arrives at 8 AM without intervention.
- Con: If the briefing hallucinates, it sends garbage to stakeholders.

**Recommendation:** Start with Option A. After 2 weeks of reliable briefings, add the policy rule for auto-approve. This matches the "progressive trust calibration" pattern from the research.

---

## What We're NOT Building

- No new UI pages (briefings are email-delivered; historical access via existing org memory)
- No new API routes (uses existing skill execution and org agent config endpoints)
- No changes to the agent execution pipeline
- No changes to the scheduler
- No client-facing components
- No new integrations

---

## Files Changed

| File | Change | Type |
|------|--------|------|
| `server/db/schema/morningBriefings.ts` | New schema | New file |
| `server/db/schema/index.ts` | Export new schema | Edit |
| `migrations/XXXX_morning_briefings.sql` | Migration | Generated |
| `server/skills/store_briefing.md` | New skill definition | New file |
| `server/services/skillExecutor.ts` | Add `store_briefing` processor case | Edit (~20 lines) |
| System agent seed | Morning briefing agent definition | Seed script or API call |

**Total new code:** ~150-200 lines (schema + skill def + processor). The rest is configuration.

---

## Verification Plan

1. **Unit:** Skill processor for `store_briefing` correctly inserts into `morning_briefings` table
2. **Integration:** Manually trigger a morning briefing run via API with `runType: 'manual'` and verify:
   - Agent calls skills in correct sequence
   - Portfolio data is gathered across subaccounts
   - Briefing is stored in `morning_briefings` table
   - Email is proposed to review queue (or auto-sent)
   - Org memory is updated with new insights
3. **Schedule:** Verify cron registration fires correctly via pg-boss logs
4. **Idempotency:** Triggering twice in same time window doesn't produce duplicate briefings (existing idempotency key pattern handles this)
5. **Empty state:** Org with zero subaccounts produces a graceful "no accounts to review" briefing, not an error

---

## Open Questions for Review

1. **Email approval flow** — Option A (manual approval) or Option B (auto-send) for v1?
2. **Default schedule** — 8 AM UTC or should we require timezone config during setup?
3. **Token budget** — 50,000 tokens per briefing run seems right for 10-50 accounts. Should we scale based on account count?
4. **Recipient config** — Where do we store the email distribution list? Options:
   - (a) Field on `orgAgentConfigs` (simplest, keeps it with the agent config)
   - (b) Separate `briefingConfigs` table (more extensible if we add Slack delivery later)
   - (c) Agent's `additionalPrompt` (org admin writes "send to: alice@agency.com, bob@agency.com")
5. **Scope limiting** — Should the briefing always review ALL subaccounts, or respect `allowedSubaccountIds` on the org agent config? (The skills already support this filtering.)
