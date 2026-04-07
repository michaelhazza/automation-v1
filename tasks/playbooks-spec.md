# Playbooks — Detailed Dev Specification

**Status:** Build-ready — further refinement is premature optimisation. The next 10x of value comes from running 2 real playbooks in production, not from another spec round. Highest-leverage next action: hand this to the `feature-coordinator` agent and start §12 implementation order step 1.
**Owner:** TBD
**Related:** `architecture.md` § Playbooks (Multi-Step Automation)
**Target migration:** `0074_playbooks.sql`
**Last research integration:** Architecture review (singletonKey, non-blocking lock, side-effect classification, output-hash firewall, prototype-pollution hardening, watchdog sweep, parameterization deferred to 1.5)
**Last main integration:** Reporting Agent paywall workflow merge (shared infra: `withBackoff`, `runCostBreaker`, `failure` helper, `skillVisibility`, `canonicaliseUrl`)

## 0. How to read this document

Sections 1–4 cover the data model and authoring format — read these to understand **what** a playbook is. Sections 5–8 cover runtime — read these to understand **how** the engine executes. Sections 9–10 cover UI and authoring workflow. Sections 11–13 cover testing, rollout, and risk. Section 14 is a sign-off checklist.

The single most important constraint to internalise: **every step declares a `sideEffectType`, and the engine never auto-re-executes irreversible steps.** Mid-run editing is the feature most likely to cause real customer harm if implemented naively, and §5.4 exists to prevent that.

## 0.1 Naming conventions

| Layer | Convention | Examples |
|-------|------------|----------|
| Postgres tables, columns, types, enums | `snake_case` | `playbook_runs`, `output_hash`, `playbook_run_status` |
| TypeScript identifiers (vars, fields, fns, types) | `camelCase` (types `PascalCase`) | `playbookEngineService`, `sideEffectType`, `PlaybookStep` |
| Step ids inside a playbook definition | `kebab_case` (lowercase, `_` allowed, kebab convention enforced by validator regex `^[a-z][a-z0-9_]*$`) | `event_basics`, `landing_page_hero` |
| Template slugs (filename and DB) | `kebab-case` | `event-creation`, `monthly-newsletter` |
| Failure reasons | `snake_case` constants in the `FailureReason` enum | `playbook_dag_invalid`, `playbook_irreversible_blocked` |
| WebSocket event types | `colon:separated` namespaces | `playbook:step:completed`, `playbook:run:status` |
| Permission keys | `dot.separated.scope` | `playbook_runs.edit_output` |
| Audit event names | `resource.action` | `playbook_template.published` |

The Drizzle layer maps `snake_case` columns to `camelCase` TS fields automatically — use the TS identifiers everywhere except in raw migration SQL.

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
- Per-step context projection (passing only required fields to LLM instead of full context). Phase 1 passes the full context; Phase 1.5 adds opt-in projection.
- **Cross-run resource locking** (e.g. `resourceLockKey: 'cms:page:homepage'` to prevent two runs writing to the same external entity simultaneously). Real concern but external to the engine. Phase 2+ if real demand surfaces.
- **HITL fatigue mitigations** — `autoApproveIfConfidenceAbove`, batch approvals, "trust this step type" — product-side enhancements for after we have telemetry on actual approval friction. Phase 2+.
- **Hierarchical `FailureReason` grouping** (e.g. `playbook.schema.*`, `playbook.execution.*`). The current flat enum is fine until we exceed ~30 reasons. Revisit if it becomes unwieldy.

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
| `context_json` | jsonb | Growing run context (initial input + step outputs keyed by step id). Hard-bounded by `MAX_CONTEXT_BYTES_HARD` (§3.6). |
| `context_size_bytes` | int default 0 | Tracked for fast soft/hard limit checks without re-serialising on every tick |
| `replay_mode` | bool default false | When true, engine reads stored outputs instead of re-executing external calls (§5.10) |
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
| `input_hash` | text nullable | SHA256 of canonical JSON of `input_json`. Powers retry deduplication ("same inputs produced this output before") and unlocks future cross-run dedup. |
| `output_json` | jsonb nullable | Validated against step's outputSchema |
| `output_hash` | text nullable | SHA256 of canonical JSON output; powers the firewall pattern in invalidation |
| `output_inline_ref_id` | uuid nullable | Set when output exceeds `MAX_STEP_OUTPUT_BYTES` and was spilled via `inlineTextWriter` |
| `quality_score` | smallint nullable | Optional 0–100 quality signal written by the step (§3.8) |
| `evaluation_meta` | jsonb nullable | For `conditional` steps: `{ result, evaluatedAt, inputsHash }` (§5.9) |
| `version` | int default 0 | Optimistic concurrency guard for state transitions |
| `side_effect_type` | enum | Snapshot from definition: `none`, `idempotent`, `reversible`, `irreversible` |
| `agent_run_id` | uuid fk nullable | Links to `agentRuns` for `agent_call` and `prompt` types |
| `attempt` | int default 1 | For idempotency keying on retry |
| `started_at`, `completed_at` | timestamps nullable | |
| `error` | text nullable | |

Unique index on `(run_id, step_id, attempt)`.

### 2.6.1 `playbook_run_event_sequences`

| Column | Type | Notes |
|--------|------|-------|
| `run_id` | uuid pk → playbook_runs | |
| `last_sequence` | bigint default 0 | Allocated via `UPDATE ... RETURNING last_sequence + 1` in the same tx as the state change |

Used by §8.2 WebSocket event envelope to give each emission a strictly monotonic per-run sequence number.

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
  'completed', 'completed_with_errors', 'failed', 'cancelling', 'cancelled'
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
  failurePolicy?: 'fail_run' | 'continue';  // default 'fail_run'. 'continue' allows the run to finish in completed_with_errors if this step fails AND no downstream depends on its output (or all downstream also have continue policy).

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

**Re-verification on dispatch (mandatory).** The cached agent id is **revalidated immediately before each `agent_call` dispatch** — the engine checks that the agent still exists and hasn't been soft-deleted. If the agent vanished between run start and step dispatch (deleted, soft-deleted, or moved to another org), the step fails via `failure('playbook_template_drift', 'agent_deleted_mid_run', { stepId, agentId, slug })` and the run's `failurePolicy` for that step decides whether the whole run fails or finishes `completed_with_errors`. Without this check, the engine would dispatch into a dangling foreign key and surface an opaque DB error.

### 3.5 Output schema enforcement

Every step declares an `outputSchema` (Zod). On step completion:

1. Engine receives raw output (LLM response, form submission, conditional result).
2. For LLM-based outputs (`prompt`, `agent_call`), the resolved prompt instructs the model to return JSON matching the schema. The schema is also passed to the model as a tool / structured-output spec where the provider supports it (Anthropic tool use, OpenAI structured outputs).
3. Engine parses output through `outputSchema.safeParse()`. On failure, retry via `withBackoff` up to N times (configurable per step, default 2) with the parse error appended to the prompt context. After max retries, the step is marked `failed` via `failure('schema_violation', 'output_parse_failed', { stepId, attempts, lastError })`.
4. On success, the validated output is canonicalised (key sort + JSON.stringify), hashed (SHA256 → `output_hash`), and merged into `run.context_json` at `steps.<id>.output`.

### 3.6 Context size limits and spillover

`run.context_json` is a single growing JSON blob, but it is **bounded**. Without limits, a 30-step playbook with rich outputs produces multi-MB rows, blows up token budgets on every downstream prompt, and bloats WebSocket payloads.

| Limit | Value | Behaviour on overage |
|-------|-------|---------------------|
| `MAX_STEP_OUTPUT_BYTES` | 100 KB (canonical JSON) | Step output is **automatically spilled** to `inlineTextWriter`; the context stores a pointer instead. |
| `MAX_CONTEXT_BYTES_SOFT` | 512 KB | Warning logged; alert if sustained across many runs. |
| `MAX_CONTEXT_BYTES_HARD` | 1 MB | Run fails via `failure('playbook_context_overflow', 'hard_limit_exceeded', { runId, sizeBytes })`. |

**Spillover format.** When a step output exceeds `MAX_STEP_OUTPUT_BYTES`, the engine writes the canonical JSON via `inlineTextWriter` and stores this pointer in `context.steps[id].output`:

```jsonc
{
  "type": "inline_ref",
  "id": "inline-text-uuid",
  "byteSize": 184320,
  "schemaPath": "steps.research.output",
  "preview": "..."   // first 200 chars for human-readable inspection
}
```

The templating resolver detects `inline_ref` values transparently — when a downstream step references `{{ steps.research.output.summary }}`, the resolver hydrates the inline text into memory just-in-time and reads the path. **Hydration is per-step, not per-run** so peak memory stays bounded.

**Per-step hydration cache.** A single step often references the same inline ref multiple times (e.g. five `{{ steps.research.output.* }}` expressions across `agentInputs` and `prompt`). The resolver maintains a `Map<inlineRefId, hydratedValue>` scoped to one step execution, hydrates each ref at most once, and clears the cache when the step completes (success or failure). Without this cache, an N-expression × M-ref step pays O(N × M) disk reads.

**Per-step context projection (Phase 1.5 enhancement, deferred).** Today every dispatched step receives the full context. In 1.5 we'll add a per-step `contextProjection: string[]` field listing which step outputs the prompt actually needs, so the engine can pass a minimal subset to the LLM. The data path is in place from Phase 1; only the prompt construction changes.

**Hash and dedup.** `output_hash` is computed on the canonical JSON of the **full output** (pre-spillover), so the firewall pattern still works: a re-execution that produces a byte-identical large output is caught and propagation stops without re-hydrating downstream.

**Retention and GC.** Inline refs accumulate quickly across thousands of runs. A pg-boss cron job `playbook-inline-ref-gc` runs daily and deletes refs that meet **all** of:

- Not referenced by any non-terminal `playbook_runs` row (active runs).
- Not referenced by any `playbook_step_runs.output_inline_ref_id` belonging to a run completed within the retention window.
- Older than `INLINE_REF_RETENTION_DAYS` (default 90, env-configurable).

Replay runs hold a strong reference to their source run's inline refs via the cloned step rows, so GC respects them naturally. Audit-critical runs can be flagged `retainIndefinitely: true` on `playbook_runs` (Phase 1.5 enhancement; Phase 1 ships without the flag and the default 90-day window).

### 3.7 Per-step retry policy

Steps can override the engine-default retry behaviour:

```typescript
retryPolicy?: {
  maxAttempts?: number;                      // default depends on step type (see §5.8)
  backoffStrategy?: 'exponential' | 'linear';// default 'exponential'
  retryOn?: FailureReason[];                 // default depends on step type
};
```

Defaults per step type:

| Step type | maxAttempts | retryOn (default) |
|-----------|-------------|-------------------|
| `prompt` | 3 | `playbook_schema_violation`, transient LLM errors |
| `agent_call` | 2 | transient LLM/network errors only |
| `user_input` | n/a | n/a |
| `approval` | n/a | n/a |
| `conditional` | 1 | none — fails fast on evaluation error |

A step that calls a non-idempotent external API should set `maxAttempts: 1` to disable retries. Schema parse retries (engine-level) are independent of `retryPolicy` and run up to the parse-retry limit (default 2) **except for `irreversible` steps**, which never retry.

**Runtime backstop:** the engine refuses to dispatch any retry of an `irreversible` step regardless of policy — if validation somehow let one through (e.g. older template version pre-rule), the dispatcher fails with `failure('playbook_irreversible_blocked', 'retry_attempt_blocked', { stepId, attempt })`. Validator catches it at publish time; this is belt-and-braces.

### 3.8 Optional quality score on step outputs

Steps can optionally write a `qualityScore` (0–100) into the engine's output envelope when they complete:

```jsonc
{
  "output": { /* schema-validated payload */ },
  "qualityScore": 87,
  "qualityNotes": "model self-rated against rubric"
}
```

The score is stored in a new `quality_score` column on `playbook_step_runs` (nullable smallint). Phase 1 surfaces it in the run detail UI as a small badge but doesn't act on it. Phase 1.5+ may use it to drive auto-retry, ranking, or analytics. Sources can include LLM self-evaluation, heuristic checks against the schema, or future feedback loops — the engine treats it as opaque metadata.

### 3.9 Worked example: a real 15-step playbook (abridged to 6 for readability)

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
12. **Irreversible steps cannot retry.** If `sideEffectType === 'irreversible'`, then `retryPolicy?.maxAttempts` must be `1` or unset. Engine-level schema-parse retries are also disabled for irreversible steps (parse failure → fail immediately, no second LLM call). This is a hard rule — duplicate retries on irreversible operations are exactly the failure mode `sideEffectType` exists to prevent.
13. **Max DAG depth.** The longest path from any entry step to any terminal step must be ≤ `MAX_DAG_DEPTH` (default 50). Prevents pathological AI-generated graphs and bounds worst-case run duration.

### 4.2 Validator output

Returns either `{ ok: true }` or `{ ok: false, errors: ValidationError[] }` where each error includes step id, rule violated, and human-readable message. UI surfaces these inline in the (Phase 2) builder; seeder fails the deploy with clear logs.

```typescript
export interface ValidationError {
  rule: 'unique_id' | 'kebab_case' | 'unresolved_dep' | 'cycle' | 'orphan'
      | 'missing_entry' | 'unresolved_template_ref' | 'transitive_dep'
      | 'missing_field' | 'missing_output_schema' | 'agent_not_found'
      | 'missing_side_effect_type' | 'version_not_monotonic'
      | 'irreversible_with_retries' | 'max_dag_depth_exceeded';
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

A run is `running` whenever the engine has work it can dispatch. It transitions to `awaiting_*` when **all** ready steps are blocked on human action. Terminal states:

| State | When |
|-------|------|
| `completed` | Every step ended in `completed` or `skipped`. No failures. |
| `completed_with_errors` | At least one step failed AND its `failurePolicy === 'continue'` AND the engine reached a terminal state with the rest of the DAG. The run is considered a partial success — surfaced as a yellow badge in UI and tagged in metrics. |
| `failed` | At least one step failed with `failurePolicy === 'fail_run'` (the default), OR a `continue` failure blocked all remaining downstream paths. |
| `cancelled` | Explicit user cancellation, parent run cancellation, or kill switch (§5.11). Transitions through `cancelling` first to allow in-flight steps to settle. |

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
    elif anyFailedBlocksAllTerminalPaths(definition, stepRuns):
      markRunFailed(runId)
    elif stepRuns.any(s => s.status === 'failed' and step.failurePolicy === 'continue'):
      markRunCompletedWithErrors(runId)
    elif stepRuns.any(s => s.status in [awaiting_input, awaiting_approval, running]):
      updateRunStatus(runId, computeAggregateStatus(stepRuns))
    return

  // 3. Dispatch ready steps in parallel — capped to MAX_PARALLEL_STEPS
  currentlyRunning = stepRuns.filter(s => s.status === 'running').length
  capacity = MAX_PARALLEL_STEPS - currentlyRunning  // default 8
  toDispatch = ready.slice(0, max(0, capacity))
  // Remaining ready steps stay 'pending'; next tick (fired by step completion) will pick them up

  for step in toDispatch:
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
      try:
        inputsHash = hash(resolveInputs(step.condition, run.contextJson))
        result = jsonLogic.evaluate(step.condition, run.contextJson)
      catch err:
        markStepRunFailed(stepRun, failure('playbook_dag_invalid', 'conditional_eval_failed', { stepId, error }))
        enqueueTick(run.id)
        return
      stepRun.outputJson = result ? step.trueOutput : step.falseOutput
      // Validate the chosen output against outputSchema (catches typos in trueOutput/falseOutput)
      parseResult = step.outputSchema.safeParse(stepRun.outputJson)
      if not parseResult.success:
        markStepRunFailed(stepRun, failure('playbook_schema_violation', 'conditional_output_invalid', ...))
        enqueueTick(run.id)
        return
      stepRun.evaluationMeta = { result, evaluatedAt: now(), inputsHash }
      stepRun.status = 'completed'
      mergeContext(run, step.id, stepRun.outputJson)
      enqueueTick(run.id)
```

### 5.2.1 Failure propagation: terminal-path reachability

`anyFailedBlocksAllTerminalPaths` is a graph reachability check, not a local sibling-check. The rule:

> **A run is `failed` if and only if there exists at least one step with status `failed` and `failurePolicy: 'fail_run'` such that every terminal step in the DAG is reachable only via that failed step.**

A "terminal step" is a step with no descendants (nothing has it in `dependsOn`). Algorithm:

```
function anyFailedBlocksAllTerminalPaths(definition, stepRuns):
  failedFailRunIds = stepRuns where status='failed' and step.failurePolicy='fail_run'
  if failedFailRunIds.empty: return false

  terminalSteps = definition.steps where no other step depends on it
  for terminal in terminalSteps:
    paths = allPathsFromEntryToTerminal(definition, terminal)
    // 'reachable' means at least one path doesn't pass through any failed-fail_run step
    reachable = paths.any(path => path.intersect(failedFailRunIds).empty)
    if reachable: return false   // at least one terminal still reachable

  return true   // every terminal is blocked by a failed step
```

This handles the diamond/branch case correctly: if one branch fails with `continue` policy and another branch reaches a terminal, the run finishes `completed_with_errors`. If a `fail_run` step lies on the only path to every terminal, the run fails.

For DAGs with thousands of steps the path enumeration would be expensive, so the implementation uses BFS from the failed step's descendants instead: a terminal is "blocked by failure F" iff every path from any entry step to that terminal passes through F. This is checked via dominator-tree intersection in O(V+E). The simpler enumeration above is the spec's reference behaviour.

### 5.3 Step completion handlers

- **`onAgentRunCompleted(agentRunId)`** — webhook fired by agent run service. Looks up `playbook_step_runs.agent_run_id`, validates output against schema, merges to context, marks step `completed` (or `awaiting_approval` if `humanReviewRequired`), enqueues a tick.
- **`onUserInputSubmitted(stepRunId, formData)`** — validates against `formSchema`, writes `outputJson`, marks `completed`, merges context, enqueues tick.
- **`onApprovalDecided(stepRunId, decision, editedOutput?)`** — if approved, mark `completed`. If rejected, mark `failed`. If edited, write the edited output and mark `completed`. Enqueue tick.

### 5.4 Mid-run output editing

> **Canonical source.** This section is the authoritative behavioural spec for mid-run editing. The route contract in §7 and the UI flow in §9.6 reference these rules and must not redefine them. Any future change to mid-run editing semantics happens here first.

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
   - Steps marked "skip and reuse" copy their previous output forward to the new attempt with status `completed`. The reused row carries explicit reuse metadata in its `_meta` envelope: `{ reusedFromStepRunId, reusedWithInputHash, reusedAt, isStaleRelativeToInputs }`. `isStaleRelativeToInputs` is `true` whenever the new attempt's resolved `input_hash` differs from `reusedWithInputHash` — i.e. the upstream context that fed the original output has actually changed. The UI surfaces this as a yellow "reused from previous context" warning on the step row, and downstream consumers can detect it via the `_meta` envelope. Audit events for skip-and-reuse always include both hashes.
5. **Cancel any in-flight downstream steps:** for step runs currently in `running` status within the invalidation set, fire an `AbortController` signal to the agent run / job worker. **Hard discard rule** — when an agent run completes via the existing `onAgentRunCompleted` hook, the engine first reads the linked `playbook_step_runs.status`. If the status is `invalidated` (or anything other than `running`), the result is **discarded without merging into context**, and the engine emits a `step.result_discarded_invalidated` log line with `runId`, `stepRunId`, and `reason`. This rule applies to every termination path (mid-run edit cancel, kill switch, run cancel, parent invalidation) — not just mid-run editing.
6. Re-merge context from scratch using only currently-completed step outputs (the new edited one + all unaffected siblings).
7. Enqueue tick.

**Idempotency keys for re-execution.** All re-runs use `playbook:{runId}:{stepId}:{attempt}` as the key. External APIs called by `idempotent` steps must accept this key to deduplicate at the destination.

**DAG fan-in handling.** If steps A→C and B→C converge at C, and only A is invalidated, the new C step run merges its context from the new A output and the existing valid B output. The context merger always pulls latest valid output per parent.

**Output-hash firewall propagation.** When a re-executed step completes, hash its output. If the hash equals the previous attempt's hash, **stop propagating invalidation** to its downstream — the change didn't actually affect this branch. This can prevent re-running entire subtrees when an edit produces deterministic output.

The `invalidated` rows stay in the DB for audit — they're never deleted.

### 5.5 Idempotency and retries

- pg-boss tick jobs are idempotent — running `tick(runId)` twice is a no-op if no state changed.
- Step-level agent runs use idempotency key `playbook:{runId}:{stepId}:{attempt}`. Retry increments `attempt`.
- Engine retries transient errors (network, rate limits) up to 3 times with exponential backoff via `withBackoff`. Permanent errors (schema mismatch after max parse retries) fail immediately.
- **Irreversible steps never retry** — see §3.7 runtime backstop and §4.1 rule 12.
- TripWire errors from skill executors propagate up — engine retries the step (subject to the irreversible exclusion).
- **Input fingerprint dedup.** Each step run records `input_hash`. On retry, if a previous attempt of the same `(run_id, step_id)` had identical `input_hash` AND `output_json` is present, the engine **may** reuse the previous output instead of re-dispatching (controlled by `dedupOnIdenticalInput`, default false in Phase 1, opt-in per step type). Phase 1 ships the column and the hash; the dedup behaviour ships in 1.5 once we have telemetry on how often it would actually fire.

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

### 5.9 Budget and policy integration

- `agent_call` and `prompt` steps go through the existing agent run path → budget reservations apply automatically.
- `runCostBreaker` is called immediately before every dispatch — failing fast prevents an in-flight invalidation cascade from blowing the ceiling.
- Run start can optionally pre-reserve a budget envelope based on summed step estimates (`playbookCostEstimatorService.estimateRun`).
- Policy engine evaluated per agent run as today — no engine-level bypass.

### 5.10 Replay mode

`playbook_runs.replay_mode = true` puts a run in a deterministic replay state for debugging, demos, and audit reconstruction.

When set:

- The engine reads stored `output_json` (or hydrates `output_inline_ref_id`) for every step from a source run and writes them to the replay run's step rows directly, marking each `completed`, **without dispatching any external work** (no LLM calls, no agent runs, no skill executions, no webhooks).
- `agent_call` and `prompt` steps skip the agent run path entirely.
- `user_input` and `approval` steps replay the recorded user response.
- `conditional` steps re-evaluate against the replayed context and assert the same `evaluationMeta.result` as the original — divergence emits `failure('playbook_replay_drift', 'conditional_diverged', { stepId })`.
- WebSocket events still fire so the UI can play back the run timeline.

Replay mode is created via `POST /api/playbook-runs/:runId/replay` which clones the source run's metadata and step outputs into a fresh `playbook_runs` row with `replay_mode = true`. The original run is untouched.

**Replay marker on every output.** Step outputs in a replay run carry a `_meta` envelope alongside the schema-validated payload:

```jsonc
{
  "output": { /* original payload */ },
  "_meta": {
    "isReplay": true,
    "replaySourceRunId": "uuid",
    "replayedAt": "iso8601",
    "sourceStepRunId": "uuid"
  }
}
```

This makes replay outputs **structurally distinguishable** from real ones at every consumer boundary. Downstream systems that integrate with playbook outputs (webhooks, UI, audit exports) can detect replay context and refuse to act on it ("non-production-valid"). The UI surfaces a persistent banner across the run detail page when `replay_mode = true`. **External system drift** (e.g. CMS schema changed since the original run) is therefore the consumer's responsibility to detect — replay only guarantees engine determinism, not external compatibility.

Use cases: reproducing a customer-reported issue without re-incurring side effects, demoing a workflow without burning credits, validating a refactor of a downstream consumer service against historical run shapes.

### 5.11 Kill switch enforcement

Every tick begins with a kill switch check before any other work:

```
function tick(runId):
  run = loadRun(runId)
  if run.status in [completed, completed_with_errors, failed, cancelled]: return

  // KILL SWITCH CHECK — runs first, before any dispatch
  org = loadOrganisation(run.organisationId)
  subaccount = loadSubaccount(run.subaccountId)
  if org.status === 'suspended' or subaccount.killSwitch === true:
    cancelRun(run, failure('playbook_cancelled', 'policy_kill_switch', {
      orgStatus: org.status,
      killSwitch: subaccount.killSwitch
    }))
    emit websocket 'playbook:run:status' { status: 'cancelled' }
    return
  ...
```

This honours the existing org-level suspension and subaccount-level kill switch flags. The watchdog sweep also checks the kill switch on every cycle so a run already running when the switch trips is killed within 60 seconds even if no other tick fires. **Mid-step abort:** when the kill switch trips, in-flight steps receive an `AbortController` signal via the same path used by mid-run editing.

### 5.12 Context size enforcement

After every step output merge, the engine recomputes `context_size_bytes` (cheaply via `Buffer.byteLength` of canonical JSON of new output, added to running total). On overage:

- **Soft limit (`MAX_CONTEXT_BYTES_SOFT`)**: log warning, emit `playbook.context.soft_limit_hit` metric, run continues.
- **Hard limit (`MAX_CONTEXT_BYTES_HARD`)**: mark run `failed` via `failure('playbook_context_overflow', 'hard_limit_exceeded', ...)`. Audit + alert.
- Per-step output overage triggers automatic spillover via `inlineTextWriter` (§3.6) before the merge ever runs, so the soft/hard limit only fires on **inline pointer accumulation** (which is rare — pointers are tiny).

### 5.13 Engine invariants (consolidated)

Single-source list of properties the engine must always preserve. Every PR touching engine code must verify it does not break these. Tests in §11 cover each one explicitly.

1. **Step attempt uniqueness** — at most one live (non-`invalidated`, non-`failed`) step run exists per `(run_id, step_id)` at any time.
2. **Context derivability** — `run.context_json` is always derivable from the union of `output_json` (or hydrated `output_inline_ref_id`) of currently-`completed` step runs plus `run.input`. After any state mutation, this property holds.
3. **Invalidated rows are inert** — invalidated step runs never contribute to context, never satisfy a `dependsOn` check, and their late-arriving outputs are discarded (§5.4 hard discard rule).
4. **Version monotonicity** — `playbook_step_runs.version` is strictly increasing per row; transitions only happen via the optimistic-guard SQL pattern.
5. **Run version lock** — `playbook_runs.template_version_id` never changes after run start. Templates can be republished freely without affecting in-flight runs.
6. **Side-effect safety** — irreversible step runs are dispatched at most once per run, regardless of policy, retries, or invalidation.
7. **Cost ceiling** — every dispatch path goes through `runCostBreaker`. No code path bypasses the breaker.
8. **Failure-helper monopoly** — every failure persisted to `playbook_runs.error` or `playbook_step_runs.error` is constructed via `failure()`. No inline literals.
9. **Tick idempotence** — calling `tick(runId)` twice in succession is a no-op if no state changed in between. Any tick handler that mutates state must enqueue a follow-up tick in the same transaction.
10. **Watchdog liveness** — every non-terminal run advances within `WATCHDOG_INTERVAL_SECONDS` of any reachable state change, even if no explicit tick is enqueued.
11. **Transactional state changes** — step status transitions and tick enqueues happen in the same DB transaction.
12. **DAG immutability post-publish** — the `definition_json` of a published `playbook_template_versions` row is read-only forever.

If any invariant is violated in production, treat it as a P1 bug.

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

Pure functions, fully unit-tested. No DB access. No I/O.

```typescript
resolve(expression: string, context: RunContext): unknown
resolveStep(step: PlaybookStep, context: RunContext): ResolvedStep
extractReferences(expression: string): TemplateReference[]
canonicalise(value: unknown): string  // canonical JSON for hashing
hashOutput(value: unknown): string    // SHA256 of canonical JSON
```

### 6.5 `playbookCostEstimatorService`

Used by the dry-run preview during mid-run editing and at run start.

```typescript
estimateRun(definition: PlaybookDefinition): { totalCents: number; perStep: Record<string, number> }
estimateSubgraph(definition: PlaybookDefinition, fromStepIds: string[]): { totalCents: number; affectedSteps: string[] }
```

Estimates use the existing `llmPricing` table and per-step `model` overrides. Token estimates are coarse — based on prompt length × historical output ratios. Accuracy ±50% is acceptable initially; the value is in giving the user an order-of-magnitude warning, not a precise quote.

**Feedback loop (compounding accuracy).** Every completed step records its actual cost (already tracked via `costAggregates`). The estimator queries a rolling window (last 50 runs of the same template version, same step id) and adjusts the projected cost per step toward the rolling mean. This is a one-line change once telemetry is in place — `estimateStep(stepId, version) = base_estimate * (rolling_actual / rolling_estimated)`. Phase 1 ships the storage path (actual costs already exist on `agent_runs` linked via `playbook_step_run_id`); Phase 1.5 turns on the adjustment. Within 50 runs of any template the estimator should converge to ±15%.

### 6.6 Service error catalogue

All services throw via `failure()`. The new failure reasons added to `FailureReason` enum:

| Reason | Detail examples |
|--------|-----------------|
| `playbook_dag_invalid` | `cycle_detected`, `unresolved_dep`, `orphan_step`, `template_ref_invalid` |
| `playbook_template_drift` | `version_validation_failed`, `agent_slug_missing` |
| `playbook_input_invalid` | `initial_input_schema_violation`, `step_form_schema_violation` |
| `playbook_irreversible_blocked` | `mid_run_edit_irreversible`, `mid_run_edit_reversible_unconfirmed` |
| `playbook_schema_violation` | `output_parse_failed`, `output_validation_failed` |
| `playbook_cost_exceeded` | `pre_flight_ceiling`, `mid_run_edit_estimate_exceeds_budget` |
| `playbook_step_timeout` | `prompt_timeout`, `agent_call_timeout` |
| `playbook_cancelled` | `user_cancelled`, `parent_run_cancelled` |

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
| GET | `/api/playbook-inbox` | `playbook_runs.read` | Cross-subaccount list of step runs awaiting current user's input or approval |

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
      "sideEffectType": "none",
      "input": { /* resolved */ },
      "output": { /* validated */ },
      "outputHash": "sha256...",
      "attempt": 1,
      "startedAt": "...",
      "completedAt": "..."
    }
  ],
  "definition": { /* full PlaybookDefinition for client rendering */ }
}
```

**`POST /api/playbook-runs/:runId/steps/:stepRunId/output`** — mid-run edit. The most safety-critical endpoint in the system.

```jsonc
// request
{
  "output": { /* must conform to step's outputSchema */ },
  "confirmReversible": ["step_id_1", "step_id_2"],     // optional explicit opt-in
  "confirmIrreversible": ["step_id_3"],                 // optional explicit opt-in
  "skipAndReuse": ["step_id_4"]                         // copy previous output forward instead of re-running
}
// response 200 — change accepted, downstream invalidated as requested
{
  "ok": true,
  "invalidatedStepIds": ["..."],
  "skippedStepIds": ["..."],
  "estimatedCostCents": 4200,
  "cascade": {
    "size": 7,                    // total downstream steps invalidated
    "criticalPathLength": 4,      // longest re-execution path through the invalidated subgraph
    "estimatedDurationMs": 180000 // critical path × per-step duration estimate
  }
}
// response 409 — needs confirmation
{
  "error": "playbook_irreversible_blocked",
  "detail": "mid_run_edit_irreversible",
  "affected": [
    {
      "stepId": "publish_landing_page",
      "name": "Publish landing page to CMS",
      "sideEffectType": "irreversible",
      "estimatedCostCents": 50,
      "previousOutput": { /* what's already there */ }
    }
  ],
  "totalEstimatedCostCents": 4250,
  "cascade": {
    "size": 7,
    "criticalPathLength": 4,
    "estimatedDurationMs": 180000
  }
}
// response 422 — output failed schema validation
{ "error": "playbook_schema_violation", "issues": [ /* zod issues */ ] }
```

**`POST /api/playbook-runs/:runId/steps/:stepRunId/approve`**

Both this endpoint and the mid-run edit endpoint accept an optimistic-concurrency `expectedVersion` taken from the step run row at UI load. If the row's `version` advanced in the meantime (e.g. an upstream edit invalidated this step or another reviewer acted first), the request is rejected with **409 Conflict** and the client must refetch the run before retrying.

```jsonc
// request
{
  "decision": "approved" | "rejected" | "edited",
  "editedOutput": { /* required if decision === 'edited' */ },
  "comment": "optional",
  "expectedVersion": 3
}
// response 200
{ "ok": true, "stepRunStatus": "completed" | "failed", "newVersion": 4 }
// response 409 — stale UI
{ "error": "playbook_stale_version", "currentVersion": 5, "expectedVersion": 3 }
```

The same `expectedVersion` field applies to `POST .../steps/:stepRunId/output` (mid-run edit) and `POST .../steps/:stepRunId/input` (user input submit). All three endpoints share the same stale-version semantics so a user editing or approving a step that has been invalidated by an upstream change can never overwrite the new pending row.

**`POST /api/playbook-runs/:runId/steps/:stepRunId/input`**

```jsonc
// request — for user_input steps
{ "data": { /* must match step's formSchema */ } }
// response 200
{ "ok": true }
```

**`POST /api/playbook-runs/:runId/cancel`**

```jsonc
// request — empty body
// response 200 — run transitions to 'cancelling', then 'cancelled' once in-flight steps stop
{ "ok": true, "status": "cancelling" }
```

**`POST /api/playbook-templates/fork-system`**

```jsonc
// request
{ "systemTemplateSlug": "event-creation" }
// response 201
{ "id": "uuid", "version": 1, "forkedFromVersion": 3 }
```

**`POST /api/playbook-templates/:id/publish`**

```jsonc
// request
{ "definition": { /* full PlaybookDefinition */ } }
// response 201
{ "version": 4 }
// response 422
{ "error": "playbook_dag_invalid", "issues": [ /* ValidationError[] */ ] }
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

New room: `playbook-run:{runId}`. Client joins on opening run detail page. Every event below is wrapped in the envelope shape described later in this section (eventId + sequence + emittedAt + type + payload).

| Event | Payload | When |
|-------|---------|------|
| `playbook:run:status` | `{ runId, status, completedSteps, totalSteps }` | Run status transitions (including `completed_with_errors`, `cancelled` via kill switch) |
| `playbook:step:dispatched` | `{ runId, stepRunId, stepId }` | Engine dispatches a step |
| `playbook:step:completed` | `{ runId, stepRunId, stepId, output }` | Step finishes successfully |
| `playbook:step:failed` | `{ runId, stepRunId, stepId, error }` | Step fails |
| `playbook:step:awaiting_input` | `{ runId, stepRunId, stepId, formSchema }` | User input needed |
| `playbook:step:awaiting_approval` | `{ runId, stepRunId, stepId, prompt, currentOutput }` | Approval gate hit |
| `playbook:step:invalidated` | `{ runId, stepRunId, stepId }` | Downstream invalidation after edit |

Subaccount-scoped room also receives a coarse `playbook:run:status` for dashboard updates.

**Event envelope (all playbook WS events share this shape):**

```jsonc
{
  "eventId": "uuid",        // unique per emission; client uses for dedup
  "runId": "uuid",
  "sequence": 47,           // monotonic per run, assigned at emit time
  "emittedAt": "iso8601",
  "type": "playbook:step:completed",
  "payload": { ... }
}
```

**Per-run sequence number** is allocated by a small `playbook_run_event_sequences` Postgres counter (incremented in the same transaction that mutates the step run row, so the sequence is always consistent with the underlying state). Clients buffer events and apply them in `sequence` order, dropping any duplicates by `eventId`. If a gap is detected (e.g. seq 45 received, then seq 47 with no 46), the client falls back to `GET /api/playbook-runs/:runId` to refetch full state — Phase 1 favours simplicity over a gap-fill protocol. **Phase 1.5 adds an incremental replay endpoint** `GET /api/playbook-runs/:runId/events?sinceSequence=N` that returns just the missed events; the client integrates them without a full refetch. Phase 1 ships with the sequence numbers and the eventId so the wire format is forward-compatible. The sequence counter survives reconnects: on reconnect, the client supplies the last seen sequence and the server replays any newer events (or, in Phase 1, the client just refetches).

The `playbook_run_event_sequences` table is a single column `(run_id pk, last_sequence bigint)`. Allocated values are stored on the events themselves; the table is just the counter source.

### 8.3 Audit events

| Action | Resource |
|--------|----------|
| `playbook_template.published` | `playbook_templates/{id}` (with version) |
| `playbook_template.forked` | `playbook_templates/{id}` |
| `playbook_run.started` | `playbook_runs/{id}` |
| `playbook_run.cancelled` | `playbook_runs/{id}` |
| `playbook_step.output_edited` | `playbook_step_runs/{id}` (includes downstream invalidated count) |
| `playbook_step.approval_decided` | `playbook_step_runs/{id}` |

### 8.4 Logging & observability

Every tick, dispatch, and step transition emits a structured log via the existing `logger` with these required fields:

| Field | Source |
|-------|--------|
| `correlationId` | AsyncLocalStorage from the originating request, or `playbook-watchdog:{runId}` for sweeps |
| `runId` | always |
| `templateSlug`, `templateVersion` | always |
| `stepId`, `stepRunId`, `attempt` | when relevant |
| `subaccountId`, `organisationId` | always |
| `event` | one of: `tick.start`, `tick.dispatch`, `tick.idle`, `step.dispatched`, `step.completed`, `step.failed`, `step.invalidated`, `run.started`, `run.completed`, `run.failed`, `run.cancelled`, `watchdog.recovered`, `mid_run_edit.applied`, `mid_run_edit.blocked` |
| `durationMs` | for completion events |

### 8.5 Metrics

Emitted via the existing metrics pipeline. **Every metric below carries an `is_replay: true|false` tag** so analytics can filter replay runs out of production dashboards. Replay runs still emit the full event stream for parity with live runs.

| Metric | Type | Tags |
|--------|------|------|
| `playbook.runs.started` | counter | `org_id`, `template_slug` |
| `playbook.runs.completed` | counter | `org_id`, `template_slug`, `outcome` (completed/failed/cancelled) |
| `playbook.runs.duration_ms` | histogram | `template_slug` |
| `playbook.steps.dispatched` | counter | `template_slug`, `step_type` |
| `playbook.steps.duration_ms` | histogram | `template_slug`, `step_id` |
| `playbook.steps.parse_retries` | counter | `template_slug`, `step_id` |
| `playbook.invalidations.cascade_size` | histogram | `template_slug` — number of downstream steps invalidated by a single edit |
| `playbook.invalidations.firewall_stops` | counter | `template_slug` — output-hash matches that prevented further propagation |
| `playbook.watchdog.recovered_runs` | counter | — number of stuck runs the sweep self-healed |
| `playbook.cost_breaker.blocks` | counter | `org_id`, `template_slug` |
| `playbook.parallelism_factor` | histogram | `template_slug` — average concurrent step count during a run |
| `playbook.steps.awaiting_input_duration_ms` | histogram | `template_slug`, `step_id` — measured at completion (or current age via watchdog) |
| `playbook.steps.awaiting_approval_duration_ms` | histogram | `template_slug`, `step_id` |
| `playbook.steps.awaiting_input_stuck` | gauge | `template_slug`, `step_id` — count of step runs awaiting input older than 24h |
| `playbook.steps.awaiting_approval_stuck` | gauge | `template_slug`, `step_id` — count of step runs awaiting approval older than 48h |

**Stuck-awaiting alerts.** The watchdog sweep (§5.7) also scans for step runs in `awaiting_input` or `awaiting_approval` and updates the gauges above. Alert thresholds: page on `awaiting_input > 24h` and `awaiting_approval > 48h`. These are warnings, not errors — the run isn't broken, the human is. Alert routes to the run's starting user and any subaccount admins.

### 8.6 Tracing

Spans wrap each tick and each step dispatch. Step spans link to the underlying agent run span via the existing trace context. Watchdog ticks are traced separately so they don't pollute user-initiated trace timelines.

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
- Toast / notification system → existing.
- Confirmation dialogs → existing modal system.

### 9.6 Mid-run edit UX (the safety-critical flow)

When a user clicks **Edit** on a completed step:

1. **Edit modal opens** with the current output rendered as a form derived from the step's `outputSchema`. User edits and clicks Save.
2. Client `POST`s the new output without confirmation flags.
3. If the server returns **200**, the modal shows a success toast with "N steps will re-run, est. cost $X" and closes.
4. If the server returns **409**, the modal expands to a **safety review pane**:
   - List of affected downstream steps grouped by `sideEffectType`.
   - For each `irreversible` step: previous output preview, three radio options — `Re-run anyway`, `Skip and reuse previous`, `Cancel edit`.
   - For each `reversible` step: simpler confirm/skip toggle.
   - For `none`/`idempotent`: shown as informational ("will re-run automatically").
   - Total estimated cost banner at the top, plus **cascade summary**: "7 steps will re-run, longest re-execution path is 4 steps (~3 min)". Helps the user feel the blast radius before clicking Apply.
5. User makes their choices and clicks **Apply**. Client re-`POST`s with the appropriate `confirmIrreversible` / `confirmReversible` / `skipAndReuse` arrays.
6. Server validates the choices cover all blocked steps and applies the edit.

Cancelling the modal at any point leaves the run untouched.

### 9.7 Live updates

`PlaybookRunDetail` joins the `playbook-run:{runId}` WebSocket room on mount and leaves on unmount. Reducer applies events to local state:

- `playbook:step:dispatched` → set step status to `running`
- `playbook:step:completed` → update output, status `completed`, animate the row
- `playbook:step:awaiting_input` → status flip + scroll to row + focus form
- `playbook:step:invalidated` → grey out the row + show "re-running" indicator
- `playbook:run:status` → update header

No polling. The list page (`SubaccountPlaybookRuns`) does a single fetch on mount and listens to the subaccount-level coarse status events.

### 9.8 Empty / loading / error states

Every page handles all four states:

| State | Behaviour |
|-------|-----------|
| Loading | Skeleton matching the final layout (no spinners) |
| Empty (no runs) | Friendly empty state with a CTA to start one |
| Error (fetch failed) | Inline error with retry button |
| Permission denied | Hide the page from nav; if accessed directly, render the standard 403 page |

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

### 10.7 Human review checklist for AI-authored playbook PRs

When the AI generates a new `*.playbook.ts` file (or significantly edits one), the reviewer must verify:

- [ ] Every step has `sideEffectType` declared (CI catches this but worth eyeballing)
- [ ] `irreversible` steps are correctly classified — review every external API call carefully
- [ ] `humanReviewRequired: true` is set on any step whose output a human would want to tweak
- [ ] `dependsOn` graph matches the intended logical flow (check for missed parallelism opportunities)
- [ ] Template expressions only reference declared dependencies (validator catches this)
- [ ] `outputSchema` is tight enough to catch garbage from the LLM but loose enough to not over-constrain
- [ ] Prompts include enough context from the run (don't assume the agent has memory)
- [ ] `version` field is bumped if editing an existing playbook
- [ ] No secrets, customer data, or hardcoded org-specific values in the prompts

The PR description should explain the playbook's purpose in one paragraph and any non-obvious step dependencies.

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
- **Parallelism cap** — DAG with 20 ready steps dispatches only `MAX_PARALLEL_STEPS` (default 8); remainder dispatch as siblings complete.
- **Context spillover** — step output exceeding `MAX_STEP_OUTPUT_BYTES` is auto-spilled via `inlineTextWriter`; downstream step's templating hydrates the inline ref transparently.
- **Hard context limit** — synthetic playbook accumulating > 1MB context fails with `playbook_context_overflow`.
- **`completed_with_errors` lifecycle** — non-critical step (`failurePolicy: 'continue'`) fails; downstream that doesn't depend on it still completes; run terminates `completed_with_errors`.
- **Conditional eval failure** — malformed condition expression fails with `playbook_dag_invalid:conditional_eval_failed`; run respects step failure policy.
- **Conditional output schema mismatch** — `trueOutput` shape doesn't match `outputSchema` → fails with `playbook_schema_violation:conditional_output_invalid`.
- **Kill switch (org suspended)** — running playbook is cancelled within 60s of org suspension via watchdog; in-flight steps get AbortController.
- **Kill switch (subaccount)** — same as above for subaccount-level kill switch.
- **Agent deleted mid-run** — system agent referenced by an `agent_call` step is soft-deleted between dispatches; next dispatch fails with `playbook_template_drift:agent_deleted_mid_run`.
- **Replay mode** — replay run produces identical step outputs from source run; conditional re-evaluation matches; no external calls fired (verify via mock spies on agent run service).
- **Replay drift detection** — modify a stored conditional input between source and replay → replay fails with `playbook_replay_drift:conditional_diverged`.
- **WebSocket sequence ordering** — events emitted in order 45, 46, 47; client receives 47 then 45 then 46; reducer applies in correct order; duplicate `eventId` is dropped.
- **Per-step retry policy override** — step with `retryPolicy.maxAttempts: 1` does not retry on transient error; step without override retries up to default.
- **Irreversible no-retry** — `irreversible` step with transient error fails immediately; validator rejects an irreversible step with `retryPolicy.maxAttempts: 3`.
- **Hydration cache** — single step with five expressions referencing same inline ref triggers exactly one hydration; verified via spy on the inline reader.
- **Inline ref GC** — synthetic refs older than retention with no active references are deleted; refs held by replay runs survive.
- **Terminal-path failure** — diamond DAG (A → B / A → C / B+C → D); B fails with `fail_run`, run marked `failed` because D unreachable. Same DAG with B as `continue` and C succeeding → run finishes `completed_with_errors`.
- **Approval version guard** — UI loads step at version=3, upstream edit pushes it to version=5, approve with `expectedVersion=3` returns 409.
- **Output edit version guard** — same as above for the mid-run edit endpoint.
- **Input hash dedup (forward-compat)** — verify `input_hash` is populated; behaviour assertion deferred to 1.5.
- **Cascade summary** — mid-run edit response includes correct `cascade.size` and `criticalPathLength` for a diamond invalidation.
- **Stuck-awaiting alert** — synthetic step in `awaiting_input` for >24h is detected by watchdog and incremented in the gauge.
- **MAX_DAG_DEPTH** — validator rejects a chain of 51 sequential steps.

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

1. Should `agent_call` steps be allowed to spawn handoffs? Currently yes (existing agent system handles it) — but this could blow up token budgets unexpectedly. **Recommend: yes**, with the existing `MAX_HANDOFF_DEPTH=5` limit applying per agent run, plus the `runCostBreaker` ceiling as backstop.
2. Should runs be cancellable mid-step, or only between steps? **Recommend: between steps with mid-step abort attempt**. Mark run as `cancelling`, fire `AbortController` to in-flight steps; if a step completes before cancellation lands, accept its output and then transition to `cancelled`.
3. Versioning model for org forks: linear (v1, v2, v3) or branched (v1, v1.1, v2)? **Recommend: linear**. Branching is YAGNI for Phase 1.
4. Should the inbox surface runs assigned to anyone in the user's permission scope, or only runs the user started? **Recommend: anyone in scope** — playbooks are collaborative.
5. Should we expose a "re-run from step X" feature that re-executes from an arbitrary point without an edit? **Recommend: defer**. The mid-run edit flow already covers the common case ("change something then re-run downstream"), and bare "re-run from here" is the same flow with no-op edit input. Add only if user demand surfaces.
6. How long are completed runs retained? **Recommend: indefinite for now** with a future archival job once storage becomes a concern. `playbook_step_runs` row counts could grow quickly so monitor early.

## 13. Risk Register

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|------|------------|--------|------------|-------|
| R1 | Mid-run edit re-runs an irreversible step and causes real-world side effects (charge / send / publish) | Low | Critical | `sideEffectType` mandatory; default-block irreversible re-runs; explicit per-step opt-in; CI fails if any step lacks classification (§5.4, §11.1) | Engine owner |
| R2 | Templating resolver enables prototype pollution → RCE | Low | Critical | `Object.create(null)` contexts; blocklist `__proto__`/`constructor`/`prototype`; whitelist top-level prefixes; unit test suite for every blocked path; validator rejects offending expressions at publish time (§3.3) | Engine owner |
| R3 | Tick storms exhaust pg-boss / connection pool under wide-fan-out playbooks | Medium | High | `singletonKey: runId` collapses redundant ticks at queue level; non-blocking advisory lock no-ops on contention; load test with a 50-step diamond DAG (§5.6) | Engine owner |
| R4 | Engine misses a tick after step completion → run permanently stuck | Medium | High | Step completion + tick enqueue in single transaction; watchdog sweep every 60s as safety net (§5.7); alert on `playbook.watchdog.recovered_runs > 0` | Engine owner |
| R5 | Cost runaway from invalidation cascades | Medium | High | `runCostBreaker` enforced before every dispatch; pre-flight estimate at run start; mid-run edit dry-run preview shows cost before applying; output-hash firewall stops propagation when output is unchanged (§5.4, §1.5) | Engine owner |
| R6 | Zod ↔ JSON Schema drift via `z.transform()` causes runtime validation mismatches | Low | Medium | CI round-trip check on every seeded playbook's `outputSchema` (§11.1); ban `.transform()` in step output schemas via lint rule | Validator owner |
| R7 | Schema drift between template publish and run start (e.g. system agent renamed) | Low | Medium | Re-run validator at run start (§4.5); resolved agent ids cached on the run row (§3.4); migration of an in-flight run is impossible (locked to `template_version_id`) | Engine owner |
| R8 | Concurrent ticks double-dispatch a step | Very low | Medium | Three layers of defense: queue dedup, advisory lock, optimistic state guard with `version` column (§5.6) | Engine owner |
| R9 | Org-authored playbooks contain prompt injection that manipulates the agent | Medium | Medium | Existing policy engine and skill executor processor pipeline apply unchanged; agent system already handles untrusted prompts; document the threat model in admin docs | Security review |
| R10 | Forked templates drift from upstream and orgs ignore upgrade banners | High | Low | Phase 1.5 parameterization layer reduces fork count for the 80% case; banner is a visible nag, not blocking | Product |
| R11 | Engine throughput hits ~10k concurrent run ceiling | Very low (years away) | Medium | Monitor metrics; revisit Temporal/Inngest decision when 3+ adopt-threshold criteria are met (§1.4) | Eng leadership |
| R12 | Migration 0074 conflicts with a parallel feature branch's schema work | Low | Low | Coordinate migration number assignment via the feature-coordinator pipeline before opening PR | Implementer |
| R13 | Run context grows unbounded → multi-MB rows, token bloat, slow ticks | Medium | High | `MAX_STEP_OUTPUT_BYTES` auto-spills via `inlineTextWriter`; `MAX_CONTEXT_BYTES_HARD` fails the run; per-step context projection planned for 1.5 (§3.6, §5.12) | Engine owner |
| R14 | Wide DAG (e.g. 20 parallel steps) launches 20 concurrent agent runs → rate limits + cost spike | Medium | High | `MAX_PARALLEL_STEPS` per-run cap (default 8); excess steps stay pending and dispatch as siblings complete (§5.2) | Engine owner |
| R15 | Conditional step has malformed expression or wrong-shape output → silent corruption | Low | Medium | Tightened §5.2 conditional dispatch validates against `outputSchema`, catches eval errors, persists `evaluationMeta` for audit | Engine owner |
| R16 | Run continues executing after org suspended or kill switch tripped | Low | High | Tick begins with kill switch check (§5.11); watchdog re-checks on every sweep cycle | Engine owner |
| R17 | Resolved agent deleted mid-run → opaque DB error on dispatch | Low | Medium | Re-verify cached agent id immediately before each dispatch; fail with `playbook_template_drift` (§3.4) | Engine owner |
| R18 | WebSocket events arrive out of order or duplicated, client UI shows stale state | Medium | Low | Per-run monotonic `sequence` + `eventId` envelope; client dedups and orders; gap → refetch (§8.2) | Client owner |
| R19 | Step references same inline ref multiple times → repeated disk reads, slow tick | Medium | Low | Per-step hydration cache `Map<inlineRefId, value>` cleared on step completion (§3.6) | Engine owner |
| R20 | Inline ref blob storage grows unbounded | Medium | Medium | `playbook-inline-ref-gc` cron with `INLINE_REF_RETENTION_DAYS = 90`; respects active runs and replay clones (§3.6) | Ops owner |
| R21 | Retry policy on irreversible step causes duplicate side effects | Low | Critical | Validator rule 12 rejects at publish; runtime backstop blocks dispatch with `playbook_irreversible_blocked:retry_attempt_blocked` (§4.1, §3.7) | Engine owner |
| R22 | Failure propagation incorrectly marks `failed` instead of `completed_with_errors` on diamond DAGs | Medium | Medium | Terminal-path reachability algorithm in §5.2.1 replaces local sibling check; explicit unit test for diamond + branch + failed-on-one-arm | Engine owner |
| R23 | Approval / edit race: user approves a step that was just invalidated by an upstream edit | Medium | Medium | `expectedVersion` optimistic-concurrency guard on approve, output edit, and input submit endpoints (§7) | Engine owner |
| R24 | Replay output mistaken for production data by downstream consumers | Low | High | `_meta.isReplay = true` envelope on every replay output; persistent UI banner; consumers contractually responsible for honouring (§5.10) | Engine owner + Integrators |
| R25 | Long-pending `awaiting_input` / `awaiting_approval` steps go unnoticed | High | Low | Watchdog updates stuck gauges; alert thresholds 24h / 48h route to starting user + subaccount admins (§8.5) | Ops owner |
| R26 | Pathological AI-generated DAG with thousands of step depth blows worst-case duration | Low | Medium | `MAX_DAG_DEPTH = 50` validator rule (§4.1 rule 13) | Validator owner |

## 14. Final Review Checklist

Before this spec is approved for implementation, every reviewer should sign off on the following:

### Architecture
- [ ] DAG model is the right shape for the use case (vs. linear-only or graph-with-loops)
- [ ] Three-tier distribution (system → org → run) matches existing agent system semantics
- [ ] All seven new tables are necessary; no consolidation possible
- [ ] Engine reuses existing infrastructure (`agentRunService`, `reviewItems`, `pg-boss`, `withBackoff`, `runCostBreaker`, `failure`, WebSocket rooms, audit) without bypass
- [ ] Phase 1.5 parameterization plan is credible — `params_json` column reservation is the only Phase 1 cost

### Safety
- [ ] Side-effect classification is enforced at definition time, not just at edit time
- [ ] Mid-run editing flow blocks irreversible re-execution by default
- [ ] Dry-run cost preview is shown before any cascading invalidation
- [ ] Cascade summary (size + critical path) is shown alongside cost
- [ ] Templating resolver hardening prevents prototype pollution at every layer
- [ ] Cost breaker is called on every dispatch boundary
- [ ] All failure paths route through the `failure()` helper
- [ ] Validator rejects retryable irreversible steps; runtime backstop also blocks
- [ ] `expectedVersion` guard on approve / edit / input prevents stale-UI overwrites
- [ ] Replay outputs carry `_meta.isReplay = true` envelope

### Reliability
- [ ] Three-layer concurrency control is correct (queue dedup → advisory lock → optimistic guard)
- [ ] Watchdog sweep covers every "step done but no tick" failure mode
- [ ] Step completion + tick enqueue are transactional
- [ ] Run state survives server restart (verified by integration test in §11)
- [ ] Cancellation semantics are well-defined and tested
- [ ] `MAX_PARALLEL_STEPS` cap prevents fan-out spikes
- [ ] Context size limits + spillover via `inlineTextWriter` are wired and tested
- [ ] Kill switch is checked at every tick start AND watchdog cycle
- [ ] Resolved agent ids are re-verified immediately before each dispatch
- [ ] WebSocket events carry monotonic sequence + eventId for client dedup
- [ ] `completed_with_errors` lifecycle path is tested with `failurePolicy: 'continue'` steps

### Authoring
- [ ] File-based authoring is the right Phase 1 choice (vs. DB-native or YAML)
- [ ] AI authoring loop is realistic — existing playbooks serve as in-context examples
- [ ] Validator runs at every meaningful boundary (seeder, publish, run start, optional pre-commit)
- [ ] Versioning rules prevent silent reverts

### Operability
- [ ] Logging fields are sufficient for debugging a stuck run from the logs alone
- [ ] Metrics cover the key dashboards (run throughput, parallelism, cascade size, cost breaker blocks, watchdog recoveries)
- [ ] Feature flag plan allows controlled rollout per org
- [ ] Rollback plan is documented (down migration + flag disable)

### Sign-off

| Role | Name | Date | Notes |
|------|------|------|-------|
| Tech lead | | | |
| Product | | | |
| Security | | | |
| Eng manager | | | |

---

**End of spec.** Once all sign-offs are recorded above, this spec is approved for implementation and should be handed to the `feature-coordinator` agent to drive the Phase 1 pipeline per `CLAUDE.md` § Local Dev Agent Fleet.
