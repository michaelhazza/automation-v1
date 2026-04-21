# Operator-as-Agency Architecture — Codebase Investigation Report

**Scope:** investigation only, no code changes.
**Branch:** `claude/codebase-research-report-xQQbg`
**Date:** 2026-04-21
**Executor:** Claude Code main session, orchestrating seven parallel Explore agents (one per investigation question).

This report is the output of the research brief titled *"Claude Code Investigation Brief — Operator-as-Agency Architecture"*. It is intended to be the input to a planning session for the operator-as-agency build — specifically for a Synthetos-run "Sales Pipeline" subaccount that discovers leads, runs outreach, detects conversion signals, provisions new client subaccounts, and kicks off onboarding.

Every finding below cites specific files and line numbers from the current `main` so an implementer can pick up each section and build from it without re-exploring the codebase. The tone is deliberately precise and exhaustive — brevity was traded for actionability.

---

## Table of contents

- [How to read this report](#how-to-read-this-report)
- [Cross-cutting findings](#cross-cutting-findings)
- [Q1 — Lead lifecycle schema within a subaccount](#q1--lead-lifecycle-schema-within-a-subaccount)
- [Q2 — Scheduled agent targeting a specific subaccount (pg-boss)](#q2--scheduled-agent-targeting-a-specific-subaccount-pg-boss)
- [Q3 — CRM configuration model (`crm_type` enum)](#q3--crm-configuration-model-crm_type-enum)
- [Q4 — Inbound signal handling & event-driven subaccount conversion](#q4--inbound-signal-handling--event-driven-subaccount-conversion)
- [Q5 — External API credential storage & HTTP patterns](#q5--external-api-credential-storage--http-patterns)
- [Q6 — Outreach email via Resend & reply tracking](#q6--outreach-email-via-resend--reply-tracking)
- [Q7 — Playbook template instantiation for new-client onboarding](#q7--playbook-template-instantiation-for-new-client-onboarding)
- [Consolidated risk register](#consolidated-risk-register)
- [Appendix A — Key files by subsystem](#appendix-a--key-files-by-subsystem)

---

## How to read this report

Each question is structured identically:

1. **Finding** — what the codebase currently does, with `file:line` citations and, where useful, verbatim code/schema snippets.
2. **Gap** — concrete list of what's missing for the operator-as-agency use case.
3. **Recommended approach** — the minimal change that closes the gap: SQL fragments, pseudocode, or interface definitions.
4. **Risk / uncertainty** — items that warrant a second opinion, a small proof of concept, or a design-decision checkpoint before implementation.

Where a question depends on the output of another question, the dependency is flagged inline. The strongest cross-cutting dependencies are:

- Q4 (conversion flow) orchestrates Q1 (lead schema), Q3 (CRM routing), Q6 (email) and Q7 (playbook instantiation).
- Q5 (credentials) underpins Q6 (Resend) and any new `lead_discover`/`lead_score` skill.
- Q2 (scheduling) is where a nightly `lead_discover` tick lives; Q7 describes how the onboarding playbook is launched from the conversion job Q4 designs.

---

## Cross-cutting findings

Five architectural properties are true across the codebase today and should be treated as design constraints for the operator-as-agency build:

1. **Three adapter layers, only one generic.** `IntegrationAdapter` (`server/adapters/integrationAdapter.ts:286`) is a formal interface that GHL implements for ingestion/webhook/CRM/messaging/ticketing. `ExecutionAdapter` (`server/services/adapters/apiAdapter.ts`) is a parallel, GHL-hardwired dispatch path used by `executionLayerService` for approved outbound actions. A third, `IntegrationAdapter.crm.createContact`, exists but is under-used. A `synthetos_native` CRM will need to slot into both the generic ingestion path (easy) and replace/wrap the GHL-hardwired execution path (harder — see Q3).
2. **Per-subaccount scoping flows through pg-boss job payloads + `withOrgTx` + `withPrincipalContext`.** `server/lib/createWorker.ts:60` opens a `withOrgTx` block for every job that has `organisationId` + `subaccountId` in the payload; RLS session variables (`app.organisation_id`, `app.current_subaccount_id`, `app.current_principal_type`) are set automatically. Any new per-subaccount scheduled job (Q2) plugs straight into this pattern.
3. **Migrations are hand-written SQL applied by `scripts/migrate.ts`, not `drizzle-kit push`.** Current highest migration is `0189_llm_requests_all_view.sql`; there is a known `0185_` collision and a missing `0183`. The next safe number for this work is `0190`. CLAUDE.md line 399 says "Drizzle migration files only; never raw SQL schema changes," which is contradicted by the actual repo — the custom runner is the source of truth.
4. **Playbook templates are immutable-versioned.** `playbook_runs.template_version_id` is a FK to `playbook_template_versions.id`, not to the template header. Template edits publish a new version; in-flight runs continue reading the version they started with (Q7 finding). This means the onboarding template can be edited safely while conversion playbooks are in flight.
5. **`executeMethodologySkill` returns a scaffold, not a parsed result.** The platform's canonical structured-LLM-output pattern is the playbook `agent_decision` step, parsed via `parseDecisionOutput()` (`server/lib/playbook/agentDecisionPure.ts:363`). Any new intent classifier for conversion detection (Q4) must be wrapped in an `agent_decision` step to get a machine-validated `chosenBranchId` — inline parsing of `classify_email`-style skill output is fragile.

The single most consequential architectural decision this investigation surfaces is **where conversion-event-to-playbook wiring lives** (Q4). The recommended answer is a new `conversion_rules` table (org-scoped, `event_type → playbook_template_id`), not hardcoded routing. Every other recommendation below — the `canonical_prospect_profiles` extension table, the `crm_type` column on `subaccounts`, the new `outreach_sends` table with `provider_message_id` — is relatively mechanical. The conversion-rules model is what keeps the platform multi-tenant-correct when a second org adopts the pattern.

---

## Q1 — Lead lifecycle schema within a subaccount

### Q1 Finding

**Canonical contact schema — where it lives.** Defined across two files and three migrations:

- Primary Drizzle definition: `server/db/schema/canonicalEntities.ts:12-47`
- Original migration: `migrations/0044_integration_layer_canonical_schema.sql:60-79`
- P3A visibility columns added: `migrations/0166_p3a_canonical_columns.sql:20-35`
- RLS policies added: `migrations/0168_p3b_canonical_rls.sql:68-113`

**Complete current `canonical_contacts` column list:**

| Column | Type | Source |
|---|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` | mig 0044 |
| `organisation_id` | `uuid NOT NULL REFERENCES organisations(id)` | mig 0044 |
| `account_id` | `uuid NOT NULL REFERENCES canonical_accounts(id) ON DELETE CASCADE` | mig 0044 |
| `external_id` | `text NOT NULL` | mig 0044 |
| `first_name`, `last_name`, `email`, `phone` | `text` (nullable) | mig 0044 |
| `tags` | `jsonb` (string[]) | mig 0044 |
| `source` | `text` | mig 0044 |
| `owner_user_id` | `uuid REFERENCES users(id)` | mig 0166 |
| `visibility_scope` | `text NOT NULL DEFAULT 'shared_subaccount'` (`'private'\|'shared_team'\|'shared_subaccount'\|'shared_org'`) | mig 0166 |
| `shared_team_ids` | `uuid[] NOT NULL DEFAULT '{}'` | mig 0166 |
| `source_connection_id` | `uuid REFERENCES integration_connections(id)` | mig 0166 |
| `created_at`, `updated_at` | `timestamptz NOT NULL DEFAULT now()` | mig 0044 |
| `external_created_at` | `timestamptz` | mig 0044 |

Indexes at `canonicalEntities.ts:35-46`: `UNIQUE(account_id, external_id)`, `account_idx`, `org_idx`, partial `owner_user_id_idx WHERE owner_user_id IS NOT NULL`, GIN `shared_team_gin_idx`, partial `source_connection_idx WHERE source_connection_id IS NOT NULL`.

Critical structural note: `canonical_contacts` does **not** have a `subaccount_id` column directly. The join path is `canonical_contacts → canonical_accounts → subaccounts`. Migration 0168 line 68 explicitly flags "no subaccount_id" when enabling RLS.

**Lifecycle-oriented columns — present/absent audit.** Every lifecycle column required for lead management is absent:

| Column | Present? |
|---|---|
| `prospect_status` / `lead_status` | **Absent** |
| `lead_score` | **Absent** |
| `outreach_stage` | **Absent** |
| `last_outreach_at` / `last_contact_at` | **Absent** (`updated_at` is generic row mutation) |
| `converted_at` | **Absent** |
| `converted_to_subaccount_id` | **Absent** |
| generic `stage` | Partial — `canonical_opportunities` (`canonicalEntities.ts:61`) has `stage`, `stage_entered_at`, `stage_history`, but that is a CRM deal, not a nurtured prospect |

Grep across `server/db/schema/**/*.ts` for `lead`, `prospect`, `outreach_stage`, `lead_score`, `converted_at`, `conversion_to` returned **zero matches**.

**The existing `conversionEvents` table is not reusable.** `server/db/schema/conversionEvents.ts` (27 lines) is a funnel event log for landing pages:
- FK to `pages.id` (NOT NULL) and optional `form_submissions.id`
- `event_type`: `'form_submitted' | 'checkout_started' | 'checkout_completed' | 'checkout_abandoned' | 'contact_created'`
- No `organisation_id`, no `subaccount_id`, no contact FK
- Not in `rlsProtectedTables.ts`

Cannot be repurposed for Sales Pipeline conversion events — Q4 proposes a separate `bd_conversion_events` table to avoid collision.

**Existing "lead" / "prospect" concept across `server/**`:** grep returned only false positives (`leadconnectorhq.com` in GHL URLs, `create_lead_magnet` in the action registry at `actionRegistry.ts:1722-1738`, `\blead\b` as a topic-routing keyword in `topicRegistry.ts:44`, Salesforce `create_lead` as an MCP tool highlight). **There is no internal "lead" or "prospect" entity anywhere in the Synthetos data layer.**

**Canonical-table conventions — the pattern any new table must follow.**

- Uniqueness (`clientPulseCanonicalTables.ts:56-68`): GLOBAL mode `UNIQUE(organisation_id, provider_type, external_id)`, SCOPED mode `UNIQUE(organisation_id, subaccount_id, provider_type, external_id)`.
- Partial indexes on nullable FK columns (`canonicalEntities.ts:39-41`, `clientPulseCanonicalTables.ts:474-477`).
- RLS (migration `0168_p3b_canonical_rls.sql:70-113`): every canonical table gets `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`, plus a `canonical_writer` bypass policy (org-scoped) and a principal-read policy covering `service`/`user`/`delegated`.
- Any new table with `organisation_id` **must** be added to `server/config/rlsProtectedTables.ts` in the same commit.
- Dictionary registry entry is required in `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts` (follow pattern at lines 17-590).

**Migration authoring convention.** `package.json:13` defines `"migrate": "tsx scripts/migrate.ts"` as the live runner. `tasks/windows-iee-setup-guide.md:259` and `:507-508` are the source of truth: *"Migrations are applied via the custom `npm run migrate` runner, not `drizzle-kit migrate` or `drizzle-kit push`. The drizzle journal stops at migration 0040 — everything after that is hand-written SQL."* Current highest filename is `0189_llm_requests_all_view.sql`; known collision on `0185_` (two files) and missing `0183`. **Next safe number is `0190`.**

### Q1 Gap

- No `prospect_status`, `lead_score`, `outreach_stage`, `last_outreach_at`, `converted_at`, `converted_to_subaccount_id` anywhere.
- `conversionEvents` cannot be repurposed — no org FK, no contact FK, no RLS.
- `CANONICAL_UNIQUENESS_MODE` registry has no prospect entries.
- `canonicalDictionaryRegistry.ts` has no prospect entry.
- `rlsProtectedTables.ts` needs a new entry.
- **Design decision to resolve:** columns on `canonical_contacts` vs separate `canonical_prospect_profiles` extension table.

### Q1 Recommended approach

**Recommendation: new `canonical_prospect_profiles` table, not columns on `canonical_contacts`.**

Reasoning:
- `canonical_contacts` is populated by CRM adapters for *every* subaccount in the org — adding lifecycle fields pollutes every client's contacts with BD-only fields.
- The Sales Pipeline subaccount is a bounded context (Synthetos' own internal BD) — isolate its overlay state in a dedicated table.
- The pattern mirrors `client_pulse_health_snapshots` extending `canonical_accounts` with a score.
- A separate table can be owned by `canonical_writer` for pipeline automation without touching existing RLS on `canonical_contacts`.

```sql
-- migrations/0190_sales_pipeline_prospect_profiles.sql
BEGIN;

CREATE TABLE canonical_prospect_profiles (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant scoping
  organisation_id            uuid NOT NULL REFERENCES organisations(id),
  subaccount_id              uuid NOT NULL REFERENCES subaccounts(id),
  -- subaccount_id denormalised: canonical_contacts.account_id → canonical_accounts.subaccount_id
  -- is one hop away and the FK is nullable. Direct denorm makes RLS and filtering trivial.

  -- Parent contact (1:1 per subaccount context)
  canonical_contact_id       uuid NOT NULL REFERENCES canonical_contacts(id) ON DELETE CASCADE,

  -- Lifecycle state
  prospect_status            text NOT NULL DEFAULT 'prospect'
                             CHECK (prospect_status IN (
                               'prospect','active','qualified',
                               'disqualified','converted'
                             )),

  outreach_stage             text
                             CHECK (outreach_stage IN (
                               'cold','contacted','demo_scheduled',
                               'proposal_sent','negotiating'
                             ) OR outreach_stage IS NULL),

  lead_score                 integer CHECK (lead_score BETWEEN 0 AND 100),
  last_outreach_at           timestamptz,

  -- Conversion
  converted_at               timestamptz,
  converted_to_subaccount_id uuid REFERENCES subaccounts(id) ON DELETE SET NULL,

  -- Disqualification
  disqualification_reason    text,

  -- Audit
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE UNIQUE INDEX canonical_prospect_profiles_contact_sub_unique
  ON canonical_prospect_profiles (subaccount_id, canonical_contact_id);

CREATE INDEX canonical_prospect_profiles_sub_status_idx
  ON canonical_prospect_profiles (subaccount_id, prospect_status, lead_score DESC);

CREATE INDEX canonical_prospect_profiles_sub_outreach_idx
  ON canonical_prospect_profiles (subaccount_id, last_outreach_at)
  WHERE last_outreach_at IS NOT NULL;

CREATE INDEX canonical_prospect_profiles_converted_idx
  ON canonical_prospect_profiles (organisation_id, converted_at)
  WHERE prospect_status = 'converted';

-- RLS (follows migration 0168 pattern)
ALTER TABLE canonical_prospect_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_prospect_profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY canonical_prospect_profiles_writer_bypass
  ON canonical_prospect_profiles
  FOR ALL TO canonical_writer
  USING  (organisation_id = current_setting('app.organisation_id', true)::uuid)
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true)::uuid);

CREATE POLICY canonical_prospect_profiles_principal_read
  ON canonical_prospect_profiles FOR SELECT USING (
    organisation_id = current_setting('app.organisation_id', true)::uuid
    AND (
      (current_setting('app.current_principal_type', true) = 'service'
        AND subaccount_id = current_setting('app.current_subaccount_id', true)::uuid)
      OR current_setting('app.current_principal_type', true) = 'user'
      OR current_setting('app.current_principal_type', true) = 'delegated'
    )
  );

COMMIT;
```

**Companion changes required in the same PR:**

1. Add Drizzle table definition to `server/db/schema/canonicalEntities.ts` (or a new `canonicalProspectProfiles.ts`) with matching TS types.
2. Append an entry to `server/config/rlsProtectedTables.ts`.
3. Add a `CanonicalTableEntry` to `server/services/canonicalDictionary/canonicalDictionaryRegistry.ts`.
4. Run `npm run db:generate` (not `drizzle-kit push`).

### Q1 Risk / uncertainty

- **Denormalised `subaccount_id` integrity** — not enforced by DB CHECK (the subaccount UUID is not known at migration time). Writer layer must assert `subaccount_id` matches the parent `canonical_account`'s subaccount before INSERT. Covered by the existing `canonical_writer` pattern but worth a PoC assertion test.
- **`converted_to_subaccount_id` `ON DELETE` semantics** — `SET NULL` is a safety net given soft-delete (`subaccounts.deleted_at` exists at `subaccounts.ts:76`). `RESTRICT` would be a stronger correctness signal; worth a second opinion.
- **DB `CHECK` vs Drizzle `.$type<>()` sync** — both are used across the codebase; keep them in sync. Expanding the enum requires a migration.
- **Two-phase write safety for `outreach_stage`** — the partial `CHECK` on outreach_stage may conflict with a two-phase upsert path. Recommend a PoC that confirms atomicity before tightening the constraint.
- **Migration numbering collision** — confirm no in-flight branch already claims `0190` before filing.
- **Deliberate omission of `visibility_scope` / `owner_user_id` / `shared_team_ids`** — intentional because Sales Pipeline is an internal workspace. Retrofit cost is non-trivial if the team later grows beyond a single operator.

---

## Q2 — Scheduled agent targeting a specific subaccount (pg-boss)

### Q2 Finding

**pg-boss initialisation — singleton instance.** `server/lib/pgBossInstance.ts:13-24`:

```ts
instance = new PgBoss({
  connectionString: env.DATABASE_URL,
  retentionDays: 7,
  archiveCompletedAfterSeconds: 43200,  // 12h
  deleteAfterDays: 14,
  monitorStateIntervalSeconds: 30,
});
await instance.start();
```

No global `teamSize`/`teamConcurrency` — those are set per-queue at `work()` time.

**`send()` / `schedule()` patterns in active use:**

1. **Raw `boss.send()`** — used in `queueService.ts` one-offs, e.g. `server/services/queueService.ts:123-128` (`boss.send(EXECUTION_QUEUE_NAME, { executionId }, getJobConfig('execution-run'))`).

2. **`queueService.sendJob()`** — thin wrapper at `server/services/queueService.ts:421-429`:
   ```ts
   async sendJob(queueName: string, data: object): Promise<void> {
     const boss = await getPgBoss();
     await boss.send(queueName, data);   // ← bare send, NO singletonKey, NO options
   }
   ```
   **Trap: this wrapper silently strips options.** Any caller that needs `singletonKey` must call `boss.send()` directly.

3. **`singletonKey` per-entity** — only one existing example at `server/jobs/connectorPollingTick.ts:46-52`:
   ```ts
   await boss.send('connector-polling-sync', {
     organisationId, connectionId,
   }, {
     singletonKey: `connector-polling-sync-${connectionId}`,
   });
   ```
   Formula: `<queue-name>-<unique-entity-id>`. `jobConfig.ts` lines 11-15 document this as the `singleton-key` idempotency strategy.

4. **`boss.schedule()`** — three variants:
   - Global maintenance (no data): `queueService.ts:946` — `boss.schedule('maintenance:cleanup-execution-files', '0 * * * *', {})`
   - Per-subaccount agent schedule: `server/services/agentScheduleService.ts:263`:
     ```ts
     const scheduleName = `${AGENT_RUN_QUEUE}:${subaccountAgentId}`;
     await pgboss.schedule(scheduleName, cron, data, { tz: tz || 'UTC' });
     ```
   One pg-boss named schedule per `subaccountAgentId` — the dedup is in the schedule name, not `singletonKey`.

**Existing per-subaccount job examples:**

- `clientpulse:propose-interventions` (event-driven) — `intelligenceSkillExecutor.ts:601-605`:
  ```ts
  await queueService.sendJob('clientpulse:propose-interventions', {
    organisationId, subaccountId: account.subaccountId, churnAssessmentId: assessmentId,
  });
  ```
  Handler idempotency via deterministic `idempotencyKey = subaccountId + templateSlug + churnAssessmentId` (not `singletonKey`). Worker registered at `queueService.ts:812` with `{ teamSize: 2, teamConcurrency: 1 }`.

- `agent-scheduled-run:<subaccountAgentId>` (cron) — `agentScheduleService.ts:261-265` — one pg-boss schedule per `subaccountAgents` row. `idempotencyKey` on resulting `agent_runs` row is `scheduled:<subaccountAgentId>:<jobId>` (line 83).

- `connector-polling-sync` (tick fan-out) — covered above. One job per `connectionId` per minute, dedup via `singletonKey`.

**Scheduling storage model — two coexisting subsystems:**

1. **`subaccountAgents.scheduleCron`** (plain cron, not RRULE) — `server/db/schema/subaccountAgents.ts:32`. Managed by `agentScheduleService.registerSchedule()`, which calls `pgboss.schedule()`. Schedule rows live in pg-boss's `boss.schedule` table.

2. **`scheduled_tasks.rrule`** (full RRULE) — `server/db/schema/scheduledTasks.ts:34`. RRULE processed in-process by `rrule.js` in `scheduledTaskService.computeNextOccurrence()` (`server/services/scheduledTaskService.ts:523-568`). Fired by `scheduledTaskService.fireOccurrence()` — **not pg-boss scheduled; in-process RRULE tick loop keyed off `nextRunAt`**. Comment at line 241: migrating to pg-boss is out of scope.

**Principal context / subaccount-scoped DB writes** — `server/db/withPrincipalContext.ts:21-54`:

```sql
SELECT
  set_config('app.current_subaccount_id',  $1, true),
  set_config('app.current_principal_type', $2, true),
  set_config('app.current_principal_id',   $3, true),
  set_config('app.current_team_ids',       $4, true)
```

Must be called inside `withOrgTx`. `server/lib/createWorker.ts:60-79` opens `withOrgTx` automatically for every job that has `organisationId` + `subaccountId` in its payload. Scheduled/background jobs without a user initiator do **not** currently call `withPrincipalContext` — `principalType` defaults to `'user'` on `agentRuns` (schema default at line 182).

**Agent run lifecycle for scheduled jobs** (`server/services/agentExecutionService.ts:285-380`):

1. Worker receives `agent-scheduled-run:<subaccountAgentId>` via `createWorker`.
2. Calls `executeRun()` with `{ agentId, subaccountId, subaccountAgentId, organisationId, runType: 'scheduled', runSource: 'scheduler', idempotencyKey }`.
3. Validates subaccount/link presence (throws 400 if absent, lines 285-292).
4. Inserts `agent_runs` row with `subaccountId` stamped at insert time (lines 354-380).
5. Loads `subaccountAgents` link for `tokenBudgetPerRun`, `skillSlugs`, etc.

**Concurrency config:** `env.QUEUE_CONCURRENCY` (default 2, `createWorker.ts:88`) applied as `teamSize`. Maintenance workers use `teamSize: 1, teamConcurrency: 1`. Agent dispatch workers use `concurrency: env.QUEUE_CONCURRENCY` (`agentScheduleService.ts:69`). `createWorker` always passes `teamConcurrency: 1` (`createWorker.ts:100`).

### Q2 Gap

- **No `lead_discover` job type exists.** No queue name, no worker, no `jobConfig.ts` entry, no handler file.
- **No `lead_discover` system agent seeded.** No `system_agents` row with `slug = 'lead-discover'`; no seed migration.
- **`queueService.sendJob()` strips options** — any per-subaccount dedup must call `boss.send()` directly. This is a latent trap across the codebase.
- **`scheduledTaskService` RRULE tick has no pg-boss backing** — horizontal scaling safety depends entirely on the `idempotencyKey` on `executeRun`; the `scheduled_tasks.nextRunAt` update is not atomic. Option A (pg-boss `schedule()`) sidesteps this.
- **`principalType: 'user'` default for scheduled runs** — scheduled `agent_runs` have `principalType = 'user'` with empty `principalId`. If any skill called during `lead_discover` performs a write to a principal-scoped table, RLS may reject it. Worth confirming before shipping.
- **No established pattern for per-subaccount *parameters*** (e.g. `vertical`, `location`) — `subaccountAgents.customInstructions` vs job payload is the decision.

### Q2 Recommended approach

**Register the queue.** Add to `server/config/jobConfig.ts`:

```ts
'lead-discover': {
  retryLimit: 2,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 600,
  deadLetter: 'lead-discover__dlq',
  idempotencyStrategy: 'singleton-key' as const,
},
```

**Register the worker.** Inside `queueService.startMaintenanceJobs()`:

```ts
await createWorker<{
  organisationId: string;
  subaccountId: string;
  vertical: string;
  location: string;
}>({
  queue: 'lead-discover',
  boss: boss as any,
  handler: async (job) => {
    const { runLeadDiscover } = await import('../jobs/leadDiscoverJob.js');
    await withTimeout(runLeadDiscover(job.data), 570_000);
  },
});
```

`createWorker` automatically opens `withOrgTx` using `organisationId` + `subaccountId` from the payload, so `getOrgScopedDb()` inside the handler is already scoped.

**Enqueue with the correct `singletonKey` formula.** The fan-out tick must bypass `sendJob()` and call `boss.send()` directly:

```ts
await boss.send(
  'lead-discover',
  {
    organisationId: subaccount.organisationId,
    subaccountId:   subaccount.id,
    vertical:       'legal',
    location:       'Sydney',
  },
  {
    singletonKey: `lead-discover:${subaccount.id}:${new Date().toISOString().slice(0, 10)}`,
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 600,
  }
);
```

**SingletonKey formula (copy-paste ready):**
```
`lead-discover:${subaccountId}:${new Date().toISOString().slice(0, 10)}`
```

This prevents a duplicate nightly run for the same subaccount on the same calendar day. Different subaccounts get distinct keys and run concurrently.

**Handler skeleton** (`server/jobs/leadDiscoverJob.ts`):

```ts
export async function runLeadDiscover(data: {
  organisationId: string;
  subaccountId: string;
  vertical: string;
  location: string;
}): Promise<void> {
  const { organisationId, subaccountId, vertical, location } = data;

  // Resolve the system-agent link for this subaccount
  const [saLink] = await db
    .select({ id: subaccountAgents.id, agentId: subaccountAgents.agentId })
    .from(subaccountAgents)
    .innerJoin(agents, eq(subaccountAgents.agentId, agents.id))
    .innerJoin(systemAgents, eq(agents.systemAgentId, systemAgents.id))
    .where(and(
      eq(subaccountAgents.organisationId, organisationId),
      eq(subaccountAgents.subaccountId, subaccountId),
      eq(systemAgents.slug, 'lead-discover'),
      eq(subaccountAgents.isActive, true),
    ))
    .limit(1);
  if (!saLink) return; // subaccount hasn't opted in

  await agentExecutionService.executeRun({
    agentId: saLink.agentId,
    subaccountId,
    subaccountAgentId: saLink.id,
    organisationId,
    runType: 'scheduled',
    runSource: 'scheduler',
    executionMode: 'api',
    idempotencyKey: `lead-discover:${subaccountId}:${new Date().toISOString().slice(0, 10)}`,
    triggerContext: { source: 'lead_discover_nightly', vertical, location },
  });
}
```

**Schedule storage model — two valid options:**

- **Option A (recommended): `subaccountAgents.scheduleCron = '0 22 * * *'`** per opted-in subaccount. `agentScheduleService.registerSchedule()` registers `agent-scheduled-run:<subaccountAgentId>` in pg-boss. `vertical`/`location` carried in `customInstructions`. No fan-out job needed.
- **Option B: one `scheduled_tasks` row per subaccount** with an RRULE — supports user-editable schedules and per-subaccount timezones. Relies on the in-process RRULE tick.

**`agent_triggers` is not the right table for `lead_discover`** — it is for event-driven triggers (`task_created`, `task_moved`, `agent_completed`), not cron.

### Q2 Risk / uncertainty

- **`queueService.sendJob()` silently drops `singletonKey`** — low-risk one-line fix (add an optional options pass-through) that unblocks cleaner callers across the codebase. Worth raising as a separate chore.
- **`scheduledTaskService` RRULE tick has no horizontal-scaling safety** beyond the `idempotencyKey` dedup. On multi-instance deployments, two workers may call `fireOccurrence()` for the same `nextRunAt` simultaneously. `agent_runs` insert is protected by `idempotencyKey`; the `scheduled_tasks.nextRunAt`/`totalRuns` update (line 718) is **not** atomic. Option A avoids this entirely.
- **`principalType: 'user'` with empty `principalId`** — if the `lead_discover` skills write to principal-scoped canonical tables, writes may fail. Confirm by reading `withPrincipalContext` usage in the skills being called.
- **`vertical` / `location` parameterisation** — payload vs `customInstructions` is a design call. Payload is simpler for the enqueuer; `customInstructions` keeps business config with the subaccount.
- **Seed the `lead-discover` system agent** before any of this wires up — no existing seed script covers this.

---

## Q3 — CRM configuration model (`crm_type` enum)

### Q3 Finding

**Subaccount CRM-config storage today — there is none.** `server/db/schema/subaccounts.ts:17-85` columns are: `id`, `organisationId`, `name`, `slug`, `status`, `settings`, `includeInOrgInbox`, `isOrgSubaccount`, `portalMode`, `clarificationRoutingConfig`, `portalFeatures`, `clientUploadTrustState`, `runRetentionDays`, `createdAt`, `updatedAt`, `deletedAt`. **No CRM discriminator of any kind.**

**Where CRM configuration actually lives** — two tables cooperate:

1. **`integration_connections`** (`server/db/schema/integrationConnections.ts:13-78`) — the primary credential store. Per-subaccount (when `subaccountId IS NOT NULL`) or org-level (when null).
   - `providerType` typed enum at line 22: `'gmail' | 'github' | 'hubspot' | 'slack' | 'ghl' | 'stripe' | 'teamwork' | 'web_login' | 'custom'`
   - For GHL: `configJson` stores `locationId` (resolved in `ghlReadHelpers.ts:49` and `apiAdapter.ts:165`); `accessToken` (encrypted) at line 33.

2. **`connector_configs`** (`server/db/schema/connectorConfigs.ts:6-35`) — controls polling/sync. Per-org with optional subaccount scoping.
   - `connectorType` typed enum at line 12: `'ghl' | 'hubspot' | 'stripe' | 'slack' | 'teamwork' | 'custom'`
   - Links to `integrationConnections` via `connectionId`
   - `UNIQUE(organisationId, connectorType)` at line 27 — one polling config per connector type per org.

3. **`project_integrations`** (`server/db/schema/projectIntegrations.ts`) — purpose-tagged (`crm | payments | email | ads | analytics`) references to connection rows, scoped to a `pageProject`. Not relevant to the main contact read/write flow.

CRM association is inferred at runtime: `resolveGhlContext()` does `WHERE organisationId = ? AND subaccountId = ? AND providerType = 'ghl'` (`ghlReadHelpers.ts:33-45`). **There is no explicit `crm_type` column anywhere.**

**Existing adapter abstraction — yes, a formal interface exists.** `server/adapters/integrationAdapter.ts:286-335`:

```ts
export interface IntegrationAdapter {
  supportedActions: string[];
  crm?: {
    createContact(connection, fields): Promise<CrmCreateContactResult>;
  };
  payments?: { ... };
  ticketing?: { ... };
  messaging?: { ... };
  ingestion?: {
    listAccounts(connection, config): Promise<CanonicalAccountData[]>;
    fetchContacts(connection, accountExternalId, opts?): Promise<CanonicalContactData[]>;
    fetchOpportunities(...): Promise<CanonicalOpportunityData[]>;
    fetchConversations(...): Promise<CanonicalConversationData[]>;
    fetchRevenue(...): Promise<CanonicalRevenueData[]>;
    validateCredentials(connection): Promise<{ valid: boolean; error?: string }>;
    computeMetrics?(...): Promise<CanonicalMetricData[]>;
  };
  webhook?: {
    verifySignature(payload, signature, secret): boolean;
    normaliseEvent(rawEvent): NormalisedEvent | null;
  };
}
```

`ghlAdapter.ts:52` exports `export const ghlAdapter: IntegrationAdapter`. Registry at `server/adapters/index.ts:8-13` maps `'ghl'`, `'stripe'`, `'teamwork'`, `'slack'`.

**However, there is a parallel execution-dispatch path that is NOT abstracted.** `server/services/adapters/apiAdapter.ts` implements a different `ExecutionAdapter` interface (`execute(action, connection)`) used by `executionLayerService` for approved outbound actions. It is 100% GHL-hardwired — talks to `GHL_ENDPOINTS`, builds GHL-bearer headers, GHL-specific error messages. This is the dispatch path that `crm.*` action primitives go through.

**Contact write call path (trace of `crm.send_email`):**

1. `server/services/skillExecutor.ts:1363` — `'crm.send_email': async (input, context) => proposeReviewGatedAction('crm.send_email', input, context)`
2. `proposeReviewGatedAction` → `actionService.proposeAction(...)` → inserts row into `actions` with `status='pending_review'`, `actionCategory='api'` (from `actionRegistry.ts:2634`).
3. Operator approves → `reviewService` → `executionLayerService.executeAction(actionId, orgId)`.
4. `server/services/executionLayerService.ts:193` — resolves adapter via `adapterRegistry[definition.actionCategory]` → `adapterRegistry['api']` = `apiAdapter`.
5. Lines 210-229 — loads `integrationConnections` row where `providerType = payload.provider` (GHL), `subaccountId = action.subaccountId`, `connectionStatus='active'`.
6. Line 233 — `adapter.execute(action, connection)` → `apiAdapter.execute(...)`.
7. `apiAdapter.ts:197` — `GHL_ENDPOINTS[actionType]` → `{ urlTemplate: '/contacts/{contactId}/emails', method: 'POST', requiredFields: [...] }`.
8. Lines 290-307 — builds URL via `resolveBaseUrl(connection) + substituteUrlTemplate(...)`.
9. Lines 315-323 — raw `fetch` with `Authorization: Bearer <accessToken>`.

**Contact read call path (trace of `listGhlContacts`):**

1. Client → picker API → `crmLiveDataService.ts:1+`.
2. Imports `listGhlContacts`, `resolveGhlContext` from `ghlReadHelpers.ts:1-8`.
3. `resolveGhlContext` (`ghlReadHelpers.ts:31-58`) queries `integrationConnections` for `providerType='ghl'`, extracts `locationId`.
4. `listGhlContacts(ctx, search)` (`ghlReadHelpers.ts:158-166`) — axios GET `${ctx.baseUrl}/contacts/?locationId=...`.
5. Returns `GhlReadResult<RawGhlContact>` — `crmLiveDataService` caches and canonicalises.

**Canonical write paths a native CRM could reuse:**

- `server/services/ghlWebhookMutationsService.ts:62` — writes to `canonical_subaccount_mutations` with `providerType: 'ghl'` hardcoded. The table and `db.insert(...).onConflictDoNothing(...)` path is already generic — only the mapper is GHL-specific.
- `server/services/clientPulseIngestionService.ts:62` — `ClientPulseIngestionInput.connectorType: 'ghl'` is a literal type; all signal fetchers call `ghlClientPulseFetchers` directly. `connectorPollingService.ts:233` carries the explicit comment: *"GHL-only for now; a second CRM would need its own fetchers in a parallel path."*
- `canonicalDataService.upsertAccount/upsertContact/upsertOpportunity/upsertConversation/upsertRevenue` (called from `connectorPollingService.ts:117-162`) is already provider-agnostic — a `synthetos_native` adapter implementing `IntegrationAdapter.ingestion` slots in with zero changes to the polling service.

**Direct GHL references — scope of change.** Production files touching `ghlAdapter | ghlEndpoints | ghlReadHelpers`: 6 files (`ghlAdapter.ts`, `adapters/index.ts`, `apiAdapter.ts`, `ghlReadHelpers.ts`, `crmLiveDataService.ts`, `clientPulseIngestionService.ts`). Plus `ghlWebhookMutationsService.ts:62` and `connectorPollingService.ts:235`/`:240` have hardcoded `'ghl'` literals. The `IntegrationAdapter.ingestion` path via `connectorPollingService` is already properly abstracted — zero changes there other than registering a new adapter.

**Intervention action primitive CRM branching — there is none.** `skillExecutor.ts:1358-1374` — the four primitives `crm.fire_automation`, `crm.send_email`, `crm.send_sms`, `crm.create_task` unconditionally call `proposeReviewGatedAction(...)` → `actionCategory: 'api'` → `apiAdapter` → `GHL_ENDPOINTS`. The `payload.provider` field exists (`actionRegistry.ts:2614, 2640, 2664, 2695`) but is not used for branching; `apiAdapter` returns `apiAdapter does not handle actionType` for anything not in its GHL map.

The legacy `update_crm` handler (`skillExecutor.ts:2354-2397`) is an explicit stub: *"CRM write APIs not yet connected. Logs intended field changes."*

### Q3 Gap

1. No `crm_type` discriminator on `subaccounts` — root gap.
2. `apiAdapter` is GHL-hardwired — the `crm.*` dispatch path needs branching for native writes.
3. `crmLiveDataService` + `ghlReadHelpers` are GHL-hardwired — the live-picker layer needs a native read path.
4. `clientPulseIngestionService.connectorType: 'ghl'` is a literal type — needs widening and fallback logic.
5. `ghlWebhookMutationsService.ts:62` hardcodes `providerType: 'ghl'`.
6. `connector_configs.connectorType` and `integration_connections.providerType` enums don't include `'synthetos_native'`.
7. Native CRM has no `externalId` — the canonical tables assume one.

### Q3 Recommended approach

**(a) Schema change — `crm_type` on `subaccounts`, not `connector_configs`.**

```sql
ALTER TABLE subaccounts
  ADD COLUMN crm_type text NOT NULL DEFAULT 'ghl'
  CHECK (crm_type IN ('ghl', 'synthetos_native'));

COMMENT ON COLUMN subaccounts.crm_type IS
  'Determines which CRM adapter handles contact reads/writes for this subaccount.
   ghl = GoHighLevel via integration_connections; synthetos_native = canonical tables are the CRM.
   Default ghl preserves existing behaviour for all subaccounts created before this migration.';
```

**Why `subaccounts` and not `connector_configs`:** `connector_configs` has `UNIQUE(organisationId, connectorType)` — it is an org-level ingestion-polling configuration. CRM type is a property of how a *subaccount* is managed, not of org-wide polling. Putting it on `subaccounts` makes the routing check a single column read.

**Why not a new `crm_configs` table:** the config is a single enum today; native requires no credentials. Separate table = join overhead without benefit.

**(b) Routing change — formal `CrmAdapter` interface, not ad-hoc conditionals.**

Rationale: branching is needed in three places (`apiAdapter`, `crmLiveDataService`, `clientPulseIngestionService`). Duplicating conditionals across three surfaces creates drift risk. A formal interface also matches the existing `IntegrationAdapter` pattern.

**Proposed interface** (new file `server/adapters/crmAdapter.ts`):

```ts
export interface CrmContact {
  id: string; firstName?: string; lastName?: string;
  email?: string; phone?: string; tags?: string[];
}
export interface CrmUser {
  id: string; firstName?: string; lastName?: string; email?: string; role?: string | null;
}
export interface CrmAutomation { id: string; name: string; status: string; }
export interface CrmActionPayload {
  actionType: 'crm.fire_automation' | 'crm.send_email' | 'crm.send_sms' | 'crm.create_task';
  payload: Record<string, unknown>;
  idempotencyKey: string;
  timeoutMs?: number;
}
export interface CrmActionResult {
  success: boolean; error?: string; errorCode?: string; retryable?: boolean;
}
export interface CrmAdapterContext {
  organisationId: string;
  subaccountId: string;
  connection?: IntegrationConnection | null;  // GHL required; Native ignored
}
export interface CrmAdapter {
  listContacts(ctx: CrmAdapterContext, search?: string): Promise<CrmContact[]>;
  listUsers(ctx: CrmAdapterContext, search?: string): Promise<CrmUser[]>;
  listAutomations(ctx: CrmAdapterContext, search?: string): Promise<CrmAutomation[]>;
  executeAction(ctx: CrmAdapterContext, action: CrmActionPayload): Promise<CrmActionResult>;
}
```

**Switch point — `executionLayerService.ts:193-233`:** currently routes all `actionCategory: 'api'` through `apiAdapter`. Change to:

```ts
if (definition.actionCategory === 'api' && isCrmAction(action.actionType)) {
  const crmAdapter = await resolveCrmAdapter(action.organisationId, action.subaccountId);
  const result = await crmAdapter.executeAction(crmCtx, { ... });
} else {
  // existing path
}
```

`resolveCrmAdapter(orgId, subaccountId)` reads `subaccounts.crm_type` and returns `ghlCrmAdapter` (wraps existing `apiAdapter` + `ghlReadHelpers`) or `nativeCrmAdapter` (writes canonical tables).

**Additional switch points:**
- `crmLiveDataService.ts` — swap internal calls (`resolveGhlContext`, `listGhlContacts`, etc.) for `crmAdapter.listContacts(...)` etc. Output types (`CrmContact`, `CrmUser`) are already CRM-agnostic.
- `connectorPollingService.ts:235` — the `if (config.connectorType === 'ghl')` guard for ClientPulse signals needs extending with a native-CRM branch (most signals will be `unavailable_other` for native).

### Q3 Risk / uncertainty

- **Backfill safety** — `DEFAULT 'ghl'` preserves existing behaviour. Recommend an application-layer guard that refuses to set `crm_type = 'ghl'` on a subaccount with no active `integrationConnections` row (avoids data drift if a native subaccount is mis-flipped).
- **`connector_configs` uniqueness** — native subaccounts need no row here; the polling service already skips missing configs. No change needed.
- **ClientPulse signal coverage** — signals 2-8 are GHL-native concepts (funnels, calendars, subscription tier). Native subaccounts compute most as `unavailable_other`; `staff_activity_pulse` can be derived from `canonical_subaccount_mutations`. The `ClientPulseIngestionInput.connectorType` literal must widen to `'ghl' | 'synthetos_native'`.
- **RLS on canonical tables is already correct** — canonical reads/writes are principal-scoped on `app.organisation_id`; a native write path gets correct isolation for free.
- **`canonical_subaccount_mutations.providerType` is `text`** — accepts `'synthetos_native'` without schema change; update Drizzle `$type<>()` to keep TS in sync.
- **No `externalId` for native entities** — two options: use the Synthetos UUID as `externalId` (backward-compatible with the existing unique index), or add an `is_native` boolean guard to skip the external-ID uniqueness assumption. Using the UUID is simpler and does not change the index semantics.
- **`apiAdapter` also handles non-CRM `api` actions** — ensure the routing conditional only branches on `crm.*`-namespaced actions, not every `api`-category action.

---

## Q4 — Inbound signal handling & event-driven subaccount conversion

*(section appended below)*

---

## Q5 — External API credential storage & HTTP patterns

*(section appended below)*

---

## Q6 — Outreach email via Resend & reply tracking

*(section appended below)*

---

## Q7 — Playbook template instantiation for new-client onboarding

*(section appended below)*

---

## Consolidated risk register

*(section appended below)*

---

## Appendix A — Key files by subsystem

*(section appended below)*
