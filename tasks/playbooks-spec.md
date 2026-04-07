# Playbooks — Detailed Dev Specification

**Status:** Final review draft
**Owner:** TBD
**Related:** `architecture.md` § Playbooks (Multi-Step Automation)
**Target migration:** `0074_playbooks.sql`
**Last research integration:** Architecture review (singletonKey, non-blocking lock, side-effect classification, output-hash firewall, prototype-pollution hardening, watchdog sweep, parameterization deferred to 1.5)
**Last main integration:** Reporting Agent paywall workflow merge (shared infra: `withBackoff`, `runCostBreaker`, `failure` helper, `skillVisibility`, `canonicaliseUrl`)

## 0. How to read this document

Sections 1–4 cover the data model and authoring format — read these to understand **what** a playbook is. Sections 5–8 cover runtime — read these to understand **how** the engine executes. Sections 9–10 cover UI and authoring workflow. Sections 11–13 cover testing, rollout, and risk. Section 14 is a sign-off checklist.

The single most important constraint to internalise: **every step declares a `sideEffectType`, and the engine never auto-re-executes irreversible steps.** Mid-run editing is the feature most likely to cause real customer harm if implemented naively, and §5.4 exists to prevent that.

## 1. Overview

Playbooks automate longer-form, multi-step processes against a subaccount. A Playbook is a versioned, immutable **DAG of steps** — each step is a prompt, an agent call, a user-input form, an approval gate, or a conditional. Steps consume outputs from earlier steps via templating against a growing run-level context. Independent branches execute in parallel.

The motivating use case: a 15-step "create a new event" workflow that produces landing page copy, three promo emails, a confirmation email, social posts, and an internal brief — currently run as 15 manual prompts, each carrying context forward by hand.

This spec covers **Phase 1**: the engine, schema, services, routes, and run-execution UI. Templates are authored as TypeScript files in `server/playbooks/*.playbook.ts` and seeded into the database on deploy. **Phase 1.5** layers parameterization on top of the fork model. **Phase 2** adds a visual canvas builder for org users.

### 1.1 Glossary

| Term | Meaning |
|------|---------|
| **DAG** | Directed Acyclic Graph. Steps declare `dependsOn` on earlier step ids. The engine topologically sorts and runs independent branches in parallel. No cycles permitted. |
| **Playbook Template** | The definition — steps, dependencies, prompts, schemas. Versioned and immutable once published. |
| **Playbook Version** | A frozen snapshot of a template. Runs lock to the version they started with. |
| **Playbook Run** | An execution instance against a specific subaccount. Has its own growing context blob. |
| **Step Run** | Execution record for a single step within a run. Has its own status, inputs, outputs, attempt number, and (optionally) a linked `agentRun`. |
| **Run Context** | A single growing JSON blob keyed by step id. Steps reference prior outputs via templating (`{{ steps.event_basics.output.eventName }}`). |
| **Side-effect type** | Required classification on every step (`none` / `idempotent` / `reversible` / `irreversible`) that drives mid-run editing safety. |
| **Tick** | A single execution cycle of `playbookEngineService.tick(runId)`. Idempotent. Triggered by step completions, watchdog sweeps, and start-of-run. |
| **Firewall pattern** | Output-hash check during invalidation: if a re-executed step produces a byte-identical result to the previous attempt, downstream invalidation stops propagating. |

### 1.2 Goals

- Execute multi-step processes reliably, resumably, and in parallel where dependencies allow.
- Reuse the existing three-tier agent system, skill executor, review queue, pg-boss, budget, cost breaker, failure helper, and WebSocket infrastructure unchanged.
- Allow templates to be authored as code (AI-friendly) and distributed via the three-tier system → org → subaccount-run model.
- Support human-in-the-loop edits to step outputs mid-run, with automatic invalidation of downstream work and explicit safety gates around side effects.
- Surface real-time progress and per-step state to the UI without polling.
- Self-heal from missed ticks and stuck runs without operator intervention.

### 1.3 Non-goals (Phase 1)

- Visual canvas builder for org users (Phase 2).
- Marketplace / template sharing across orgs (future).
- Cross-playbook composition (a step that triggers another playbook). Defer to Phase 2+.
- Time-based step scheduling ("run step 5 at 9am Monday"). Defer.
- Loop / iteration steps (`for each item in list, run subgraph`). Defer.
- Per-org parameterization layer (`paramsSchema`) — column reserved in 0074, behaviour ships in Phase 1.5.

### 1.4 Out-of-scope rejected alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Adopt Temporal / Inngest / Trigger.dev | Operational complexity disproportionate to current scale. The pg-boss tick pattern with the §5 hardening layers covers ~10k concurrent runs — years of headroom. Revisit when 3+ adopt-threshold criteria are met. |
| Replace Zod with TypeBox for output schemas | Real benefit (no JSON Schema conversion drift) does not justify introducing a second schema library. Zod is the codebase standard. Mitigated by the §11 round-trip CI check. |
| Handlebars / arbitrary expression engine | Multiple historical RCEs via prototype pollution; compiles templates to JavaScript functions, incompatible with the security model. Disqualified. |
| DB-native template authoring (no file system) | Loses git history, CI validation, environment reproducibility. Mirrors the well-known HubSpot workflow versioning pain point. |

## 1.5 Shared infrastructure reuse (mandatory)

The Playbooks engine **must** reuse the following primitives from `server/lib/` and `shared/iee/`. Bypassing them is a blocking issue in code review; several are enforced by lint rules.

| Primitive | Where Playbooks uses it |
|-----------|------------------------|
| `withBackoff` (`server/lib/withBackoff.ts`) | All engine-level retries: schema parse retries, transient agent run errors, watchdog re-enqueue attempts, external webhook fan-out. Ad-hoc `setTimeout(... Math.pow(2,...))` is banned. |
| `runCostBreaker` (`server/lib/runCostBreaker.ts`) | Called before every `agent_call` and `prompt` step dispatch and before each external skill call invoked from a step. Prevents runaway invalidation loops from blowing the per-run cost ceiling. The dry-run cost preview surfaced to the user during mid-run editing reads the same `subaccount_agents.maxCostPerRunCents` ceiling. |
| `failure()` (`shared/iee/failure.ts`) | Single emit point for every failure persisted to `playbook_runs.error` or `playbook_step_runs.error`. Inline `{ failureReason: ... }` literals are banned. New failure reasons added to `FailureReason` enum (e.g. `playbook_dag_invalid`, `playbook_irreversible_blocked`, `playbook_template_drift`). |
| `skillVisibility` (`server/lib/skillVisibility.ts`) | Step output visibility honours the same `contentsVisible` semantics when surfacing skill results inside a step's output payload. |
| `canonicaliseUrl` (`server/lib/canonicaliseUrl.ts`) | Any URL stored in step outputs (e.g. landing page URLs from a generation step) is canonicalised before storage so deduplication and idempotency keys behave consistently. |
| `inlineTextWriter` (`server/lib/inlineTextWriter.ts`) | When a step produces a long-form text artefact (a generated email body, a landing page draft), the engine writes it via the inline text writer for consistency with other run-scoped artefacts. |
| Existing `agentRunService` | `prompt` and `agent_call` steps create real agent runs with `playbookStepRunId` set. Full three-tier model, handoff depth, idempotency keys, budget reservations, policy engine — all reused unchanged. |
| Existing `reviewItems` / `hitlService` | `approval` step type creates a `reviewItem`. The HITL flow is unchanged. `playbook_step_reviews` records the linkage. |
| Existing `correlation.ts` middleware | Every tick log line carries the run-level correlation id. Watchdog ticks generate their own correlation ids tagged `playbook-watchdog`. |
| Existing pg-boss queue infrastructure | `playbook-run-tick` and `playbook-watchdog` are new queues alongside `agent-handoff-run` and the heartbeat queues. |
| Existing WebSocket rooms (`useSocket`) | New `playbook-run:{runId}` room for per-run live updates; subaccount room receives coarse status events. |
| Existing audit events (`auditEvents`) | Run start, cancellation, mid-run edits, approval decisions, template publish all emit audit events. |

## 2. Database Schema (Migration 0074)

All tables follow existing conventions: `id` (uuid pk, default `gen_random_uuid()`), `createdAt`, `updatedAt`, `deletedAt` (where soft-deletes apply), `organisationId` for org-scoping. Drizzle schema files live under `server/db/schema/` — one file per table group.

### 2.0 Migration safety

- New tables only — zero changes to existing schema rows.
- One additive column on `agent_runs`: `playbook_step_run_id uuid null`. Indexed for the engine's reverse lookup on agent run completion. No backfill required.
- One additive column on `subaccount_agents` is **not** required — the cost breaker reads `maxCostPerRunCents` which already exists.
- The migration is reversible via a corresponding `0074_playbooks.down.sql` that drops all new tables and the new column. Down migrations are not run in production but exist for local rollback.

### 2.0.1 Drizzle schema layout

```
server/db/schema/
├── playbookTemplates.ts            # systemPlaybookTemplates, playbookTemplates, *Versions
├── playbookRuns.ts                 # playbookRuns, playbookStepRuns, playbookStepReviews
└── agentRuns.ts                    # add playbookStepRunId column
```

### 2.1 `system_playbook_templates`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `slug` | text unique | Stable identifier — matches filename |
| `name` | text | |
| `description` | text | |
| `latest_version` | int | Highest published version number |
| `created_at`, `updated_at`, `deleted_at` | timestamps | |

### 2.2 `system_playbook_template_versions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `system_template_id` | fk → system_playbook_templates | |
| `version` | int | Unique with `system_template_id` |
| `definition_json` | jsonb | Full PlaybookDefinition (see §3) |
| `published_at` | timestamp | |

Immutable. Seeder creates a new row when a definition file's version number changes.

### 2.3 `playbook_templates`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `organisation_id` | uuid fk | Org-scoped |
| `slug` | text | Unique within org |
| `name`, `description` | text | |
| `forked_from_system_id` | uuid fk nullable | Set if forked from a system template |
| `forked_from_version` | int nullable | The system version that was forked |
| `latest_version` | int | |
| `created_by_user_id` | uuid fk | |
| `params_json` | jsonb default `'{}'` | Phase 1.5 — org-level parameter values for parameterized templates. Empty object in Phase 1. |
| `created_at`, `updated_at`, `deleted_at` | timestamps | |

> **Phase 1.5 — Parameterization layer.** Pure forking scales badly when an org has many forks of system templates that drift from upstream. Phase 1.5 adds a parameterization model: system templates declare a `paramsSchema` (typed config surface — channels, thresholds, prompt variants, feature toggles), and orgs supply a `params_json` value object instead of forking. Parameterized orgs auto-upgrade when the platform ships a new template version because their config carries forward unchanged. Forking is reserved as an escape hatch for the ~5% of orgs that need structural changes. Phase 1 ships the column empty so the data path exists; the layered distribution model (parameterize → inherit/override → fork) is implemented in 1.5 before fork count gets large.

### 2.4 `playbook_template_versions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `template_id` | fk → playbook_templates | |
| `version` | int | Unique with `template_id` |
| `definition_json` | jsonb | |
| `published_at` | timestamp | |
| `published_by_user_id` | uuid fk | |

Immutable once published. New edits create a new version row.

### 2.5 `playbook_runs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `organisation_id` | uuid fk | Denormalised for query speed |
| `subaccount_id` | uuid fk | |
| `template_version_id` | fk → playbook_template_versions | Locks run to a specific version |
| `status` | enum | `pending`, `running`, `awaiting_input`, `awaiting_approval`, `completed`, `failed`, `cancelled` |
| `context_json` | jsonb | Growing run context (initial input + step outputs keyed by step id) |
| `started_by_user_id` | uuid fk | |
| `started_at` | timestamp | |
| `completed_at` | timestamp nullable | |
| `error` | text nullable | |
| `created_at`, `updated_at` | timestamps | |

Append-only — no soft delete. Cancelled runs stay for audit.

### 2.6 `playbook_step_runs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `run_id` | fk → playbook_runs | |
| `step_id` | text | Stable id from the definition |
| `step_type` | enum | `prompt`, `agent_call`, `user_input`, `approval`, `conditional` |
| `status` | enum | `pending`, `running`, `awaiting_input`, `awaiting_approval`, `completed`, `failed`, `skipped`, `invalidated` |
| `depends_on` | text[] | Snapshot from definition for query convenience |
| `input_json` | jsonb nullable | Resolved inputs (post-templating) |
| `output_json` | jsonb nullable | Validated against step's outputSchema |
| `output_hash` | text nullable | SHA256 of canonical JSON output; powers the firewall pattern in invalidation |
| `version` | int default 0 | Optimistic concurrency guard for state transitions |
| `side_effect_type` | enum | Snapshot from definition: `none`, `idempotent`, `reversible`, `irreversible` |
| `agent_run_id` | uuid fk nullable | Links to `agentRuns` for `agent_call` and `prompt` types |
| `attempt` | int default 1 | For idempotency keying on retry |
| `started_at`, `completed_at` | timestamps nullable | |
| `error` | text nullable | |

Unique index on `(run_id, step_id, attempt)`.

### 2.7 `playbook_step_reviews`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `step_run_id` | fk → playbook_step_runs | |
| `review_item_id` | fk → reviewItems | |
| `decision` | enum | `pending`, `approved`, `rejected`, `edited` |
| `decided_by_user_id` | uuid fk nullable | |
| `decided_at` | timestamp nullable | |

### 2.8 Indexes

- `playbook_runs (subaccount_id, status)` — list active runs per subaccount
- `playbook_runs (organisation_id, status)` — org dashboard
- `playbook_step_runs (run_id, status)` — engine tick query
- `playbook_step_runs (agent_run_id)` — webhook lookup from agent run completion
- `playbook_template_versions (template_id, version)` unique
- `system_playbook_template_versions (system_template_id, version)` unique
- `playbook_step_runs (run_id, step_id) where status not in ('invalidated','failed')` partial unique — only one live attempt per (run, step)
- `agent_runs (playbook_step_run_id) where playbook_step_run_id is not null` — engine reverse lookup on agent completion

### 2.9 Foreign key & integrity rules

- `playbook_runs.template_version_id` → `playbook_template_versions.id` ON DELETE RESTRICT. Versions can never be deleted while runs reference them.
- `playbook_step_runs.run_id` → `playbook_runs.id` ON DELETE CASCADE. Cancelled runs in test environments can be cleaned up; production never deletes runs.
- `playbook_step_runs.agent_run_id` → `agent_runs.id` ON DELETE RESTRICT. Agent runs that belong to a playbook step are co-immutable.
- `playbook_step_reviews.review_item_id` → `review_items.id` ON DELETE RESTRICT.
- `playbook_templates.forked_from_system_id` → `system_playbook_templates.id` ON DELETE SET NULL. System template deletion deprecates rather than deletes; the FK preserves history if a hard delete ever happens.

### 2.10 Status enums (Postgres)

```sql
CREATE TYPE playbook_run_status AS ENUM (
  'pending', 'running', 'awaiting_input', 'awaiting_approval',
  'completed', 'failed', 'cancelling', 'cancelled'
);

CREATE TYPE playbook_step_run_status AS ENUM (
  'pending', 'running', 'awaiting_input', 'awaiting_approval',
  'completed', 'failed', 'skipped', 'invalidated'
);

CREATE TYPE playbook_step_type AS ENUM (
  'prompt', 'agent_call', 'user_input', 'approval', 'conditional'
);

CREATE TYPE playbook_side_effect_type AS ENUM (
  'none', 'idempotent', 'reversible', 'irreversible'
);

CREATE TYPE playbook_step_review_decision AS ENUM (
  'pending', 'approved', 'rejected', 'edited'
);
```

### 2.11 Row-level security

System templates have no `organisation_id` and are visible to all orgs (read-only via API). Org templates and runs are scoped via `organisation_id`. Phase 1 enforces this via service-layer `req.orgId` filtering — no Postgres RLS policies. **Phase 1.5 adds RLS policies as a defense-in-depth layer** when parameterization lands, since that increases cross-org template touchpoints. The RLS plan:

```sql
-- Phase 1.5
ALTER TABLE playbook_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON playbook_templates
  USING (organisation_id = current_setting('app.org_id', true)::uuid);
```

The `app.org_id` GUC is set per-request by the existing auth middleware (a separate change in 1.5).

## 3. Definition Format

Templates are authored as TypeScript files in `server/playbooks/*.playbook.ts` and exported via `definePlaybook()` for type safety. The seeder serialises each definition to JSON for storage in `definition_json`.

### 3.1 TypeScript types

```typescript
// server/lib/playbook/types.ts
import { z, ZodSchema } from 'zod';

export type StepType =
  | 'prompt'
  | 'agent_call'
  | 'user_input'
  | 'approval'
  | 'conditional';

export interface AgentRef {
  kind: 'system' | 'org';
  slug: string;  // resolved at run start to a concrete agentId
}

export type SideEffectType =
  | 'none'         // pure computation, LLM calls — safe to re-run freely
  | 'idempotent'   // upserts, file writes with idempotency keys — safe to re-run
  | 'reversible'   // sent emails, posted comments — re-run requires user confirmation
  | 'irreversible';// charges, external API calls without idempotency — DEFAULT-BLOCK re-run

export interface PlaybookStep {
  id: string;                       // stable, unique within definition, kebab_case
  name: string;                     // user-facing label
  description?: string;
  type: StepType;
  dependsOn: string[];              // ids of prior steps; empty for entry steps
  humanReviewRequired?: boolean;    // pause after completion until user approves/edits
  sideEffectType: SideEffectType;   // REQUIRED — drives invalidation safety on mid-run editing

  // type: prompt
  prompt?: string;                  // template string with {{ expressions }}
  model?: string;                   // optional model override

  // type: agent_call
  agentRef?: AgentRef;
  agentInputs?: Record<string, string>;  // map of paramName -> template expression

  // type: user_input
  formSchema?: ZodSchema;           // serialised to JSON Schema
  formDescription?: string;

  // type: approval
  approvalPrompt?: string;          // shown to reviewer
  approvalSchema?: ZodSchema;       // optional structured approval data

  // type: conditional
  condition?: string;               // JSONLogic expression evaluated against run context
  trueOutput?: unknown;             // value written to context.steps[id].output if true
  falseOutput?: unknown;            // value written if false

  outputSchema: ZodSchema;          // ALL step types must declare expected output shape
}

export interface PlaybookDefinition {
  slug: string;                     // matches filename, e.g. 'event-creation'
  name: string;
  description: string;
  version: number;                  // bump on every published edit
  initialInputSchema: ZodSchema;    // what user provides at run start
  paramsSchema?: ZodSchema;         // Phase 1.5 — declared but unused in Phase 1
  steps: PlaybookStep[];
}
```

### 3.2 `definePlaybook()` helper

```typescript
// server/lib/playbook/definePlaybook.ts
export function definePlaybook(def: PlaybookDefinition): PlaybookDefinition {
  // identity function for type inference; validation runs in seeder
  return def;
}
```

### 3.3 Templating expressions

Expressions are wrapped in `{{ }}` and resolved against a context object at the moment a step is dispatched. Resolver is a pure function in `playbookTemplatingService`.

Available namespaces:

| Namespace | Source | Example |
|-----------|--------|---------|
| `run.input.*` | Initial input provided at run start | `{{ run.input.eventName }}` |
| `run.subaccount.*` | Subaccount metadata (id, name, timezone) | `{{ run.subaccount.name }}` |
| `run.org.*` | Org metadata | `{{ run.org.name }}` |
| `steps.<id>.output.*` | Output of a completed step | `{{ steps.positioning.output.tagline }}` |

Resolver rules:

- Path access only — no arbitrary code execution. Hand-rolled dot-path interpreter (~100–200 LOC + 500+ LOC of tests).
- **Prototype pollution hardening (mandatory):**
  - Build the context object with `Object.create(null)` so it has no prototype chain.
  - Blocklist these path segments outright: `__proto__`, `constructor`, `prototype`. Reject the expression at validation time, not runtime.
  - Whitelist allowed top-level prefixes: `run.input.`, `run.subaccount.`, `run.org.`, `steps.`. Anything else fails validation.
  - Use `Object.hasOwn()` before each traversal step — never bare `in` or `obj[key]`.
- Missing path → throw `TemplatingError` with the missing path. Engine marks the step `failed` with a clear error.
- Null-safe traversal: missing intermediate paths return `undefined`, surfaced as a `TemplatingError`, never silently `null`.
- Array index access supported: `steps.research.output.findings[0].title`.
- Type coercion: values render as JSON.stringify for objects, raw string for primitives.
- All template expressions in a step's `prompt`, `agentInputs`, and `condition` must reference only steps listed in `dependsOn` (no transitive deps). Validator enforces this.

> **Future (Phase 1.5+):** add **JSONata** as an optional power-user expression engine for transforms the dot-path resolver can't handle (filtering, aggregation, conditional expressions). Use a `{{= ... }}` prefix to distinguish JSONata expressions from simple path references. JSONata parses to an AST (enabling static dependency extraction) and runs sandboxed with no access to Node globals. **Handlebars is explicitly disqualified** — it has had multiple RCEs via prototype pollution and compiles templates to JavaScript functions, incompatible with our security model.

### 3.4 Agent reference resolution

`agent_call` steps reference an agent via `{ kind: 'system' | 'org', slug: string }`. Resolution happens at **run start**, not at definition time, so agents added or renamed after a template is published are picked up automatically.

Resolution order:

1. If `kind === 'system'`: look up `system_agents.slug = agentRef.slug`. The org's `subaccount_agents` linking record is used if one exists; otherwise the system agent is invoked directly under the org context.
2. If `kind === 'org'`: look up `agents.slug = agentRef.slug AND organisation_id = run.organisation_id`. Must exist; otherwise the run fails to start with `failure('agent_not_found', 'org_agent_missing', { slug })`.
3. The resolved `agent_id` is **cached on the playbook run row** (not the template) so mid-run changes to agent slugs don't break in-flight runs.

Resolved agent ids are stored in `playbook_runs.context_json` under `_meta.resolvedAgents` for traceability.

### 3.5 Output schema enforcement

Every step declares an `outputSchema` (Zod). On step completion:

1. Engine receives raw output (LLM response, form submission, conditional result).
2. For LLM-based outputs (`prompt`, `agent_call`), the resolved prompt instructs the model to return JSON matching the schema. The schema is also passed to the model as a tool / structured-output spec where the provider supports it (Anthropic tool use, OpenAI structured outputs).
3. Engine parses output through `outputSchema.safeParse()`. On failure, retry via `withBackoff` up to N times (configurable per step, default 2) with the parse error appended to the prompt context. After max retries, the step is marked `failed` via `failure('schema_violation', 'output_parse_failed', { stepId, attempts, lastError })`.
4. On success, the validated output is canonicalised (key sort + JSON.stringify), hashed (SHA256 → `output_hash`), and merged into `run.context_json` at `steps.<id>.output`.

### 3.6 Worked example: a real 15-step playbook (abridged to 6 for readability)

```typescript
// server/playbooks/event-creation.playbook.ts
import { definePlaybook } from '../lib/playbook/definePlaybook.js';
import { z } from 'zod';

export default definePlaybook({
  slug: 'event-creation',
  name: 'Create a New Event',
  description: 'End-to-end content pack for launching a new event',
  version: 1,

  initialInputSchema: z.object({
    eventName: z.string().min(3),
    eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    audience: z.string(),
  }),

  steps: [
    // 1 — gather extra basics (human form)
    {
      id: 'event_basics',
      name: 'Confirm event basics',
      type: 'user_input',
      dependsOn: [],
      sideEffectType: 'none',
      formSchema: z.object({
        venue: z.string(),
        capacity: z.number().int().positive(),
        ticketPriceCents: z.number().int().nonnegative(),
      }),
      outputSchema: z.object({
        venue: z.string(),
        capacity: z.number(),
        ticketPriceCents: z.number(),
      }),
    },

    // 2 — positioning statement (single LLM call)
    {
      id: 'positioning',
      name: 'Draft positioning statement',
      type: 'agent_call',
      dependsOn: ['event_basics'],
      sideEffectType: 'none',
      agentRef: { kind: 'system', slug: 'copywriter' },
      agentInputs: {
        eventName: '{{ run.input.eventName }}',
        venue: '{{ steps.event_basics.output.venue }}',
        audience: '{{ run.input.audience }}',
      },
      prompt: 'Draft a one-paragraph positioning statement for {{ run.input.eventName }} at {{ steps.event_basics.output.venue }} for {{ run.input.audience }}.',
      humanReviewRequired: true,
      outputSchema: z.object({
        positioning: z.string(),
        tagline: z.string(),
      }),
    },

    // 3 — landing page hero (parallel with email)
    {
      id: 'landing_page_hero',
      name: 'Landing page hero copy',
      type: 'agent_call',
      dependsOn: ['positioning'],
      sideEffectType: 'none',
      agentRef: { kind: 'system', slug: 'copywriter' },
      agentInputs: { tagline: '{{ steps.positioning.output.tagline }}' },
      prompt: 'Write a hero section for the landing page using the tagline: {{ steps.positioning.output.tagline }}',
      outputSchema: z.object({
        headline: z.string(),
        subheadline: z.string(),
        ctaText: z.string(),
      }),
    },

    // 4 — announcement email (parallel with hero — both only need positioning)
    {
      id: 'email_announcement',
      name: 'Announcement email',
      type: 'agent_call',
      dependsOn: ['positioning'],
      sideEffectType: 'none',
      agentRef: { kind: 'system', slug: 'copywriter' },
      agentInputs: { positioning: '{{ steps.positioning.output.positioning }}' },
      prompt: 'Write an announcement email...',
      outputSchema: z.object({
        subject: z.string(),
        body: z.string(),
      }),
    },

    // 5 — approval gate before any content is published
    {
      id: 'content_review',
      name: 'Marketing review',
      type: 'approval',
      dependsOn: ['landing_page_hero', 'email_announcement'],
      sideEffectType: 'none',
      approvalPrompt: 'Review the landing page hero and announcement email below. Approve to proceed to publishing.',
      outputSchema: z.object({ approvedAt: z.string() }),
    },

    // 6 — actually publish (THIS IS WHY sideEffectType MATTERS)
    {
      id: 'publish_landing_page',
      name: 'Publish landing page to CMS',
      type: 'agent_call',
      dependsOn: ['content_review'],
      sideEffectType: 'irreversible',
      agentRef: { kind: 'org', slug: 'cms_publisher' },
      agentInputs: {
        headline: '{{ steps.landing_page_hero.output.headline }}',
        subheadline: '{{ steps.landing_page_hero.output.subheadline }}',
        ctaText: '{{ steps.landing_page_hero.output.ctaText }}',
      },
      prompt: 'Publish a new landing page with this content.',
      outputSchema: z.object({
        pageId: z.string(),
        url: z.string().url(),
      }),
    },
  ],
});
```

Three things to notice in this example:

1. **Steps 3 and 4 run in parallel** because they both depend only on `positioning`. The engine dispatches them simultaneously.
2. **Step 2 has `humanReviewRequired`** — after the agent generates positioning, the user can edit it before downstream steps consume it. This is the "tweak the AI output before next step" loop.
3. **Step 6 is `irreversible`** — publishing to a CMS cannot be undone. If a user later edits step 2 (positioning), the engine will compute that step 6 is downstream and **block automatic re-execution**, returning a 409 with the affected list and a dry-run cost. The user must explicitly opt in or choose "skip and reuse the existing published page".

## 4. DAG Validator

Lives in `playbookTemplateService.validateDefinition()`. Runs on:

- Seeder load (system templates)
- Org template publish
- Pre-run sanity check (cheap; catches schema drift)

### 4.1 Validation rules

1. **Unique step ids.** No two steps share an `id`.
2. **kebab_case ids.** Regex `^[a-z][a-z0-9_]*$`.
3. **All `dependsOn` resolve.** Every id in `dependsOn` exists in the steps array.
4. **No cycles.** Run Kahn's algorithm; if any node remains unvisited, fail with the cycle path.
5. **Topological reachability.** Every step must be reachable from at least one entry step (a step with empty `dependsOn`). Orphan steps fail validation.
6. **At least one entry step.** `steps.some(s => s.dependsOn.length === 0)`.
7. **Template expression references.** Parse every `{{ ... }}` in `prompt`, `agentInputs`, `condition`. Each `steps.<id>.output.<path>` reference must:
   - Reference an `id` listed in this step's `dependsOn` (transitive deps not allowed — must be explicit).
   - Reference a path that exists in the referenced step's `outputSchema`.
8. **Type-specific required fields.** A `prompt` step needs `prompt`. An `agent_call` step needs `agentRef`. A `user_input` step needs `formSchema`. Etc.
9. **Output schema present.** All steps declare `outputSchema`.
10. **Agent refs resolvable.** For `agent_call` steps, the referenced agent slug exists at validation time (warning, not error, since system agents may be added later).
11. **Version monotonic.** On publish, new version > existing latest version.

### 4.2 Validator output

Returns either `{ ok: true }` or `{ ok: false, errors: ValidationError[] }` where each error includes step id, rule violated, and human-readable message. UI surfaces these inline in the (Phase 2) builder; seeder fails the deploy with clear logs.

```typescript
export interface ValidationError {
  rule: 'unique_id' | 'kebab_case' | 'unresolved_dep' | 'cycle' | 'orphan'
      | 'missing_entry' | 'unresolved_template_ref' | 'transitive_dep'
      | 'missing_field' | 'missing_output_schema' | 'agent_not_found'
      | 'missing_side_effect_type' | 'version_not_monotonic';
  stepId?: string;
  path?: string;       // for cycle: comma-joined cycle path
  message: string;
}
```

### 4.3 Cycle detection (Kahn's algorithm)

```
function detectCycles(steps):
  inDegree = map step.id -> count of incoming edges
  queue = [s for s in steps if inDegree[s.id] == 0]
  visited = []
  while queue not empty:
    s = queue.pop()
    visited.push(s)
    for child where child.dependsOn includes s.id:
      inDegree[child.id]--
      if inDegree[child.id] == 0:
        queue.push(child)
  if len(visited) < len(steps):
    cycle = findCyclePath(steps - visited)  // DFS from any unvisited node
    return ValidationError('cycle', path: cycle.join(' -> '))
  return ok
```

### 4.4 Template reference checking

For every step, parse all `{{ ... }}` expressions in `prompt`, `agentInputs.*`, and `condition`. For each reference:

- `run.input.<path>` → assert `<path>` resolves against `definition.initialInputSchema`
- `run.subaccount.<path>` → assert `<path>` is in the allowed subaccount field set (`id`, `name`, `timezone`, `slug`)
- `run.org.<path>` → assert `<path>` is in the allowed org field set (`id`, `name`)
- `steps.<id>.output.<path>`:
  - assert `<id>` is listed in this step's `dependsOn` (no transitive — must be explicit)
  - assert `<id>` exists in the steps array
  - assert `<path>` resolves against the referenced step's `outputSchema`

Path resolution against Zod schemas uses a small introspection helper that walks `ZodObject.shape`. Unsupported paths through `ZodUnion` / `ZodDiscriminatedUnion` produce a warning, not an error (Phase 1 keeps strict mode for `ZodObject` only; complex refinements graduate in 1.5).

### 4.5 When the validator runs

| Trigger | Failure mode |
|---------|--------------|
| Seeder load (system templates) | Build fails. CI gates the deploy. |
| Org template publish | API returns 422 with the full error list. |
| Run start | Engine refuses to start the run; returns 422 with detail. (Catches schema drift between publish and start — rare but possible if shared types change.) |
| Pre-commit hook (optional) | `npm run playbooks:validate` runs the validator against every file in `server/playbooks/*` and fails the commit on errors. Recommended but not enforced. |

## 5. Execution Engine

`playbookEngineService` is a state machine driven by pg-boss jobs on the `playbook-run-tick` queue. The engine is **stateless between ticks** — all state lives in the DB. A tick is the unit of progress: each completed step (or human action) enqueues exactly one tick, the tick handler determines what's runnable, dispatches it, and exits.

### 5.0 Start-of-run flow

`playbookRunService.startRun(orgId, subaccountId, templateId, initialInput, userId)`:

1. Resolve org template → latest published version. If none, return 422.
2. Validate `initialInput` against `definition.initialInputSchema`. Return 422 with field errors on failure.
3. Re-run §4 validator against the locked version (catches schema drift since publish).
4. Resolve every `agentRef` (§3.4). Cache resolved agent ids in `_meta.resolvedAgents`.
5. Pre-flight cost check: call `runCostBreaker` with the run's projected ceiling. If the org has no budget headroom at all, fail fast.
6. Insert `playbook_runs` row with `status='pending'`, `context_json={ input: initialInput, _meta: { ... } }`.
7. Insert `playbook_step_runs` rows for **all entry steps** (those with empty `dependsOn`) with `status='pending'`, `attempt=1`.
8. Enqueue first tick via pg-boss with `singletonKey: runId`.
9. Emit `playbook:run:status` WebSocket event.
10. Emit `playbook_run.started` audit event.
11. Return `{ runId, status: 'pending' }` (status will flip to `running` on first tick).

### 5.1 Run lifecycle

```
[start]
  ↓
pending → running ──┬─→ awaiting_input ──→ running
                    ├─→ awaiting_approval ─→ running
                    └─→ completed
                          failed
                          cancelled
```

A run is `running` whenever the engine has work it can dispatch. It transitions to `awaiting_*` when **all** ready steps are blocked on human action. It transitions to `completed` when every step is `completed` or `skipped`, `failed` when any step fails non-recoverably and no alternative path exists, `cancelled` only on explicit user action.

### 5.2 Tick algorithm (pseudocode)

```
function tick(runId):
  run = loadRun(runId)
  if run.status in [completed, failed, cancelled]: return

  stepRuns = loadStepRuns(runId)
  definition = loadDefinition(run.templateVersionId)

  // 1. Identify ready steps
  ready = []
  for step in definition.steps:
    sr = stepRuns.find(s => s.stepId === step.id)
    if sr exists and sr.status !== 'pending': continue
    if step.dependsOn.every(dep => stepRuns.find(s => s.stepId === dep)?.status === 'completed'):
      ready.push(step)

  // 2. Terminal check
  if ready.empty:
    if stepRuns.every(s => s.status in [completed, skipped]):
      markRunCompleted(runId)
    elif stepRuns.any(s => s.status === 'failed') and noAlternatePath(definition, stepRuns):
      markRunFailed(runId)
    elif stepRuns.any(s => s.status in [awaiting_input, awaiting_approval, running]):
      updateRunStatus(runId, computeAggregateStatus(stepRuns))
    return

  // 3. Dispatch ready steps in parallel
  for step in ready:
    sr = upsertStepRun(runId, step.id, status='running', attempt=1)
    try:
      resolvedInputs = templatingService.resolve(step, run.contextJson)
      sr.inputJson = resolvedInputs
      dispatch(step, sr, run)
    catch err:
      markStepRunFailed(sr.id, err)
      enqueueTick(runId)  // re-tick to handle failure

  updateRunStatus(runId, 'running')

function dispatch(step, stepRun, run):
  switch step.type:
    case 'prompt':
    case 'agent_call':
      agentRunId = agentRunService.create({
        agentId: resolveAgent(step, run),
        subaccountId: run.subaccountId,
        idempotencyKey: `playbook:${run.id}:${step.id}:${stepRun.attempt}`,
        prompt: step.prompt,  // pre-resolved
        outputSchema: step.outputSchema,
        playbookStepRunId: stepRun.id,
      })
      stepRun.agentRunId = agentRunId
      // agent run completion fires webhook → onAgentRunCompleted()

    case 'user_input':
      stepRun.status = 'awaiting_input'
      websocket.emit(`playbook-run:${run.id}`, 'step:awaiting_input', stepRun)

    case 'approval':
      reviewItemId = reviewService.create({
        kind: 'playbook_step',
        subaccountId: run.subaccountId,
        payload: { stepRunId: stepRun.id, prompt: step.approvalPrompt }
      })
      insertPlaybookStepReview(stepRun.id, reviewItemId)
      stepRun.status = 'awaiting_approval'
      websocket.emit(`playbook-run:${run.id}`, 'step:awaiting_approval', stepRun)

    case 'conditional':
      result = jsonLogic.evaluate(step.condition, run.contextJson)
      stepRun.outputJson = result ? step.trueOutput : step.falseOutput
      stepRun.status = 'completed'
      mergeContext(run, step.id, stepRun.outputJson)
      enqueueTick(run.id)
```

### 5.3 Step completion handlers

- **`onAgentRunCompleted(agentRunId)`** — webhook fired by agent run service. Looks up `playbook_step_runs.agent_run_id`, validates output against schema, merges to context, marks step `completed` (or `awaiting_approval` if `humanReviewRequired`), enqueues a tick.
- **`onUserInputSubmitted(stepRunId, formData)`** — validates against `formSchema`, writes `outputJson`, marks `completed`, merges context, enqueues tick.
- **`onApprovalDecided(stepRunId, decision, editedOutput?)`** — if approved, mark `completed`. If rejected, mark `failed`. If edited, write the edited output and mark `completed`. Enqueue tick.

### 5.4 Mid-run output editing

`POST /api/playbook-runs/:runId/steps/:stepRunId/output` accepts a new output payload. This is the dirty-flag-propagation pattern from build systems (Make, Bazel, Gradle), with side-effect safety bolted on.

**Pre-edit safety check (must run before invalidation):**

1. Acquire the run-level advisory lock for the duration of the operation.
2. Compute the transitive downstream set via BFS over `dependsOn` edges.
3. Inspect each downstream step's `sideEffectType`:
   - `none` / `idempotent` → safe to re-run automatically.
   - `reversible` → requires user confirmation in the response (returns 409 with the affected list unless `?confirmReversible=true`).
   - `irreversible` → **default-blocked**. Returns 409 with the affected list. User must either (a) explicitly opt in per step via `confirmIrreversible: [stepIds]` OR (b) choose "skip and reuse previous output" per step. Never auto-re-execute.
4. Compute estimated cost (sum of downstream step LLM token estimates) and return a **dry-run preview** in any 409 response: "Editing this step will re-run N steps and cost approximately $X."

**Edit + invalidation:**

1. Validate the new payload against the step's `outputSchema`.
2. **Hash the new output** (canonical JSON → SHA256). If identical to previous output, no-op the entire flow — nothing changed, nothing to invalidate. This is the **firewall pattern** from incremental compilers and prevents cost explosions when an "edit" is actually a save with no changes.
3. Update the step run's `outputJson` and `outputHash`. Status stays `completed`.
4. For each transitively dependent step run:
   - Mark current row `invalidated` (audit; not deleted).
   - Insert a new `pending` row with `attempt = previous + 1`, carrying forward `humanReviewRequired` user responses where present (pre-fill, not restart).
   - Steps marked "skip and reuse" copy their previous output forward to the new attempt with status `completed`.
5. **Cancel any in-flight downstream steps:** for step runs currently in `running` status within the invalidation set, fire an `AbortController` signal to the agent run / job worker. If the step completes before cancellation lands, discard its result (the step run row is already `invalidated`).
6. Re-merge context from scratch using only currently-completed step outputs (the new edited one + all unaffected siblings).
7. Enqueue tick.

**Idempotency keys for re-execution.** All re-runs use `playbook:{runId}:{stepId}:{attempt}` as the key. External APIs called by `idempotent` steps must accept this key to deduplicate at the destination.

**DAG fan-in handling.** If steps A→C and B→C converge at C, and only A is invalidated, the new C step run merges its context from the new A output and the existing valid B output. The context merger always pulls latest valid output per parent.

**Output-hash firewall propagation.** When a re-executed step completes, hash its output. If the hash equals the previous attempt's hash, **stop propagating invalidation** to its downstream — the change didn't actually affect this branch. This can prevent re-running entire subtrees when an edit produces deterministic output.

The `invalidated` rows stay in the DB for audit — they're never deleted.

### 5.5 Idempotency and retries

- pg-boss tick jobs are idempotent — running `tick(runId)` twice is a no-op if no state changed.
- Step-level agent runs use idempotency key `playbook:{runId}:{stepId}:{attempt}`. Retry increments `attempt`.
- Engine retries transient errors (network, rate limits) up to 3 times with exponential backoff. Permanent errors (schema mismatch after max parse retries) fail immediately.
- TripWire errors from skill executors propagate up — engine retries the step.

### 5.6 Concurrency control (defense in depth)

Three layers, all required:

**Layer 1 — Queue deduplication (cheapest, runs first).** All tick jobs are enqueued with:

```typescript
boss.send('playbook-run-tick', { runId }, {
  singletonKey: runId,
  useSingletonQueue: true,
  retryLimit: 3,
  retryBackoff: true,
  expireInSeconds: 120,
});
```

`singletonKey` + `useSingletonQueue` causes pg-boss to enforce a unique partial index on `(name, singletonKey)` filtered to non-terminal states. Ten parallel step completions firing ten ticks collapse into **one** tick job in the queue — no advisory-lock contention, no redundant work.

**Layer 2 — Non-blocking advisory lock (inside the tick handler).** Use `pg_try_advisory_xact_lock`, not the blocking variant:

```sql
SELECT pg_try_advisory_xact_lock(hashtext('playbook-run:' || $1)::bigint)
```

If the lock isn't acquired, the handler **exits silently** — another tick is already evaluating this run and our work would be redundant. Blocking would queue handlers and exhaust the connection pool under load. The UUID `runId` is hashed via `hashtext()` to fit pg's bigint parameter; collision risk is vanishingly small and would only cause brief unrelated-run serialization, never a correctness issue.

**Layer 3 — Optimistic state guards on step transitions.** When transitioning a step run from `pending` to `running`:

```sql
UPDATE playbook_step_runs SET status='running', version = version+1
WHERE id = $1 AND status = 'pending' AND version = $expected
```

Affected-row check catches the extremely unlikely case where two handlers both pass the advisory lock and try to launch the same step. Adds a `version` int column to `playbook_step_runs`.

### 5.7 Watchdog sweep (self-healing)

Pg-boss cron job `playbook-watchdog`, runs every 60 seconds:

```
SELECT runs where status in (running, awaiting_input, awaiting_approval)
For each run:
  - If has step runs whose deps are all completed but status is pending,
    AND no playbook-run-tick singleton job exists for this runId,
    enqueue a tick.
  - If has step runs in 'running' state older than step.timeoutSeconds (default 30 min),
    mark them failed and enqueue a tick.
```

Catches the "step completed but tick enqueue failed mid-transaction" race and any other class of missed-tick bug. **Step completion + tick enqueue must happen in the same DB transaction** as the primary defense; the watchdog is the safety net.

### 5.8 Step timeouts and poison messages

- Each step type has a default `expireInSeconds` (prompt: 5min, agent_call: 30min, user_input: indefinite, approval: indefinite, conditional: 5sec).
- Per-step override allowed in definition: `timeoutSeconds`.
- pg-boss expired jobs surface to a poison handler that marks the step `failed` and re-ticks the run for failure-policy evaluation.
- `retryLimit` per step type with exponential backoff at the queue level; engine-level retries (output schema parse failures) are tracked via the `attempt` column.

### 5.7 Budget and policy integration

- `agent_call` and `prompt` steps go through the existing agent run path → budget reservations apply automatically.
- Run start can optionally pre-reserve a budget envelope based on summed step estimates (future enhancement).
- Policy engine evaluated per agent run as today — no engine-level bypass.

## 6. Services

All services follow existing conventions: throw `{ statusCode, message, errorCode }`, no direct route access to `db`, org-scoped via `req.orgId`.

### 6.1 `playbookTemplateService`

```typescript
listSystemTemplates(): Promise<SystemTemplate[]>
getSystemTemplate(slug): Promise<SystemTemplate & { latestVersion: PlaybookDefinition }>

listOrgTemplates(orgId): Promise<OrgTemplate[]>
getOrgTemplate(orgId, id): Promise<OrgTemplate & { latestVersion: PlaybookDefinition }>
forkSystemTemplate(orgId, systemTemplateId, userId): Promise<OrgTemplate>
publishOrgTemplate(orgId, templateId, definition, userId): Promise<TemplateVersion>
deleteOrgTemplate(orgId, templateId): Promise<void>

upsertSystemTemplate(definition: PlaybookDefinition): Promise<void>  // seeder entrypoint
validateDefinition(def: PlaybookDefinition): ValidationResult
```

### 6.2 `playbookRunService`

```typescript
startRun(orgId, subaccountId, templateId, initialInput, userId): Promise<PlaybookRun>
getRun(orgId, runId): Promise<RunWithSteps>
listRunsForSubaccount(orgId, subaccountId, filter): Promise<PlaybookRun[]>
cancelRun(orgId, runId, userId): Promise<void>
submitStepInput(orgId, runId, stepRunId, formData, userId): Promise<void>
editStepOutput(orgId, runId, stepRunId, newOutput, userId): Promise<void>
decideApproval(orgId, runId, stepRunId, decision, editedOutput?, userId): Promise<void>
```

### 6.3 `playbookEngineService`

```typescript
tick(runId): Promise<void>                    // pg-boss handler
onAgentRunCompleted(agentRunId): Promise<void>  // hook from agentRunService
enqueueTick(runId): Promise<void>
```

### 6.4 `playbookTemplatingService`

Pure functions, fully unit-tested.

```typescript
resolve(expression: string, context: RunContext): unknown
resolveStep(step: PlaybookStep, context: RunContext): ResolvedStep
extractReferences(expression: string): TemplateReference[]
```

## 7. Routes

All routes use `asyncHandler`, `authenticate`, `resolveSubaccount` where applicable. Files target ~200 lines max.

### 7.1 System templates — `routes/systemPlaybookTemplates.ts`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/system/playbook-templates` | system_admin | List system templates |
| GET | `/api/system/playbook-templates/:slug` | system_admin | Get latest version |
| GET | `/api/system/playbook-templates/:slug/versions` | system_admin | Version history |

System templates are read-only via API. Authoring is file-based (see §9).

### 7.2 Org templates — `routes/playbookTemplates.ts`

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/api/playbook-templates` | `playbook_templates.read` | List org templates |
| GET | `/api/playbook-templates/:id` | `playbook_templates.read` | Get template + latest version |
| GET | `/api/playbook-templates/:id/versions` | `playbook_templates.read` | List versions |
| POST | `/api/playbook-templates/fork-system` | `playbook_templates.write` | Fork a system template |
| POST | `/api/playbook-templates/:id/publish` | `playbook_templates.publish` | Publish a new version |
| DELETE | `/api/playbook-templates/:id` | `playbook_templates.write` | Soft delete |

### 7.3 Runs — `routes/playbookRuns.ts`

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/api/subaccounts/:subaccountId/playbook-runs` | `playbook_runs.read` | List runs |
| POST | `/api/subaccounts/:subaccountId/playbook-runs` | `playbook_runs.start` | Start a run |
| GET | `/api/playbook-runs/:runId` | `playbook_runs.read` | Run detail with step runs |
| POST | `/api/playbook-runs/:runId/cancel` | `playbook_runs.cancel` | Cancel run |
| POST | `/api/playbook-runs/:runId/steps/:stepRunId/input` | `playbook_runs.start` | Submit user_input form |
| POST | `/api/playbook-runs/:runId/steps/:stepRunId/output` | `playbook_runs.edit_output` | Edit completed step output |
| POST | `/api/playbook-runs/:runId/steps/:stepRunId/approve` | `playbook_runs.approve` | Approval decision |

### 7.4 Request/response shapes (key endpoints)

**`POST /api/subaccounts/:subaccountId/playbook-runs`**

```jsonc
// request
{ "templateId": "uuid", "input": { /* matches initialInputSchema */ } }
// response 201
{ "runId": "uuid", "status": "running" }
```

**`GET /api/playbook-runs/:runId`**

```jsonc
{
  "id": "uuid",
  "status": "running",
  "templateId": "uuid",
  "templateName": "Create a New Event",
  "templateVersion": 3,
  "subaccountId": "uuid",
  "context": { /* full run context */ },
  "steps": [
    {
      "id": "uuid",
      "stepId": "event_basics",
      "name": "Confirm event basics",
      "type": "user_input",
      "status": "completed",
      "dependsOn": [],
      "input": { /* resolved */ },
      "output": { /* validated */ },
      "startedAt": "...",
      "completedAt": "..."
    }
  ],
  "definition": { /* full PlaybookDefinition for client rendering */ }
}
```

## 8. Permissions & Real-Time Events

### 8.1 Permission keys

Add to `permissions` seed:

| Key | Tier | Description |
|-----|------|-------------|
| `playbook_templates.read` | org | View org playbook templates |
| `playbook_templates.write` | org | Create / fork / delete templates |
| `playbook_templates.publish` | org | Publish a new version (separated to allow draft-only roles) |
| `playbook_runs.read` | subaccount | View runs for a subaccount |
| `playbook_runs.start` | subaccount | Start runs and submit user_input steps |
| `playbook_runs.cancel` | subaccount | Cancel running playbooks |
| `playbook_runs.edit_output` | subaccount | Edit completed step outputs (triggers downstream invalidation) |
| `playbook_runs.approve` | subaccount | Decide on `approval` step gates |

System admin and org admin bypass as today.

### 8.2 WebSocket events

New room: `playbook-run:{runId}`. Client joins on opening run detail page.

| Event | Payload | When |
|-------|---------|------|
| `playbook:run:status` | `{ runId, status, completedSteps, totalSteps }` | Run status transitions |
| `playbook:step:dispatched` | `{ runId, stepRunId, stepId }` | Engine dispatches a step |
| `playbook:step:completed` | `{ runId, stepRunId, stepId, output }` | Step finishes successfully |
| `playbook:step:failed` | `{ runId, stepRunId, stepId, error }` | Step fails |
| `playbook:step:awaiting_input` | `{ runId, stepRunId, stepId, formSchema }` | User input needed |
| `playbook:step:awaiting_approval` | `{ runId, stepRunId, stepId, prompt, currentOutput }` | Approval gate hit |
| `playbook:step:invalidated` | `{ runId, stepRunId, stepId }` | Downstream invalidation after edit |

Subaccount-scoped room also receives a coarse `playbook:run:status` for dashboard updates.

### 8.3 Audit events

| Action | Resource |
|--------|----------|
| `playbook_template.published` | `playbook_templates/{id}` (with version) |
| `playbook_template.forked` | `playbook_templates/{id}` |
| `playbook_run.started` | `playbook_runs/{id}` |
| `playbook_run.cancelled` | `playbook_runs/{id}` |
| `playbook_step.output_edited` | `playbook_step_runs/{id}` (includes downstream invalidated count) |
| `playbook_step.approval_decided` | `playbook_step_runs/{id}` |

## 9. Phase 1 Client UI

All pages lazy-loaded per existing convention. Permissions-driven nav additions.

### 9.1 Pages

| Path | Component | Purpose |
|------|-----------|---------|
| `/playbooks` | `PlaybooksLibrary.tsx` | Browse available templates (org + system); start a run |
| `/playbooks/:templateId` | `PlaybookTemplateDetail.tsx` | Read-only view of a template definition (steps, DAG diagram) |
| `/subaccounts/:subaccountId/playbook-runs` | `SubaccountPlaybookRuns.tsx` | List of runs for a subaccount with progress |
| `/playbook-runs/:runId` | `PlaybookRunDetail.tsx` | Run execution view — vertical stepper, live updates |
| `/playbook-inbox` | `PlaybookInbox.tsx` | Cross-subaccount list of runs awaiting current user's input or approval |

### 9.2 `PlaybookRunDetail` layout

- **Header:** template name + version, subaccount, started by, status badge, progress (e.g. `7 / 15 steps`), cancel button.
- **Initial input panel** (collapsible): the data the run was started with.
- **Stepper (vertical):** one row per step in topological order, with sibling parallel steps grouped visually.
  - Step icon (type), name, status badge, depends-on chips
  - Expand → shows resolved input JSON, output JSON (formatted), edit button (if completed and user has `edit_output` perm), error (if failed), agent run link (if `agent_call`)
  - For `awaiting_input`: inline form rendered from `formSchema`
  - For `awaiting_approval`: review pane showing the output, approve / reject / edit-and-approve buttons
- **DAG mini-map** (top-right): SVG of the dependency graph with current statuses, click a node to scroll to that step in the stepper.
- **Live updates** via WebSocket room — no polling.

### 9.3 `PlaybooksLibrary` start flow

1. User picks a template card → modal opens
2. Modal renders form derived from `initialInputSchema`
3. Submit → `POST /api/subaccounts/:subaccountId/playbook-runs` → navigate to run detail
4. Subaccount picker if user has access to multiple subaccounts

### 9.4 Inbox

`PlaybookInbox.tsx` queries `/api/playbook-inbox` (new endpoint) which returns step runs in `awaiting_input` or `awaiting_approval` status across all subaccounts the user can access. Surfaces in the top nav as a badge count.

### 9.5 Component reuse

- Form rendering for `user_input` and initial input → reuse existing form generator (or add `@rjsf/core` if not present).
- DAG diagram → use `reactflow` (lightweight, well-supported). Read-only in Phase 1.
- Stepper → custom component; existing review queue UI patterns are close enough to copy.

## 10. Authoring Workflow & Seeder

### 10.1 File layout

```
server/playbooks/
├── event-creation.playbook.ts
├── monthly-newsletter.playbook.ts
└── client-onboarding.playbook.ts
```

One file per playbook. Filename matches `slug`. Each file `export default definePlaybook({...})`.

### 10.2 AI-assisted authoring

The file format is intentionally optimised for LLM authoring (Claude Code, Copilot, etc.):

- Strong TypeScript types catch invalid step references at edit time.
- Existing playbook files act as in-context examples for the LLM.
- The `definePlaybook` helper means the LLM only needs to write a single object literal.
- Validation is fast and errors are precise — the LLM can iterate against `npm run playbooks:validate`.

A typical AI authoring loop:

1. User: "Create a playbook for launching a webinar — should produce landing page copy, three promo emails, a confirmation email, and social posts."
2. Agent reads `server/playbooks/event-creation.playbook.ts` as a reference.
3. Agent writes `server/playbooks/webinar-launch.playbook.ts`.
4. Agent runs `npm run playbooks:validate` — fixes any DAG or templating errors.
5. Agent runs `npm run playbooks:seed:dev` to load into local DB.
6. User test-runs in the dev UI, requests changes, agent edits the file.

### 10.3 Seeder

`server/scripts/seedPlaybooks.ts`

```typescript
import { glob } from 'glob';
import { playbookTemplateService } from '../services/playbookTemplateService.js';
import { logger } from '../lib/logger.js';

async function main() {
  const files = await glob('server/playbooks/*.playbook.ts');
  let created = 0, updated = 0, skipped = 0;

  for (const file of files) {
    const def = (await import(file)).default;
    const result = playbookTemplateService.validateDefinition(def);
    if (!result.ok) {
      logger.error({ file, errors: result.errors }, 'Playbook validation failed');
      process.exit(1);
    }

    const outcome = await playbookTemplateService.upsertSystemTemplate(def);
    if (outcome === 'created') created++;
    else if (outcome === 'updated') updated++;
    else skipped++;
  }

  logger.info({ created, updated, skipped }, 'Playbook seed complete');
}
main();
```

### 10.4 npm scripts

```jsonc
{
  "scripts": {
    "playbooks:validate": "tsx server/scripts/validatePlaybooks.ts",
    "playbooks:seed": "tsx server/scripts/seedPlaybooks.ts",
    "playbooks:seed:dev": "NODE_ENV=development tsx server/scripts/seedPlaybooks.ts"
  }
}
```

`playbooks:seed` runs as part of the deploy pipeline immediately after migrations.

### 10.5 Versioning rules

- The `version` field in the definition file is the source of truth.
- Seeder compares against `system_playbook_templates.latest_version`. If file version > db version → create new `system_playbook_template_versions` row and update `latest_version`. If equal → no-op. If less → fail (someone reverted without bumping).
- Orgs that forked an older version see an "upgrade available" banner. Upgrading creates a new org template version copying the new system definition (org-specific edits are lost; warn first).
- In-flight runs are unaffected — they're locked to their version row, which is immutable.

### 10.6 System template upgrade UX

When a system template's `latest_version` advances and an org has a fork at an older version:

1. Banner on org template detail page: "System template updated to v4. Review changes."
2. Diff view: side-by-side of v3 and v4 step lists.
3. Two options: "Upgrade my fork" (creates new org version) or "Stay on v3" (dismisses banner until next system version).

## 11. Test Plan

### 11.1 Unit tests

- **`playbookTemplatingService`** — path resolution, missing path errors, namespace handling, edge cases (nested arrays, null values).
  - **Prototype pollution test suite (mandatory):** every blocked path segment (`__proto__`, `constructor`, `prototype`) rejected at validation time. Confirm `Object.create(null)` context has no inherited keys. Confirm whitelist-prefix enforcement.
- **DAG validator** — every rule from §4.1, with positive and negative cases. Cycle detection, orphan detection, template reference resolution.
- **`definePlaybook`** type tests — TS compile-time tests using `tsd` for the type helpers.
- **Zod ↔ JSON Schema round-trip CI check** — for every step `outputSchema` across all seeded playbooks: convert via `z.toJSONSchema()`, validate a sample payload through both Zod and AJV, assert identical accept/reject behaviour. Catches `z.transform()` and `.optional()` semantic drift bugs at CI time, not production.
- **Output hash determinism** — same payload (with key order shuffled) produces the same canonical hash.
- **Side-effect classification** — every step in every seeded playbook declares a `sideEffectType`; CI fails if any step omits it.

### 11.2 Service tests

- **`playbookTemplateService.upsertSystemTemplate`** — create, update (version bump), no-op (same version), revert rejected.
- **`playbookTemplateService.forkSystemTemplate`** — copies definition, sets `forkedFromSystemId`/`forkedFromVersion`.
- **`playbookRunService.startRun`** — validates initial input, creates run + initial step runs (entry steps as `pending`), enqueues first tick.
- **`playbookRunService.editStepOutput`** — invalidates exactly the transitive downstream set, leaves siblings alone, re-merges context correctly.

### 11.3 Engine tests

- **Linear playbook** (5 steps) — starts, runs each in order, completes.
- **Diamond playbook** (A → B, A → C, B+C → D) — B and C dispatch in parallel, D waits for both.
- **User input pause** — engine transitions to `awaiting_input`, resumes on submit.
- **Approval gate** — creates review item, resumes on decision, applies edited output.
- **Conditional step** — true and false branches both verified.
- **Output schema mismatch** — retries up to N times, fails cleanly after.
- **Edit-mid-run** — invalidates downstream, re-runs them, completes correctly.
- **Edit-mid-run with `irreversible` downstream** — returns 409 with affected list and dry-run cost; only proceeds with explicit per-step opt-in.
- **Edit-mid-run with `reversible` downstream** — returns 409 unless `confirmReversible=true`.
- **Output-hash firewall** — re-running a step with deterministic output stops invalidation propagation; downstream is not re-executed.
- **Concurrent ticks** — singleton key prevents duplicate queue jobs; non-blocking advisory lock no-ops on contention; optimistic state guard catches double-dispatch (test with two simulated workers).
- **Watchdog sweep** — kill the tick enqueue mid-transaction, verify the watchdog re-enqueues within 60s and the run progresses.
- **Step timeout / poison message** — expired step transitions to failed and the run's failure policy executes.
- **Cancellation** — in-flight steps receive AbortController signal; run marked cancelled.

### 11.4 Integration tests

- End-to-end run of a real seeded playbook against a test subaccount, with mocked agent runs.
- Permission matrix — every route returns 403 without the right permission.
- WebSocket events emitted in correct order for a real run.

### 11.5 Manual QA checklist

- Start a run from the library, watch it execute live in run detail.
- Submit a `user_input` step, verify downstream dispatch.
- Edit a completed step's output, verify downstream invalidation + re-run.
- Approve an `approval` step with edits.
- Cancel a running playbook mid-execution.
- System admin updates a system template; org sees upgrade banner; org upgrades.
- Run UI survives a server restart (resumability).

## 12. Rollout Plan

### 12.1 Implementation order

1. **Migration 0074** — schema only. Land first, no behaviour change.
2. **Types + `definePlaybook` + validator + templating service** — pure code, fully unit-tested in isolation.
3. **`playbookTemplateService` + seeder + npm scripts** — system templates loadable; no runtime behaviour yet.
4. **`playbookEngineService` + `playbookRunService` + pg-boss queue** — engine runnable from a script, no UI.
5. **Routes** — wire up endpoints; integration tests pass.
6. **Hook into `agentRunService.onComplete`** — connect engine to existing agent infrastructure.
7. **WebSocket events** — broadcast on the new room.
8. **Phase 1 UI pages** — library, run detail, inbox.
9. **Permissions seed** — add new keys, integrate into permission set UI.
10. **Seed 1–2 real system playbooks** (start with the event creation one).
11. **Internal dogfood** — run end-to-end against a real subaccount.
12. **Release behind a feature flag** — `playbooks_enabled` per org.

### 12.2 Feature flag

Add to org settings: `featureFlags.playbooks: boolean` (default false). Routes return 404 unless enabled. Nav items hidden. Allows controlled rollout per org.

### 12.3 Backwards compatibility

- New tables only — no changes to existing schema.
- Engine reuses `agentRuns` with a new nullable `playbookStepRunId` column (added in migration 0074).
- No breaking changes to existing routes or services.

### 12.4 Observability

- Structured logs on every tick: `runId`, `stepId`, `status transition`, `duration`.
- Metrics: runs started/completed/failed per org, average duration, step parallelism factor, output schema retry rate.
- Per-run timeline view in admin UI (Phase 1 nice-to-have).

### 12.5 Open questions

1. Should `agent_call` steps be allowed to spawn handoffs? Currently yes (existing agent system handles it) — but this could blow up token budgets unexpectedly. Recommend: yes, with the existing `MAX_HANDOFF_DEPTH=5` limit applying per agent run.
2. Should runs be cancellable mid-step, or only between steps? Recommend: between steps only (Phase 1) — cancelling a running agent run is messy. Mark run as `cancelling`, let current steps finish, then transition to `cancelled`.
3. Versioning model for org forks: linear (v1, v2, v3) or branched (v1, v1.1, v2)? Recommend: linear, simple. Branching is YAGNI for Phase 1.
4. Should the inbox surface runs assigned to anyone in the user's permission scope, or only runs the user started? Recommend: anyone in scope — playbooks are collaborative.

---

**End of spec.** Review, comment, and assign owner before implementation.
