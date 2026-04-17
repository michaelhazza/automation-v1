# Orchestrator Capability-Aware Routing — Development Specification

> **Status:** Draft
> **Author:** AI-assisted (session 2026-04-17)
> **Last updated:** 2026-04-17 (revision 2 — integrates external review findings: decomposition validation, Path A coverage semantics, Integration Reference confidence, Config Assistant handoff contract, feedback loop)
> **Branch:** `claude/orchestrator-spec-doc-sEY3w`

---

## Table of Contents

1. [Overview and Goals](#1-overview-and-goals)
2. [Decision Model and Routing Paths](#2-decision-model-and-routing-paths)
3. [Integration Reference Doc](#3-integration-reference-doc)
4. [Capability Discovery Skills](#4-capability-discovery-skills)
5. [Gap Analysis and Feature Requests](#5-gap-analysis-and-feature-requests)
6. [Orchestrator Prompt Rewrite and Config Assistant Handoff](#6-orchestrator-prompt-rewrite-and-config-assistant-handoff)
7. [Task Board Trigger](#7-task-board-trigger)
8. [User-Facing UX](#8-user-facing-ux)
9. [Phasing, Testing, and Rollout](#9-phasing-testing-and-rollout)
10. [Open Questions and Appendices](#10-open-questions-and-appendices)

---

## 1. Overview and Goals

### What this is

A set of orchestrator intelligence upgrades that let the Orchestrator agent answer, at runtime, three questions about any inbound user request:

1. **Is this already configured?** — Is there an existing agent or linked skill set in this org/subaccount that can handle this request today?
2. **Is this configurable?** — Does the platform have the necessary integration, skills, and primitives to fulfil this request, even if the current org hasn't configured it yet?
3. **Is this broadly valuable or specific to this client?** — If configurable, does the underlying pattern look like something that would help the whole customer base, or is it narrow to this one subaccount?

Based on the answers, the Orchestrator routes the task into one of four paths: execute immediately, hand off to the Configuration Assistant, hand off to the Configuration Assistant _and_ flag the pattern as a system-promotion candidate, or file a platform feature request for the Synthetos team.

### Why this exists

Today the Orchestrator's routing is static: its system prompt contains a keyword-matching table mapping task domains to agent slugs, and its roster of available agents is a hand-maintained memory block. It cannot query what OAuth connections are active in the current org, what MCP servers are enabled, what skills are available on linked agents, or what the platform is even _capable_ of doing. When a user creates a task that doesn't match any keyword, the Orchestrator flags it for human attention and stops. This is the behaviour a user experiences as _"the platform didn't try"_.

The canonical use case that motivated this spec: a user creates a task that says _"I want my Gmail inbox labelled into LEADS, CLIENTS, JUNK, INVOICES on a five-minute loop"_. The platform currently has most of the primitives needed to deliver this (Gmail OAuth, scheduling, the Configuration Assistant, a classify_email skill), but the Orchestrator has no way to discover that and assemble the workflow. So the task sits in the backlog.

More broadly, the same blindness applies every time a user asks for anything that isn't already pre-wired — every new agent setup is a manual journey through admin pages. The Configuration Assistant was built to solve that, but nothing currently routes users to it automatically based on task intent.

### Goals

1. **Capability awareness** — The Orchestrator can determine at runtime what integrations, skills, and agents are available, both at the platform level (what CAN we do) and at the org level (what IS configured).
2. **Intelligent routing** — Every inbound task is routed into one of the four paths based on real capability data, not static keyword matching.
3. **Config Assistant as first-class handoff target** — The Orchestrator hands tasks to the Configuration Assistant through the existing `spawn_sub_agents` pathway whenever the request is configurable but not yet configured.
4. **Product telemetry from user intent** — When the Orchestrator sees the platform can't fulfil a request, or sees a configurable pattern that looks broadly useful, it writes a structured feature request so the Synthetos team gets the signal.
5. **Integration-agnostic by design** — Nothing in the implementation is Gmail-specific. The same decision tree, skills, and doc structure apply to every integration now and in the future.
6. **Discoverable for future agents** — Any agent, not just the Orchestrator, can call the capability discovery skills. This becomes a platform primitive.

### Non-goals

- **Not a replacement for the canonical data platform spec** (`docs/routines-response-dev-spec.md`). That spec is about building the canonical data layer (email, contact, deal ingestion). This spec is about making the Orchestrator smart enough to route tasks against whatever capabilities exist. The two ship independently.
- **Not a new agent runtime.** The Orchestrator keeps its current execution model — this is new skills, a new doc, new schema, and prompt edits. No agentic framework changes.
- **Not a replacement for manual configuration.** Admins can still configure agents through the UI. This gives the platform an intelligent default when a user prefers describing the outcome rather than clicking through setup.
- **Not a natural-language queryable knowledge graph.** The Integration Reference doc is a static, human-maintained, machine-parseable file. No ontology, no RAG retrieval, no vector DB. Read the doc, parse the YAML, make decisions.
- **Not a Config Assistant rewrite.** The Configuration Assistant spec (`docs/configuration-assistant-spec.md`) is the contract. This spec consumes that contract — it does not modify it.
- **Not a cross-org signal aggregation layer.** Feature requests are captured per-org with full attribution. The Synthetos team reads them and decides what to do. We do not build dashboards, clustering, or deduplication in this spec. Those come later if volume justifies them.

### Success criteria

The spec is a success if, once implemented, the Gmail inbox-labelling example (and the three other scenarios in §2) run end-to-end without any code changes specific to Gmail:

- User creates a task in the task board describing the desired outcome.
- Orchestrator picks up the task via its new trigger, reads the Integration Reference doc, queries current org configuration, classifies the request into one of the four paths.
- For the configurable path: Orchestrator spawns the Configuration Assistant as a sub-agent with the task context; Config Assistant runs its own plan-approve-execute loop; the configured agent takes over.
- For the unsupported path: Orchestrator posts a task comment and chat message explaining the gap, then writes a `feature_requests` row with full attribution.
- For the system-promotion path: the configurable path fires and, simultaneously, a `feature_requests` row with `category = 'system_promotion_candidate'` is written.

Every one of these paths works identically for any integration in the Integration Reference doc. No code branch says `if integration === 'gmail'`.

---

## 2. Decision Model and Routing Paths

### The four paths

Every task the Orchestrator picks up is classified into exactly one of these paths. The classification is emitted as a structured decision record (§6.4) so runs are auditable.

| Path | Name | Trigger condition | Outcome |
|---|---|---|---|
| **A** | Already configured | The org or subaccount has a linked agent whose skill set covers the required capabilities | Orchestrator routes the task directly to that agent via `spawn_sub_agents` (existing behaviour, but now driven by capability match rather than keyword match) |
| **B** | Configurable — narrow pattern | The platform supports every required capability, but the current org has not configured it. The request pattern looks client-specific (one client's data, one integration, one workflow) | Orchestrator hands off to the Configuration Assistant via `spawn_sub_agents`, passing the task as context. Config Assistant runs its own plan-approve-execute flow. No feature request filed. |
| **C** | Configurable — broad pattern | Same as B, but the request pattern looks broadly useful (generic workflow shape, no client-specific data, reusable across orgs) | Same handoff as B, _plus_ a `feature_requests` row is written with `category = 'system_promotion_candidate'` so the Synthetos team can consider promoting the pattern to a system-level agent or skill. |
| **D** | Unsupported | At least one required capability is not available in the platform (no OAuth provider, no MCP server, no skill) | Orchestrator posts a structured task comment and chat message explaining the gap, writes a `feature_requests` row with `category = 'new_capability'`, and closes the task with status `blocked_on_feature_request`. |

### Required capabilities, not inferred capabilities

The Orchestrator classifies against _required capabilities_ — the concrete list of integrations, skills, and primitives the task needs — not against free-form intent.

A request like _"label my Gmail inbox into LEADS, CLIENTS, JUNK on a five-minute loop"_ decomposes into:

- `integration: gmail` — required
- `read_capability: inbox_read` — required
- `write_capability: modify_labels` — required
- `skill: classify_email` — required
- `primitive: scheduled_run` — required

The Orchestrator calls capability discovery skills (§4) to answer _"are these available?"_ for the current org and the platform. The classification is deterministic once the required-capability list is known.

### Decomposition, not intent matching

Capability decomposition is an LLM step (the Orchestrator uses its model to turn natural-language task text into a required-capability list), but the _classification_ that follows is not. Given the list, the skills return yes/no answers and the routing decision is a pure function of those answers.

This matters because the classification must be auditable and reproducible. A human reviewing a routing decision should be able to see: _"here is the list of required capabilities the Orchestrator extracted, here is the availability map, here is the resulting path."_ If the LLM got the decomposition wrong, that is fixable and observable. If routing itself was fuzzy, it would not be.

### Decomposition is a three-stage pipeline, not a single LLM call

Treating decomposition as one freeform LLM step is the single biggest failure mode in this design. An LLM asked for "required capabilities" will produce synonyms, misspelled slugs, extra capabilities that aren't really needed, or miss capabilities that are. Any of those failures corrupts the classification that follows.

To contain the risk, decomposition runs as a deterministic three-stage pipeline:

1. **LLM decomposition** — The Orchestrator's LLM turn extracts a draft required-capability list from the task text. Output is a list of `{kind, slug}` pairs along with a free-text `rationale` per capability.
2. **Normalisation** — Draft slugs are mapped to canonical slugs via a **capability taxonomy registry** (see §3.7). Synonyms (`"gmail-api"` → `"gmail"`, `"inbox_reading"` → `"inbox_read"`) and known aliases are resolved deterministically. Any slug that does not resolve is carried forward with a `normalisation_status: 'unresolved'` flag rather than silently dropped.
3. **Validation** — The normalised list is cross-checked against `list_platform_capabilities` output. Every slug must either exist in the Integration Reference or be marked `validation_status: 'unknown'`. Unknown slugs trigger a one-shot re-decomposition turn (§6.4.2) where the LLM is re-prompted with the platform's actual catalogue and asked to reconcile. If re-decomposition still leaves unknown slugs, the task is treated as Path D (unsupported) — the platform reliably does not support what the user is asking for.

Only after the pipeline succeeds does the Orchestrator call `check_capability_gap`. The pipeline output — draft list, normalisations applied, validation results, retries consumed — is written into the decision record (§6.5) so post-hoc debugging of a bad route is straightforward: you see exactly where the pipeline made each choice.

This converts the LLM from _"extract the correct answer"_ to _"propose an answer the deterministic layer can verify"_. The deterministic layer always has the last word.

### Path A requires explicit capability coverage, not LLM judgement

The decision model's most tempting failure mode is _"this agent is probably in the right domain, let's route to it"_. That's keyword routing wearing a new coat. Path A is gated by explicit subset matching, not fuzzy coverage.

Every linked agent has a **capability map** computed from its active skill set and the integrations it references:

```typescript
agent_capability_map = {
  agentId: string;
  integrations: string[];         // slugs of integrations the agent's skills rely on
  read_capabilities: string[];    // from skills_enabled declarations in the Integration Reference
  write_capabilities: string[];
  skills: string[];
  primitives: string[];
}
```

The capability map is a **derived view** computed from existing state (the agent's linked skills, the skills' Integration Reference entries, and the agent's trigger configuration). It is not a new source of truth — it is a lookup the Orchestrator performs deterministically at routing time.

Path A fires only when every entry in the `required_capabilities` list appears in the candidate agent's capability map, for every capability kind. Partial coverage is _not_ Path A; partial coverage routes to Path B so the Configuration Assistant can close the gap explicitly. A task that needs `{integration: gmail, write: modify_labels}` against an agent whose map contains `{integration: gmail, read: inbox_read, skill: classify_email}` but not `write: modify_labels` is Path B, not Path A. The difference is the one between _"executes correctly"_ and _"starts and fails mid-run"_.

If multiple agents pass the coverage check, the Orchestrator picks the most specific: fewer extra capabilities beyond the required set, most recently updated, or explicitly preferred via a per-org routing hint. Ties fall through to a Configuration Assistant handoff (Path B) so the user can decide.

### The three knowledge layers the Orchestrator reads

The decision model depends on three sources of truth, in this order of precedence:

1. **Integration Reference doc (§3)** — "What CAN the platform do?" Static, human-maintained, machine-parseable. Served to the Orchestrator via the `list_platform_capabilities` skill (§4.2). Source of truth for what integrations, skills, scopes, and setup requirements exist at all.
2. **Live org/subaccount state (§4)** — "What HAS the current org configured?" Queried at runtime through `list_connections` and the existing `config_list_agents` / `config_list_links` skills. Source of truth for what is available to this specific caller right now.
3. **Orchestrator system prompt (§6)** — "How do I classify a request into a path?" Static guidance. Source of truth for how the Orchestrator reasons about required-capability lists, platform-vs-org availability, and narrow-vs-broad pattern judgement.

Layer 1 is platform truth. Layer 2 is tenant truth. Layer 3 is decision policy. If any layer drifts out of sync with the others, the routing gets worse in predictable ways: stale doc → orchestrator undersells capability; stale live-state skills → orchestrator hallucinates configuration; stale prompt → orchestrator misroutes. The maintenance discipline for all three is spelled out in §3.5 and §6.5.

### Worked example: the Gmail inbox-labelling task

Given task text _"I want my Gmail inbox labelled into LEADS, CLIENTS, JUNK, INVOICES on a five-minute loop"_:

1. **Decomposition:** Orchestrator extracts required capabilities `{integration: gmail, read: inbox_read, write: modify_labels, skill: classify_email, primitive: scheduled_run}`.
2. **Platform check:** `list_platform_capabilities` returns that Gmail OAuth is wired, `inbox_read` is available via the Gmail adapter (per canonical data platform P4), `modify_labels` is available via the `modify_email_labels` skill (per the P4 addition agreed in the canonical spec), `classify_email` is an existing system skill, `scheduled_run` is a first-class primitive. All required capabilities are available at the platform level. Path is B, C, or D.
3. **Org check:** `list_connections` returns no active Gmail OAuth connection for this org. `config_list_agents` shows no linked agent covers this shape. Not configured. Path is B or C.
4. **Pattern judgement:** Orchestrator prompt applies the narrow-vs-broad heuristic (§6.3). The request matches a common shape ("inbox triage") with no client-specific data in the task text. Classified as C.
5. **Route:** Orchestrator spawns the Configuration Assistant with the task as context _and_ writes a `feature_requests` row with `category = 'system_promotion_candidate'`, `summary = 'Inbox triage agent (Gmail)'`, `source_task_id = <task.id>`.
6. **Downstream:** Configuration Assistant runs its own plan-approve-execute flow, walks the user through Gmail OAuth, creates/links an agent with the right skills and schedule. Separately, the Synthetos team sees the system-promotion signal and decides whether to promote "inbox triage" to a system-level agent template.

Contrast with a hypothetical _"please send a weekly summary of my Acme Corp Monday board via fax"_:

- Decomposition: `{integration: fax, primitive: scheduled_run}`.
- Platform check: no fax integration in the Integration Reference. Path D.
- Route: task comment explaining the gap, chat message, `feature_requests` row with `category = 'new_capability'`, task status `blocked_on_feature_request`.

---

## 3. Integration Reference Doc

### 3.1 Purpose

A single machine-parseable document describing every integration the platform supports — what it is, what it enables, what it costs the user to set up, and what its current status is. The document is the source of truth for `list_platform_capabilities` (§4.2) and the only place the Synthetos team updates when integration state changes.

This file closes the documentation gap the audit surfaced: today the facts about integrations live scattered across `server/config/oauthProviders.ts`, `server/config/mcpPresets.ts`, the skill markdown files, and tribal knowledge. No single doc answers _"what can the platform do?"_ at a level an agent can act on.

### 3.2 File location and format

Path: `docs/integration-reference.md`

Format: a markdown document containing one fenced YAML block per integration. Each block represents a single integration entry in a flat list. The choice of markdown-with-embedded-YAML (rather than a pure `.yaml` file) keeps the doc human-readable for the Synthetos team while preserving machine-parseability — the parser looks for fenced blocks tagged `yaml integration`.

```
# Integration Reference

<free-form prose preamble explaining the doc's purpose and maintenance rules>

```yaml integration
slug: gmail
name: Gmail
provider_type: oauth
...
```

```yaml integration
slug: slack
name: Slack
provider_type: oauth
...
```
```

The first YAML block on the page is the schema version block (`yaml integration_reference_meta`) which carries a `schema_version` field. The parser asserts schema compatibility before reading any integration blocks.

### 3.3 Schema

Every integration block conforms to this schema:

```yaml
slug: string                      # stable identifier, matches OAuth provider slug / MCP preset slug
name: string                      # display name
provider_type: enum               # oauth | mcp | webhook | native | hybrid
status: enum                      # fully_supported | partial | stub | planned
visibility: enum                  # public | internal | beta

# What the integration enables
read_capabilities: string[]       # e.g. ['inbox_read', 'contact_list', 'deal_list']
write_capabilities: string[]      # e.g. ['send_email', 'modify_labels', 'create_contact']
skills_enabled: string[]          # skill slugs from server/skills/ that use this integration
primitives_required: string[]     # e.g. ['scheduled_run', 'webhook_receiver']

# Setup contract
auth_method: enum                 # oauth2 | api_key | none | mcp_token
required_scopes: string[]         # OAuth scopes or MCP scopes the integration requires
setup_steps_summary: string       # one-sentence human summary used in task comments
setup_doc_link: string            # optional pointer to a more detailed setup guide

# Orchestrator guidance
typical_use_cases: string[]       # short phrases — used for prompt-level matching
broadly_useful_patterns: string[] # phrases that indicate system-promotion candidates
known_gaps: string[]              # capabilities users often expect that are NOT supported
client_specific_patterns: string[]# phrases that indicate narrow client-specific usage

# Operational truth
implemented_since: string         # date when the integration first shipped
last_verified: string             # date the Synthetos team last confirmed the entry is accurate
owner: string                     # internal team or person accountable for the entry
```

All fields are required unless explicitly marked optional. A missing or mismatched field causes `list_platform_capabilities` to flag the doc as invalid and fall back to a safe default (treat the integration as `status: stub`).

### 3.4 Core subset to ship in the first pass

The doc ships with entries for the integrations that cover the highest-value and most-demanded workflows. The selection is deliberately conservative — the goal is to prove the schema and the orchestrator routing against a realistic subset, not to achieve full catalogue coverage in the first sprint.

The architect review will finalise the list. Proposed starting set (subject to change based on what's actually wired vs partially wired in the codebase):

1. Gmail
2. Google Calendar
3. Slack
4. HubSpot
5. Stripe
6. Monday.com
7. GoHighLevel
8. Notion
9. Airtable
10. A representative MCP preset (e.g. Playwright)

Each additional integration is a separate PR that adds one YAML block. There is no big-bang rollout of the full catalogue.

### 3.5 Maintenance discipline

This is the hardest part of the spec to get right. A stale Integration Reference is worse than no reference — the Orchestrator will confidently promise capabilities that don't exist or dismiss capabilities that do. The maintenance rules are:

1. **Any PR that changes integration behaviour must update the corresponding integration block _in the same commit_.** Adding an OAuth scope, shipping a new write capability, fixing a status from `stub` to `partial`, adding a new skill slug to `skills_enabled` — all require the YAML update. This is a CLAUDE.md-level obligation that will land in the same session as the spec.
2. **The `last_verified` field is updated every time the Synthetos team reviews the entry.** CI is not expected to keep this honest; the review cadence is human.
3. **A new integration is not considered "shipped" until its block exists.** The definition of done for any integration PR includes the Integration Reference entry.
4. **The schema itself is versioned.** Changes to the field list bump `schema_version` in the meta block. The `list_platform_capabilities` parser asserts schema compatibility and falls back to the nearest compatible version if necessary.
5. **Drift detection is a static gate.** A simple script (`scripts/verify-integration-reference.ts`) cross-checks: every OAuth provider in `oauthProviders.ts` has a block; every MCP preset in `mcpPresets.ts` has a block; every skill in `server/skills/` that declares an integration dependency is listed in the corresponding block's `skills_enabled`. Script runs in `run-all-gates.sh` and fails the gate if drift is detected. Implementation details are in §9.3.

### 3.6 Confidence levels and graceful degradation

The Integration Reference is a **single source of truth** for platform capability, which makes it a **single point of failure** if it gets stale, corrupt, or out of sync with the runtime. The spec protects against this with explicit confidence handling rather than hoping the static gate catches everything.

Every integration block carries an implicit confidence level derived from its metadata:

| Confidence | Trigger | Routing behaviour |
|---|---|---|
| `high` | `status: fully_supported` **and** `last_verified` within the last 30 days **and** the static gate (§3.5) is green at parse time | Orchestrator uses the entry authoritatively |
| `stale` | Any other `status` value, or `last_verified` older than 30 days | Orchestrator uses the entry but downgrades decisions: Path A still fires if coverage matches, but Path D (unsupported) requires a second LLM pass with the entry context before filing a feature request — the doc may simply be behind reality |
| `unknown` | The block fails schema validation, or the slug is referenced by a skill but has no corresponding block | Orchestrator treats the slug as present-but-unverified — does not fire Path D, routes to Path B or human review |

`list_platform_capabilities` (§4.2) returns the confidence level per integration in its output, so downstream skills (`check_capability_gap`) can reason about it without re-deriving.

If the entire reference fails to parse (file missing, YAML malformed, schema version incompatible), the Orchestrator does **not** default to Path D for every task. Instead:

1. A synthetic feature request is filed with `category: 'infrastructure_alert'` (a new category added to the `feature_requests` enum — see §5.2 update) so the Synthetos team is notified immediately.
2. The Orchestrator falls back to **legacy routing** — the pre-existing keyword table and agent roster memory block, kept in the prompt as a dormant fallback branch for exactly this reason (see §6.6).
3. All routing decisions made during the fallback window are tagged `reference_degraded: true` in the decision record so post-incident analysis can isolate them.

This inverts the worst behaviour of a single-source-of-truth system: a broken reference degrades gracefully rather than blocking every inbound task.

### 3.7 Capability taxonomy registry

Capabilities appear as string slugs across multiple integrations. Without a shared taxonomy, one integration's `"read_inbox"` and another's `"inbox_read"` silently fail to match in the coverage check — the Orchestrator thinks neither is configured.

The **capability taxonomy registry** is a single canonical list of capability slugs maintained at `docs/integration-reference.md` under a dedicated `capability_taxonomy` YAML block (separate from the per-integration blocks). Every `read_capabilities`, `write_capabilities`, `skills_enabled`, and `primitives_required` slug referenced in any integration block must appear in the taxonomy. The static gate (§3.5) adds a fourth check enforcing this.

The taxonomy block shape:

```yaml
capability_taxonomy:
  read_capabilities:
    - slug: inbox_read
      aliases: [read_inbox, inbox_reading, email_read]
      description: Read message headers and metadata from a provider's inbox
    - slug: contact_list
      aliases: [contacts_read, list_contacts]
      description: ...
  write_capabilities:
    - slug: modify_labels
      aliases: [apply_label, label_email, change_labels]
      description: ...
  # ... primitives, skills follow the same shape
```

The `aliases` list is what the normalisation step (§2) uses to canonicalise LLM-produced slugs. A new integration introducing a new capability kind must extend the taxonomy in the same PR, not in a follow-up. The taxonomy is a small file; the discipline is the point.

Adding or renaming a capability slug is a schema-level change and bumps `schema_version` in the meta block, same as any other breaking change to the reference.

### 3.8 What the doc is NOT

- **Not a marketing asset.** This lives alongside `docs/architecture.md` as developer- and agent-facing documentation. The customer-facing integration list lives in `docs/capabilities.md` and is narrative, not structured. The two stay aligned but the audiences and tones are different.
- **Not a substitute for per-skill documentation.** Each skill still has its own markdown file in `server/skills/`. The Integration Reference refers to skills by slug; it does not duplicate their content.
- **Not a replacement for `oauthProviders.ts` / `mcpPresets.ts`.** Those files are the runtime source of truth for the auth/connection machinery. The Integration Reference references them but does not replace them. If the two disagree, the runtime code wins and the reference is treated as stale (the static gate in §3.5 exists to catch this).

---

## 4. Capability Discovery Skills

Two new skills give the Orchestrator (and any other agent) runtime visibility into what the platform can do and what the current org has configured. A third skill combines them into a single "can this request be fulfilled?" query (§5.1). A fourth skill files feature requests (§5.3).

All four are registered in `server/config/actionRegistry.ts`, have handler implementations in `server/services/skillExecutor.ts`, and follow the existing skill contract (pure-function handler, typed input/output, permission-gated, audit-logged).

### 4.1 `list_connections`

**Purpose:** Report which integration connections are currently active for a given org or subaccount, with enough metadata to drive capability matching but none of the secret material.

**Input:**

```typescript
{
  scope: 'org' | 'subaccount';
  orgId: string;                    // required
  subaccountId?: string;            // required if scope === 'subaccount'
  include_inactive?: boolean;       // default false
}
```

**Output:**

```typescript
{
  connections: Array<{
    id: string;
    slug: string;                   // matches Integration Reference slug
    provider_type: 'oauth' | 'mcp' | 'webhook' | 'native' | 'hybrid';
    status: 'active' | 'expired' | 'revoked' | 'error';
    connected_at: string;           // ISO timestamp
    scopes_granted: string[];       // for OAuth connections
    last_verified: string;          // last successful token refresh / health check
    // explicitly NOT returned: access tokens, refresh tokens, API keys, any credential
  }>;
  scope_resolved: { orgId: string; subaccountId: string | null };
}
```

**Implementation:** Wraps the existing `integrationConnectionService`. All secret material is stripped by the service layer before the skill returns. The skill calls `resolveSubaccount(subaccountId, orgId)` when `scope === 'subaccount'` (per the architecture rule in CLAUDE.md).

**Permissions:** Available to system-level and org-level agents. The permission check asserts the calling agent has access to the org passed in `orgId`. Subaccount-level agents can only call it with `scope: 'subaccount'` and their own subaccount ID.

**Failure modes:** If `integrationConnectionService` is unavailable, the skill returns `{ connections: [], scope_resolved: ..., error: 'service_unavailable' }` rather than throwing, so the Orchestrator can still make a routing decision (defaulting to "treat as not configured").

### 4.2 `list_platform_capabilities`

**Purpose:** Report the full catalogue of integrations the platform supports, as described by the Integration Reference doc. This is the Orchestrator's primary "what CAN we do?" lookup.

**Input:**

```typescript
{
  filter?: {
    provider_type?: string;         // optional — narrow by provider type
    status?: string;                // optional — narrow by status (e.g. 'fully_supported')
    slug?: string;                  // optional — fetch a single integration
  };
  include_schema_meta?: boolean;    // default false — when true, include schema_version
}
```

**Output:**

```typescript
{
  integrations: Array<{
    // Mirrors the Integration Reference YAML schema exactly (see §3.3)
    slug: string;
    name: string;
    provider_type: string;
    status: string;
    visibility: string;
    read_capabilities: string[];
    write_capabilities: string[];
    skills_enabled: string[];
    primitives_required: string[];
    auth_method: string;
    required_scopes: string[];
    setup_steps_summary: string;
    setup_doc_link: string | null;
    typical_use_cases: string[];
    broadly_useful_patterns: string[];
    known_gaps: string[];
    client_specific_patterns: string[];
    implemented_since: string;
    last_verified: string;
    owner: string;

    // Runtime-computed confidence (see §3.6)
    confidence: 'high' | 'stale' | 'unknown';
    confidence_reason: string;      // short explanation for audit
  }>;
  capability_taxonomy: {            // the §3.7 taxonomy, parsed once, returned with every response
    read_capabilities: Array<{ slug: string; aliases: string[]; description: string }>;
    write_capabilities: Array<{ slug: string; aliases: string[]; description: string }>;
    skills: Array<{ slug: string; aliases: string[]; description: string }>;
    primitives: Array<{ slug: string; aliases: string[]; description: string }>;
  };
  reference_state: 'healthy' | 'degraded' | 'unavailable';  // rollup signal for graceful fallback
  schema_meta?: { schema_version: string; last_updated: string };
}
```

**Implementation:** Reads `docs/integration-reference.md` from disk at request time, parses the fenced YAML blocks, validates against the schema, caches the parsed result in-process with a short TTL (60 seconds) so the Orchestrator's multi-skill calls within a single run don't re-parse the file repeatedly. The TTL is short enough that Synthetos-team edits to the file are picked up within a minute — no restart required.

**Permissions:** Available to any authenticated agent. The information in the reference is not org-scoped and is not sensitive (it's what the doc already says to engineers). A stricter gate can be added later if any field becomes sensitive.

**Failure modes:** If the file is missing or the schema is invalid, the skill returns `{ integrations: [], capability_taxonomy: {...empty lists...}, reference_state: 'unavailable', error: 'integration_reference_invalid', error_detail: <parser error> }`. The Orchestrator, on receiving `reference_state: 'unavailable'`, does **not** default to Path D — instead it falls back to legacy keyword routing (§6.6) and files a `category: 'infrastructure_alert'` feature request. On `reference_state: 'degraded'` (one or more blocks stale or invalid but the overall file parsed), the skill returns the healthy blocks and flags the bad ones per-integration; the Orchestrator continues routing with per-entry confidence downgrades (§3.6).

**Normalisation helper:** The skill also exposes a companion pure function `normalize_capability_slugs(input, taxonomy)` (not a separately-registered skill — a utility imported by `check_capability_gap` and by the Orchestrator's decomposition pipeline). Given a list of draft `{kind, slug}` pairs and the taxonomy, it returns each pair with a canonical slug plus a `normalisation_status: 'canonical' | 'aliased' | 'unresolved'`. Unresolved slugs are preserved as-is so the caller can handle them explicitly (the Orchestrator re-prompts the LLM; `check_capability_gap` marks coverage as unknown).

### 4.3 Reused existing skills

The Orchestrator's decision tree also depends on skills that already exist in the codebase:

- `config_list_agents` — org-level inventory of linked agents. Unchanged; already registered.
- `config_list_links` — subaccount-level agent links. Unchanged; already registered.
- `config_list_system_skills` — catalogue of published system skills. Unchanged.
- `config_list_org_skills` — org-specific skill list. Unchanged.
- `spawn_sub_agents` — the handoff primitive the Orchestrator uses to route to target agents. Unchanged at the contract level; the Orchestrator's usage pattern changes (it now targets the Configuration Assistant for Paths B and C).

Together with `list_connections` and `list_platform_capabilities`, these give the Orchestrator a complete picture: _platform catalogue_ (what can we do), _org configuration_ (what is linked), _current connections_ (what is authenticated), and the handoff primitive (how to act).

### 4.4 Skill registration and permissions

All four new skills (`list_connections`, `list_platform_capabilities`, `check_capability_gap`, `request_feature`) are registered in the action registry with:

- `isSystemSkill: true` — published at the platform level, available to system agents by default.
- `defaultActiveForAgentRoles: ['orchestrator', 'specialist']` — active on Orchestrator and Configuration Assistant by default. Other agents can opt in via link configuration.
- `permissionCheck: 'integration_capability_query'` (new permission key) for `list_connections` and `list_platform_capabilities`; `'integration_capability_gap'` for `check_capability_gap`; `'feature_request_submit'` for `request_feature`. Definitions land in `server/lib/permissions.ts` as part of the implementation.
- `auditLogCategory: 'capability_discovery'` for the three read skills; `'feature_request'` for `request_feature`.

The permission definitions are additive — no existing roles lose or change permissions. System-admin and org-admin roles get all four new permissions. Other roles get none, unless an org explicitly grants them through a custom permission set.

### 4.5 Skill markdown files

Each new skill gets its own markdown file in `server/skills/` following the existing convention:

- `server/skills/list_connections.md`
- `server/skills/list_platform_capabilities.md`
- `server/skills/check_capability_gap.md`
- `server/skills/request_feature.md`

These files describe the skill's purpose, inputs, outputs, and example invocations for the agent consuming them. They are the prompt-facing documentation the LLM sees when the skill is in its toolset.

---

## 5. Gap Analysis and Feature Requests

### 5.1 `check_capability_gap`

**Purpose:** Given a list of required capabilities, return a structured answer: for each one, is it configured, configurable, or unsupported? This is the single skill the Orchestrator calls to produce the routing decision once it has decomposed the task into a required-capability list.

**Input:**

```typescript
{
  orgId: string;
  subaccountId?: string;
  required_capabilities: Array<{
    kind: 'integration' | 'read_capability' | 'write_capability' | 'skill' | 'primitive';
    slug: string;                   // e.g. 'gmail', 'modify_labels', 'classify_email'
  }>;
}
```

**Output:**

```typescript
{
  verdict: 'configured' | 'configurable' | 'unsupported' | 'unknown';
  per_capability: Array<{
    kind: string;
    slug: string;                   // canonical slug after normalisation
    original_slug: string;          // what the caller passed in (pre-normalisation)
    availability: 'configured' | 'configurable' | 'unsupported' | 'unknown';
    confidence: 'high' | 'stale' | 'unknown';  // from the underlying reference entry
    source: 'integration_reference' | 'live_connection' | 'linked_agent' | 'system_skill' | 'not_found';
    detail: string;                 // short human-readable explanation
  }>;
  candidate_agents: Array<{
    agent_id: string;
    agent_name: string;
    coverage: 'full' | 'partial';
    matched: string[];              // capability slugs this agent covers
    missing: string[];               // capability slugs this agent is missing
  }>;
  missing_for_configurable: string[]; // slugs the user would need to set up (e.g. ['gmail:oauth'])
  missing_for_unsupported: string[];  // slugs the platform does not support at all
  reference_state: 'healthy' | 'degraded' | 'unavailable'; // surfaced from list_platform_capabilities
}
```

**Logic:** For each required capability, the skill checks (in order):

1. **Configured** — is there a linked agent whose **capability map** (§2) contains this capability _and_ an active connection (`list_connections`) for the relevant integration? Coverage is subset matching: the full `required_capabilities` list must be a subset of the agent's map for that agent to count as configured. Partial coverage is _not_ configured.
2. **Configurable** — does the Integration Reference (`list_platform_capabilities`) declare that this capability is available at the platform level with `status: fully_supported` or `status: partial` (confidence `high` or `stale` per §3.6)?
3. **Unsupported** — neither of the above, _and_ the reference's `reference_state` is `healthy` (so the negative answer is trustworthy). If `reference_state` is `degraded` or `unavailable`, the per-capability availability is returned as `unknown` rather than `unsupported`, so the Orchestrator does not confidently file a feature request based on a bad reference read.

The skill rolls up the per-capability answers into a single `verdict`: `configured` if every capability is configured against a single candidate agent (not scattered across multiple agents); `configurable` if at least one is not configured but all are configurable; `unsupported` if any capability is unsupported with a healthy reference; `unknown` if any capability resolves to unknown and none are unsupported.

The skill also returns `candidate_agents: Array<{agent_id, coverage: 'full' | 'partial', missing: string[]}>` so the Orchestrator can see which agents were considered, why each was accepted or rejected, and whether partial coverage (Path B) is worth proposing against a specific agent rather than a fresh Configuration Assistant run.

**Implementation:** Pure aggregation skill. Internally calls `list_connections`, `list_platform_capabilities`, `config_list_agents`, `config_list_links`. Runs in a single round-trip from the agent's perspective. No new data required — it's a composition of existing queries. Cache TTL for its inputs is short (60s from `list_platform_capabilities`; live for the others).

**Permissions:** Same as `list_connections` — system and org agents; subaccount agents restricted to their own subaccount.

### 5.2 Feature requests: `feature_requests` table

**Purpose:** Durable, queryable record of every request for capability the platform either doesn't have (Path D) or could promote to system-level (Path C).

**Schema:** New Drizzle table `feature_requests` at `server/db/schema/featureRequests.ts`, added via a new migration file in `migrations/` with the next free sequence number.

```typescript
export const featureRequests = pgTable('feature_requests', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Attribution
  organisationId: uuid('organisation_id').notNull().references(() => organisations.id),
  subaccountId: uuid('subaccount_id').references(() => subaccounts.id),        // nullable
  requestedByUserId: uuid('requested_by_user_id').notNull().references(() => users.id),
  requestedByAgentId: uuid('requested_by_agent_id'),                           // nullable — the agent that filed on the user's behalf
  sourceTaskId: uuid('source_task_id').references(() => tasks.id),             // nullable — originating task if filed from task board

  // Classification
  category: text('category').notNull(),                                        // 'new_capability' | 'system_promotion_candidate' | 'infrastructure_alert'
  status: text('status').notNull().default('open'),                            // 'open' | 'triaged' | 'accepted' | 'rejected' | 'shipped' | 'duplicate'

  // Lightweight dedupe (see §5.4)
  dedupe_hash: text('dedupe_hash').notNull(),                                  // sha256(category + '|' + canonical_capability_slugs.sorted.join(','))
  dedupe_group_count: integer('dedupe_group_count').notNull().default(1),      // incremented instead of inserting a row when the same hash appears in the same org within a 30-day window

  // Content
  summary: text('summary').notNull(),                                          // short title, orchestrator-generated
  user_intent: text('user_intent').notNull(),                                  // verbatim task text the user wrote
  required_capabilities: jsonb('required_capabilities').notNull(),             // the decomposition that triggered the filing
  missing_capabilities: jsonb('missing_capabilities').notNull(),               // subset that the platform doesn't have
  orchestrator_reasoning: text('orchestrator_reasoning'),                      // why this was classified C or D (for audit)

  // Workflow
  notified_at: timestamp('notified_at'),                                       // when the outbound Slack/email notification fired
  notification_channels: jsonb('notification_channels'),                       // which channels fired
  triaged_by: uuid('triaged_by').references(() => users.id),                   // Synthetos team member who triaged
  triaged_at: timestamp('triaged_at'),
  resolution_notes: text('resolution_notes'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});
```

**Indexes:** `(organisationId, createdAt)`, `(category, status)`, `(status)`, `(organisationId, dedupe_hash)` for the dedupe lookup. Soft-delete column follows the convention in CLAUDE.md.

**RLS:** Added to `rlsProtectedTables.ts`. Org members see their own org's rows; system admins see all rows.

### 5.3 `request_feature` skill

**Purpose:** The skill the Orchestrator calls to file a feature request. Writes the `feature_requests` row and triggers outbound notifications.

**Input:**

```typescript
{
  category: 'new_capability' | 'system_promotion_candidate';
  summary: string;                          // short title
  user_intent: string;                      // verbatim task text
  required_capabilities: Array<{ kind: string; slug: string }>;
  missing_capabilities: Array<{ kind: string; slug: string }>;
  orchestrator_reasoning: string;
  source_task_id?: string;                  // originating task
  orgId: string;
  subaccountId?: string;
  requested_by_user_id: string;
}
```

**Output:**

```typescript
{
  feature_request_id: string;
  notification_result: {
    slack: { status: 'sent' | 'skipped' | 'failed'; detail?: string };
    email: { status: 'sent' | 'skipped' | 'failed'; detail?: string };
  };
}
```

**Implementation:** Writes the row inside a transaction with the outbound notification calls. If notifications fail, the row is still written (so no signal is lost), the skill returns the failure detail, and a background reconciliation job re-sends later. The skill does not block the Orchestrator's downstream handoff — Path C proceeds to the Configuration Assistant handoff in parallel with the notification fire-and-forget.

**Outbound channels:**

- **Slack** — posts to an internal Synthetos support channel (configured via `systemSettings.feature_request_slack_channel`). Uses the existing Slack integration. If the channel is not configured, the skill logs a warning and returns `status: skipped`.
- **Email** — sends to a configured support mailbox (configured via `systemSettings.feature_request_email_address`). Uses the existing email sending service. Same skipped-on-missing-config behaviour.

Both channels are best-effort. The durable record is the `feature_requests` row.

**Permissions:** `feature_request_submit`. System and org agents can file; subaccount agents cannot (to prevent feature-request spam from client_user-facing flows). The Orchestrator, which runs at org scope, always has permission.

### 5.4 Lightweight dedupe (per-org, single category, 30-day window)

The spec does **not** build full clustering or cross-org dedupe, but a small hash-based suppression prevents the obvious spam case (a noisy trigger or a prompt bug filing the same request hundreds of times).

The dedupe key is `sha256(category + '|' + canonical_capability_slugs.sorted.join(','))`. On insert:

1. `request_feature` computes the hash from the already-normalised capability slugs (same pipeline as §2).
2. It looks up `(organisationId, dedupe_hash)` on rows where `category` matches and `createdAt` is within the last 30 days.
3. If a match exists, the existing row's `dedupe_group_count` is incremented and its `updatedAt` is bumped — no new row is written, no outbound notification fires again.
4. If no match exists, a new row is written and the standard notification fires.

The window is deliberately short — repeated signal over months is genuine signal and should re-surface to the Synthetos team. The same-org constraint keeps the logic simple; cross-org clustering is still deferred. Infrastructure alerts follow the same rule so one broken reference read doesn't page the team 500 times.

### 5.5 What NOT to build in this spec

- **No full clustering or cross-org dedupe.** Feature requests are single-org facts beyond the simple per-org hash above. Cross-org analytics comes later if volume justifies.
- **No automatic promotion.** A `system_promotion_candidate` row does not trigger any automated system-agent creation. The Synthetos team reads the signal and makes the call by hand.
- **No user-facing feature-request browser.** Users see their own feature-request filings via the task comment (§8). An admin dashboard can be added later if needed.
- **No SLA enforcement.** Rows remain `open` until a Synthetos team member triages them. No deadlines, no escalation. This is a signal channel, not a ticket queue.

### 5.6 Notification content

Both Slack and email include:

- Category (`new_capability` or `system_promotion_candidate`)
- Summary
- Originating org / subaccount / user (including display names)
- Originating task ID + link to the task (if filed from task board)
- User's verbatim intent text
- Orchestrator's required-capability decomposition and missing-capability subset
- Orchestrator's one-paragraph reasoning (from `orchestrator_reasoning`)
- Link to the `feature_requests` row in an admin view (to be wired once the admin surface exists — until then, a direct DB query is fine)

Template lives in `server/services/featureRequestNotificationService.ts`. The template is intentionally verbose — the Synthetos team's first read of a feature request should give them everything they need to triage without opening the database.

---

## 6. Orchestrator Prompt Rewrite and Config Assistant Handoff

### 6.1 Current state (what the rewrite replaces)

The Orchestrator's system prompt today contains a static keyword-routing table mapping task-text fragments to agent slugs, plus a memory block called `orchestrator_team_roster` that lists the agents the Orchestrator is aware of. Routing is LLM keyword matching against that table. Out-of-domain requests fall through to "flag for human attention."

This works while the platform has a small, known agent roster and stable task shapes. It breaks as soon as:

- A new capability ships but the prompt isn't updated.
- The same request is phrased in an unexpected way.
- The user is asking for something the platform _could_ do but no keyword matches.

The rewrite replaces the keyword table with a decision procedure grounded in runtime capability data.

### 6.2 New prompt structure

The Orchestrator's system prompt is restructured into five sections (existing wording preserved where compatible; rewritten where not):

1. **Role and boundaries** — unchanged in spirit; the Orchestrator is still the top-level router.
2. **Decision procedure** — new. Explicitly describes the four-path model from §2 and the decomposition → availability-check → classification flow.
3. **Capability discovery toolbox** — new. Lists the skills the Orchestrator can use (`list_connections`, `list_platform_capabilities`, `check_capability_gap`, `config_list_agents`, `config_list_links`) and when to call each.
4. **Narrow-vs-broad pattern heuristics** — new. Prompt-level guidance for classifying a configurable request as Path B or Path C (see §6.3).
5. **Handoff mechanics** — rewritten. Describes how to hand off to the Configuration Assistant via `spawn_sub_agents` for Paths B/C, how to route to an existing linked agent for Path A, and how to file a feature request and close the task for Path D.

The old keyword-routing table is **not deleted** — it is moved into a dormant "legacy fallback" prompt section that the Orchestrator uses only when `list_platform_capabilities` returns `reference_state: 'unavailable'` (§3.6, §4.2). Under normal operation the fallback is inert. When the reference is broken, the Orchestrator routes using keyword matching and the `orchestrator_team_roster` memory block as before, tags the decision record with `path: 'legacy_fallback'`, and files an `infrastructure_alert` feature request so the degraded state surfaces immediately.

The `orchestrator_team_roster` memory block is repurposed beyond legacy fallback: under normal operation it becomes a cache of recent agent-routing successes — populated automatically when `spawn_sub_agents` succeeds against a given agent for a given task shape (§9.5 Feedback loop). Treated as a hint, not authority.

The Orchestrator's prompt file lives at `server/config/configAssistantPrompts/` alongside other system-agent prompts. (Actual filename TBD during implementation — the architect can propose; the current file should be discoverable via a grep for the Orchestrator's existing prompt text.)

### 6.3 Narrow-vs-broad heuristics

Classifying a configurable request as Path B (narrow, just configure it) or Path C (broad, also file a system-promotion request) is subjective. The prompt gives the Orchestrator explicit heuristics:

**Broad (Path C) indicators:**

- The task contains no client-specific data (no company names, no contact lists, no account IDs unique to the requester).
- The requested workflow matches a common pattern — "inbox triage", "pipeline status report", "deal stage reminders", "weekly client health summary".
- The integrations and capabilities required appear in the `broadly_useful_patterns` field of the relevant Integration Reference entries.
- The Orchestrator would expect many orgs to want something similar with minor tweaks.

**Narrow (Path B) indicators:**

- The task references a specific client, a specific Slack channel, a specific webhook URL, a specific CRM custom field — anything that would need to be rewritten per org.
- The requested workflow matches `client_specific_patterns` in the relevant Integration Reference entries.
- The configuration requires a decision the Synthetos team cannot make generically (e.g. "filter to deals over £100k" — the £100k threshold is the user's judgement, not a system default).

**When the signal is ambiguous, default to Path B.** Filing a system-promotion request that turns out to be a false positive costs a Synthetos triage moment. Failing to file one that was a real signal costs the platform a product-improvement opportunity. Slight false-negative bias is fine; spam is not.

The heuristics live in the prompt, not in code. Tuning is a prompt-edit exercise. Future improvements (e.g. an explicit classifier skill) are deferred until the volume of feature requests justifies the investment.

### 6.4 Decomposition pipeline and re-decomposition

Per §2, decomposition is a three-stage pipeline (LLM draft → normalise → validate). The Orchestrator drives this pipeline inside its own run — it is not a separately-registered skill. The prompt describes the pipeline explicitly so the LLM understands it is producing a _draft_ for the deterministic layer to verify, not the final answer.

#### 6.4.1 Pipeline execution

1. **LLM draft turn.** Prompt asks the LLM to list required capabilities as `{kind, slug, rationale}` triples. The prompt includes the capability taxonomy from `list_platform_capabilities` so the LLM sees the canonical slug universe _before_ emitting. This is not a guarantee but it materially reduces hallucinated slugs.
2. **Normalise.** The Orchestrator calls the `normalize_capability_slugs` helper (§4.2) with the draft list and the taxonomy. Result: each slug is `canonical`, `aliased` (caller slug mapped to a canonical), or `unresolved`.
3. **Validate.** The Orchestrator checks every canonical/aliased slug against `list_platform_capabilities` output. Slugs that don't match are marked `unknown`.

#### 6.4.2 One-shot re-decomposition

If any slugs emerge from stages 2 or 3 as `unresolved` or `unknown`, the Orchestrator runs a single re-decomposition LLM turn with:

- The original task text.
- The draft list and its unresolved/unknown markers.
- The full capability taxonomy (canonical slugs + aliases + descriptions).
- A brief instruction: _"Some slugs in your draft don't exist in the platform. Re-produce the list using only canonical slugs from the taxonomy. If a capability you originally wanted doesn't appear in the taxonomy, say so explicitly."_

The result is re-run through normalise + validate. If slugs are still unresolved/unknown after this second pass, they are treated as genuinely absent — the Orchestrator classifies the task as Path D and files a feature request with the unresolved slugs as the missing-capability list. This is the deterministic guarantee: the platform does not try a third LLM turn, it concludes the capability is not available.

Re-decomposition is bounded at **one retry per task** so a pathological prompt can't loop indefinitely. The retry count is in the decision record so repeated retry patterns become visible in observability (§9.5).

#### 6.4.3 Per-run capability-query budget

Every Orchestrator run has a fixed budget of capability-discovery skill calls (`list_connections`, `list_platform_capabilities`, `check_capability_gap`, `normalize_capability_slugs`). Default: **8 calls per run**. The budget exists because an LLM with read-only skills tends to re-query the same data multiple times across a single reasoning loop, inflating latency and token cost without improving the decision.

The budget is enforced at the skill-registry level: each call decrements a per-run counter; when the counter hits zero, further calls return `{ error: 'capability_query_budget_exhausted', last_results: <cached>... }` using in-run cached results so the Orchestrator can still complete. The budget value is configurable via `systemSettings.orchestrator_capability_query_budget` so the Synthetos team can tune it per-environment.

Four calls are typically enough for a straightforward run (one each of `list_platform_capabilities`, `list_connections`, `check_capability_gap`, plus one `normalize_capability_slugs`). The 8-call default leaves headroom for the one-shot re-decomposition path and a handful of retries, with room to grow before the budget bites.

### 6.5 Decision record

Every time the Orchestrator runs the decision procedure, it emits a structured decision record into the agent run transcript:

```typescript
{
  path: 'A' | 'B' | 'C' | 'D' | 'legacy_fallback' | 'routing_failed';
  decomposition: {
    draft: Array<{ kind: string; slug: string; rationale: string }>;
    normalised: Array<{ kind: string; canonical_slug: string; original_slug: string; normalisation_status: 'canonical' | 'aliased' | 'unresolved' }>;
    validated: Array<{ kind: string; canonical_slug: string; validation_status: 'valid' | 'unknown' }>;
    redecomposition_used: boolean;              // true if the one-shot retry fired
  };
  availability_map: { [slug: string]: 'configured' | 'configurable' | 'unsupported' | 'unknown' };
  candidate_agents_considered: Array<{ agent_id: string; coverage: 'full' | 'partial'; missing: string[] }>;
  selected_target_agent_id: string | null;       // for Path A
  selected_handoff_target: 'config_assistant' | null; // for Paths B / C
  feature_request_id: string | null;             // for Paths C / D
  reference_degraded: boolean;                   // true if routing ran with a stale/unavailable reference
  capability_query_budget_used: number;          // how many of the 8 budget slots were consumed
  reasoning: string;                             // one paragraph
  timestamp: string;
}
```

This record serves three purposes: audit (any support escalation can replay the decision), training signal (future prompt tuning can look at misclassified cases), and debugging (if the Orchestrator routes to the wrong path, the record shows why).

The decision record is written to the existing agent run transcript table (`agentRunMessages` or equivalent), flagged with a `messageType: 'routing_decision'` so it can be filtered out of user-facing run logs while remaining visible in system-admin views.

### 6.6 Config Assistant handoff via `spawn_sub_agents`

The Orchestrator hands off to the Configuration Assistant using the existing `spawn_sub_agents` skill. No new primitive.

**Mechanics:**

1. Orchestrator resolves the Configuration Assistant's agent ID for the current org (the Configuration Assistant is a system-managed agent automatically present in every org per its spec).
2. Orchestrator calls `spawn_sub_agents` with the Configuration Assistant as target, passing a structured payload:

```typescript
{
  target_agent_id: string;                    // Configuration Assistant for this org
  handoff_reason: 'capability_routing_paths_B_or_C';
  context: {
    user_intent: string;                      // verbatim task text
    source_task_id: string;
    required_capabilities: Array<{ kind: string; slug: string }>;
    missing_for_configurable: string[];       // what the user would need to set up
    orchestrator_classification: 'B' | 'C';
    feature_request_id: string | null;        // set when path is C
    originating_user_id: string;
  };
}
```

3. The Configuration Assistant runs its standard plan-approve-execute loop against this context. It does not need major modifications — the context above fits within its existing input shape (user request + org/subaccount resolution). It does, however, need to conform to an **explicit output contract** (§6.6.1) so the Orchestrator can verify completion deterministically rather than trusting a free-form response.
4. When the Configuration Assistant finishes, the Orchestrator reads its structured output, verifies it against the original required-capability list, updates the source task's status accordingly (e.g. `configured`, `awaiting_user_approval`, `configuration_failed`), and — if the Configuration Assistant reports partial completion — decides whether to re-route (e.g. file a feature request for any capabilities the Configuration Assistant reported as out of reach).

**Why `spawn_sub_agents` over a new primitive:** `spawn_sub_agents` already handles cross-agent context passing, run attribution, and result reporting. Adding a dedicated `handoff_to_config_assistant` skill would duplicate that machinery for a single caller. The existing primitive's extensibility (via the `context` field) is enough — the output contract below layers on top without changing the primitive itself.

#### 6.6.1 Configuration Assistant output contract

When the Configuration Assistant finishes an Orchestrator-initiated run, it must return a structured result:

```typescript
{
  status: 'success' | 'partial' | 'failed' | 'user_abandoned';
  agent_created: boolean;
  agent_id: string | null;                        // the linked agent ID, if one was created or re-linked
  connections_established: string[];              // integration slugs that now have active connections
  capabilities_satisfied: string[];               // canonical capability slugs the Configuration Assistant confirms are now available
  capabilities_unsatisfied: Array<{
    slug: string;
    reason: 'user_declined' | 'provider_error' | 'out_of_scope' | 'needs_feature_request';
    detail: string;
  }>;
  schedule_created: boolean;
  schedule_id: string | null;
  source_task_id: string;                         // echoed back for correlation
  summary_comment: string;                        // human-readable summary posted to the source task
}
```

**`status` semantics:**

- `success` — every capability in the original required list appears in `capabilities_satisfied`; the agent is linked and scheduled.
- `partial` — at least one capability is satisfied; at least one is in `capabilities_unsatisfied` with a non-terminal reason. The Orchestrator can decide whether to re-route or escalate.
- `failed` — nothing satisfied (e.g. user rejected the plan, provider-level error on every integration).
- `user_abandoned` — the plan-approve-execute loop was opened but the user never approved; the Configuration Assistant closed after timeout.

**Orchestrator post-handoff verification:** The Orchestrator does not trust the `status` flag alone. After receiving the result, it re-runs `check_capability_gap` against the original required-capability list. If the result contradicts the Configuration Assistant's report (e.g. `status: success` but `check_capability_gap` returns `verdict: configurable`), the Orchestrator:

1. Logs the discrepancy in the decision record as `post_handoff_verification_mismatch: true`.
2. Posts a task comment explaining the mismatch plainly (_"The Configuration Assistant reported success, but I verified the capabilities afterward and the inbox_read capability is still not available. I've flagged this for our team."_).
3. Files an `infrastructure_alert` feature request.
4. Sets the task status to `configuration_failed`.

This closes the "non-deterministic completion" failure mode: the Configuration Assistant self-reports, but the Orchestrator independently verifies. The contract is enforceable because both sides agree on canonical capability slugs.

**`capabilities_unsatisfied` with `reason: 'needs_feature_request'`:** if the Configuration Assistant discovers mid-run that a capability the Orchestrator initially classified as `configurable` is actually not supported (e.g. an integration ships but a specific scope isn't available yet), it marks that capability with this reason. The Orchestrator then files a new-capability feature request for that specific slug, rather than leaving the user stranded.

### 6.7 Config Assistant changes

The Configuration Assistant itself needs two small updates to cooperate with the new flow:

1. **Recognise orchestrator-originated context.** When invoked via `spawn_sub_agents` with `handoff_reason: 'capability_routing_paths_B_or_C'`, the Configuration Assistant should treat the `user_intent` as the starting point of its plan-approve-execute loop and back-reference the `source_task_id` in its own outputs.
2. **Report back to the source task.** On completion (success or abandonment), the Configuration Assistant posts a summary comment on the source task so the user has a single place to follow the outcome. Implementation: one new skill call (`post_task_comment`) or extension of the existing completion hook — the architect to pick.

Neither change alters the Configuration Assistant's own contract (its spec is preserved) — they are additive behaviours triggered only when the handoff context shape is present.

---

## 7. Task Board Trigger

### 7.1 Purpose

Close the end-to-end loop: a user writes a task on the task board describing what they want, and the Orchestrator picks it up without any further manual action. This is the user-facing surface of everything the rest of this spec builds.

### 7.2 Trigger design

A new entry in the existing `agent_triggers` schema (`server/db/schema/agentTriggers.ts`) with:

- `triggerType: 'task_created'`
- `targetAgentRole: 'orchestrator'`
- `scope: 'org'` — the Orchestrator is an org-level system agent; triggers fire once per org per matching task.
- `matchCriteria`: a JSON predicate describing which tasks should fire the trigger (§7.3).
- `cooldownSeconds`: default 0 (fire on every matching task). Configurable per-org to throttle noise.

On `tasks.insert` that matches the predicate, a trigger event is enqueued onto the existing job queue (`pg-boss`), and the worker spawns an Orchestrator run with the task ID as primary input.

The new-agent-run machinery is already in place — the only additions are:

- A new job handler (`server/jobs/orchestratorFromTask.ts`) that translates a trigger event into an Orchestrator run invocation.
- A registration entry in `server/jobs/index.ts`.
- A new trigger row factory (`server/services/agentTriggerService.ts` or equivalent — name TBD during implementation) that creates the default `task_created → orchestrator` trigger for every org on org creation. Backfill migration creates it for existing orgs.

### 7.3 Match predicate

Not every task should fire the Orchestrator. The default predicate:

- `task.status === 'open'` at insert time
- `task.assigned_to_agent_id IS NULL` (user didn't pre-route to a specific agent)
- `task.description IS NOT NULL` and non-empty (at least one sentence of description to classify)
- `task.source !== 'agent'` (don't recurse on tasks the Orchestrator created itself)

Tasks created by direct agent-to-agent handoff, subtasks, and admin-created-for-internal-tracking tasks do not fire the trigger. The predicate is expressed as a JSON structure in `matchCriteria` so it can be tuned per-org without code changes.

### 7.4 Idempotency

Trigger events are keyed on `(task.id, trigger.id)` with a uniqueness constraint. Replaying a job does not spawn a second Orchestrator run for the same task. If the user edits the task description after the Orchestrator has already routed it, that's a separate concern handled by task-update triggers (deferred — §10).

### 7.4.1 Per-org rate limiting

High-volume orgs can produce bursts of tasks that would spawn many concurrent Orchestrator runs. To keep cost and latency bounded, the trigger supports per-org rate limiting at the job-queue level:

- **Default:** 10 concurrent Orchestrator runs per org, 100 runs per 10-minute window.
- **Enforcement:** the job worker checks a per-org counter before invoking the Orchestrator. Exceeding the burst window puts the trigger event into a debounce queue; once the window resets, queued events drain in order.
- **Configurability:** both limits are stored in `systemSettings.orchestrator_per_org_concurrency` and `orchestrator_per_org_burst_window` so the Synthetos team can tune per-environment.
- **Observability:** every debounce event is logged so a flood pattern becomes visible in operations.

Rate limiting is additive to the existing job-queue primitives — no new infrastructure.

### 7.5 Opt-out

Org admins can disable the default trigger via the existing agent-triggers admin UI. When disabled, the only way to route a task to the Orchestrator is manual assignment. This is the safety valve for an org that finds the Orchestrator's routing decisions aren't serving them and prefers to operate in fully-manual mode while they investigate.

Opt-out is explicit, not default. The value of the Orchestrator is highest when it's wired up automatically; turning it off is a deliberate choice.

### 7.6 Subaccount-level task triggers

Tasks scoped to subaccounts also fire the Orchestrator. The Orchestrator, running at org scope, respects the subaccount context in its capability discovery calls (`list_connections({ scope: 'subaccount', subaccountId })` etc.) so its routing decisions are subaccount-aware. A task labelling Gmail in subaccount A does not get routed based on subaccount B's Gmail connection.

This is the only new rule the trigger introduces — the Orchestrator already understands subaccount context; the trigger just ensures the context is passed through from the task.

---

## 8. User-Facing UX

### 8.1 Design principle

Every routing decision the Orchestrator makes should be visible to the user on the originating task. The task is the shared surface; that's where the user looks for progress. The agent chat is a secondary notification channel for real-time awareness.

No routing decision is silent. If the Orchestrator takes a path, the user sees what path was taken and why.

### 8.2 Per-path UX

**Path A (already configured):** The Orchestrator posts a short comment on the task: _"Routing to <agent name>. This agent covers the capabilities you're asking for."_ The comment includes a link to the agent run. Task status updates to `routed` or `in_progress` depending on the downstream agent's own lifecycle handling.

**Path B (configurable, narrow):** Task comment: _"I can set this up for you. Handing off to the Configuration Assistant to walk you through the setup steps."_ Includes the summary of missing capabilities (e.g. _"You'll need to connect Gmail and approve the `gmail.modify` scope."_). Chat message in the agent chat mirrors the task comment for real-time visibility. Task status updates to `awaiting_configuration`.

**Path C (configurable, broad):** Same as Path B for the user-visible flow — the system-promotion request is filed behind the scenes without cluttering the user's view. The user only sees the configuration-handoff message. The Synthetos team sees the separate feature-request signal.

**Path D (unsupported):** Task comment: _"This request needs `<missing capability>`, which isn't supported by the platform today. I've filed a feature request with our team on your behalf."_ Includes the feature request ID. Chat message with the same content. Task status updates to `blocked_on_feature_request`.

### 8.3 Task status values

Four new task status values are introduced:

- `routed` — Orchestrator handed off to an existing agent; downstream agent now owns the task.
- `awaiting_configuration` — Orchestrator handed off to Configuration Assistant; user needs to approve/respond to the Configuration Assistant's plan.
- `blocked_on_feature_request` — Platform doesn't support the request; feature filed.
- `routing_failed` — Orchestrator encountered an error during classification (e.g. `check_capability_gap` threw). Task stays open for human attention.

These extend the existing task status enum. All four have client-side rendering (icon, colour, filter chip) in the task board UI. The task board already supports custom statuses, so this is additive.

### 8.4 Comment template

All Orchestrator task comments follow a consistent template so users learn to recognise them:

```
[Orchestrator] <one-line summary>

<what was required>
<what path was taken>
<what the user should do next, or what happens automatically>

<links: agent run, feature request, config assistant conversation>
```

Template lives in `server/services/orchestratorTaskCommentTemplate.ts`. Any change to the template is a PR-level review concern — this is the user-facing voice of the Orchestrator.

### 8.5 Chat notifications

The Orchestrator posts a short chat message into the org-level agent chat surface for every routing decision. This is intentionally redundant with the task comment: different users watch different surfaces, and the chat is the real-time feed. The chat message is terser than the task comment (a single sentence with the path and target) and links to the task for detail.

If the org has disabled agent-chat notifications for the Orchestrator, only the task comment fires. No other notification channels (email, push, SMS) are in scope for this spec.

### 8.6 Error visibility

If the Orchestrator fails mid-decision (e.g. `list_platform_capabilities` returns `error: 'integration_reference_invalid'`), the user sees a task comment saying _"I hit an infrastructure error classifying this request. Our team has been notified."_ and the task status is set to `routing_failed`. The underlying error detail is logged but not exposed to the user — the detail is in the routing decision record and the feature request (if one was synthetically filed per §4.2).

The user is never left with a silent failure. "I couldn't route this right now" is better than no response.

---

## 9. Phasing, Testing, and Rollout

### 9.1 Phased build order

The work decomposes into five phases. Each phase is independently shippable — later phases can be paused without stranding earlier work.

**P1: Integration Reference doc + `list_platform_capabilities` skill**
- Create `docs/integration-reference.md` with the schema-version meta block and the core subset YAML entries (§3.4).
- Implement and register `list_platform_capabilities` (§4.2) with parsing, validation, and TTL cache.
- Add `scripts/verify-integration-reference.ts` static gate (§3.5) and wire it into `run-all-gates.sh`.
- Deliverable: any agent can programmatically ask "what does the platform support?" and get an accurate, typed answer.

**P2: `list_connections` + `check_capability_gap` skills**
- Implement and register `list_connections` (§4.1).
- Implement and register `check_capability_gap` (§5.1) composing P1's skill and the existing config-listing skills.
- Deliverable: any agent can programmatically answer "can this org fulfil this specific request, and if not why not?"

**P3: `feature_requests` table + `request_feature` skill + notification service**
- New migration adding the table (§5.2).
- Implement and register `request_feature` (§5.3).
- Implement `featureRequestNotificationService` with Slack and email channels (§5.5).
- Deliverable: any agent can file a feature request that is durably stored and visibly notified.

**P4: Orchestrator prompt rewrite + Config Assistant handoff**
- Rewrite the Orchestrator's system prompt per §6.2 and §6.3.
- Add the decision-record message type (§6.4).
- Wire Config Assistant handoff semantics (§6.5) — this is mostly prompt work plus the two additive Config Assistant behaviours (§6.6).
- Deliverable: given a task, the Orchestrator produces a correctly-classified routing decision and executes the chosen path.

**P5: Task board trigger + user-facing UX**
- Add the `task_created → orchestrator` trigger (§7.2) with the default match predicate.
- Backfill the trigger for existing orgs.
- Add the four new task status values and their rendering (§8.3).
- Implement the task-comment template and chat notification (§8.4, §8.5).
- Deliverable: end-to-end — a user creating a task triggers the Orchestrator, which routes and reports back on the task itself.

Each phase closes with an end-to-end manual verification against the worked example in §2 (Gmail inbox labelling) using whatever subset of capabilities is in place. By P5, the full example runs without human intervention.

### 9.2 Testing posture

Per `docs/spec-context.md`, the current testing posture is `static_gates_primary` with `runtime_tests: pure_function_only`. This spec respects that posture:

- **Static gates (required):**
  - `scripts/verify-integration-reference.ts` — ensures the reference doc is schema-valid and in sync with `oauthProviders.ts`, `mcpPresets.ts`, and `server/skills/` declarations.
  - Type-check and lint as normal.
- **Pure-function runtime tests (required for new logic that has decomposable pure cores):**
  - `check_capability_gap` rollup logic (per-capability → verdict) has a pure-function test suite.
  - `list_platform_capabilities` parser has a pure-function test suite covering schema-valid, schema-invalid, missing-file, and unknown-field cases.
  - Narrow-vs-broad heuristic is prompt-level, not code-level — no runtime test.
- **Manual end-to-end verification (required per phase):**
  - After each phase, run the worked example from §2 manually in a dev environment. Record the decision record and confirm it matches the expected path.
- **Integration / e2e / frontend tests (out of scope):** per spec-context.md, do not add supertest, vitest-against-own-app, or playwright for this spec. Static gates plus pure-function unit tests plus manual verification are the testing surface.

If/when spec-context.md's testing posture changes, this section is revisited — but not unilaterally within this spec.

### 9.3 Static gate implementation detail

`scripts/verify-integration-reference.ts` runs three checks:

1. **Schema validation** — every YAML block parses, every required field is present with the right type.
2. **Runtime consistency** — every slug in the reference has a matching entry in either `OAUTH_PROVIDERS` or `MCP_PRESETS` (by provider_type); every slug referenced in `skills_enabled` exists in `server/skills/`; every `slug` in the file is unique.
3. **Reverse consistency** — every OAuth provider in `OAUTH_PROVIDERS` and every MCP preset in `MCP_PRESETS` has a corresponding reference entry (or is explicitly annotated as `excluded_from_reference` in the preset config, to cover internal-only connectors).

The script exits non-zero on any failure and prints a readable diff. It runs in `run-all-gates.sh` and in CI.

### 9.4 Rollout model

Per spec-context.md, rollout is `commit_and_revert` — no staged rollout, no feature flags for new migrations, no percentage ramps. The spec respects that:

- P1 through P5 merge as PRs land. Each phase is revertable independently.
- The new task-board trigger in P5 has the opt-out mechanism (§7.5) as its safety valve. Orgs that find the Orchestrator's decisions disruptive can disable the trigger without reverting the code.
- The four new task statuses are additive — existing tasks keep their existing statuses. No data migration on the tasks table.
- The `feature_requests` table migration follows the existing Drizzle convention — next free sequence number, standard up-migration, no down-migration.

No behaviour-mode feature flag is needed. The Orchestrator's new behaviour is default-on as soon as its prompt is updated; the reason the new code doesn't cause regressions is that pre-existing agent routing via direct assignment (`task.assigned_to_agent_id IS NOT NULL`) bypasses the trigger (per §7.3).

### 9.5 Observability and the routing feedback loop

The spec logs a lot of data about every routing decision. That data is worthless if nothing reads it. Two tiers of use:

#### 9.5.1 Passive observability (SQL queries, shipped with P4)

1. **Routing decision distribution** — how many tasks hit each path A/B/C/D, over time. Signal for prompt tuning.
2. **Feature request volume and triage time** — how many rows per category, how long `open → triaged` takes. Signal for Synthetos-team staffing.
3. **Integration Reference drift frequency** — how often the static gate catches a drift. Signal for whether the maintenance discipline is working.
4. **Decomposition quality** — what fraction of runs trigger re-decomposition, what fraction still have unresolved slugs after the retry. Signal for taxonomy gaps and prompt tuning.
5. **Budget exhaustion rate** — how often runs hit the capability-query budget. Signal for budget tuning or Orchestrator-prompt inefficiency.

These are SQL queries the Synthetos team can run on demand. Standing dashboards are deferred until the team knows what it wants to watch over time.

#### 9.5.2 Active feedback loop (shipped incrementally after P5)

Every Orchestrator run produces a decision record. A run also produces downstream outcomes:

- Did the selected target agent (Path A) actually complete the task successfully, or did it fail mid-run?
- Did the Configuration Assistant handoff (Paths B/C) end with `status: success`, or did it partial/fail?
- Did the user intervene on the task after the Orchestrator routed (renaming, reassigning, editing the description, closing as "wrong agent")?

These outcomes are the ground-truth signal for routing quality. A new `routing_outcomes` table (added in a post-P5 phase, call it P6) joins decision records to downstream outcomes:

```typescript
{
  decision_record_id: string;
  task_id: string;
  path_taken: 'A' | 'B' | 'C' | 'D' | 'legacy_fallback' | 'routing_failed';
  outcome: 'success' | 'partial' | 'failed' | 'user_intervened' | 'abandoned';
  user_intervention_detail: string | null;
  time_to_outcome_ms: number;
  downstream_errors: Array<{ stage: string; error: string }>;
  captured_at: timestamp;
}
```

Two feedback mechanisms use this data:

1. **Path A pattern reinforcement.** Successful Path A routes for a given `(task_shape, target_agent_id)` pair increment a confidence score on the `orchestrator_team_roster` memory block. Failed or user-intervened Path A routes decrement it. The Orchestrator prompt uses the score as a tiebreaker when multiple candidate agents pass the coverage check. This is a memory-block-level update, not a prompt rewrite — no code churn.
2. **Decomposition correction.** If the Configuration Assistant consistently reports `capabilities_unsatisfied` with `reason: 'needs_feature_request'` for a specific capability slug, the decomposition retry prompt (§6.4.2) can be augmented to tell the LLM _"previous runs found this slug commonly mis-derives as X; confirm before including it"_. Implementation: a small lookup table of "commonly-misderived slugs" rendered into the re-decomposition prompt. Managed by the Synthetos team.

Neither mechanism auto-tunes. Both produce signals the team can act on manually — that's the right level of sophistication for a pre-production system and stays within the spec-context.md framing of `stage: rapid_evolution` and `testing_posture: static_gates_primary`.

#### 9.5.3 Out of scope

- Automated prompt tuning pipelines.
- Reinforcement learning against routing outcomes.
- Cross-org pattern mining.
- Continuous evaluation harnesses.

These would be appropriate after the platform moves out of rapid evolution. Flag for revisit when `docs/spec-context.md` shifts.

---

## 10. Open Questions and Appendices

### 10.1 Questions for the architect review

These are the items that need a concrete decision during the architect pass before implementation begins:

1. **Core integration subset finalisation (§3.4).** The proposed 10-entry starting list needs cross-referencing against what's actually wired vs partially wired in the codebase. Gmail in particular has known gaps (`read_inbox` is a stub per the earlier audit; `modify_labels` is pending per the canonical data platform P4 addition). The architect should propose the canonical starting list.
2. **Orchestrator prompt file path.** The current Orchestrator prompt file's exact location under `server/config/configAssistantPrompts/` (or wherever system-agent prompts live) needs to be identified and named so the rewrite PR has a concrete target.
3. **Task status enum location.** Where the four new task status values land — enum table, shared constants file, server-only enum — is a codebase convention call. The architect should confirm the existing pattern.
4. **`spawn_sub_agents` context field extensibility.** The spec assumes the existing primitive's context payload can be extended with the handoff-reason and classification fields without a schema change. If it can't, a small addition to `spawn_sub_agents`'s input shape is needed. Architect to confirm.
5. **Decision record persistence location.** §6.4 assumes `agentRunMessages` or equivalent. Architect to confirm the right table and any indexes needed for future routing-distribution queries (§9.5).

### 10.2 Deferred items

These items were considered and explicitly pushed out of scope. Re-evaluate after the spec ships and real-world signal tells us whether they're worth building.

- **Task-update triggers.** If a user edits a task description after the Orchestrator has already routed, the edit does not re-route. Defer until user feedback says it matters.
- **Automatic feature-request deduplication and clustering.** Defer until volume justifies.
- **Per-org feature-request dashboard.** Users see their own filings through task comments; a standalone browser is not built.
- **Explicit narrow-vs-broad classifier skill.** Heuristics live in the prompt. Promote to a skill if prompt-level heuristics turn out to be too noisy.
- **Structured admin triage workflow for `feature_requests`.** The Synthetos team triages manually via DB queries and Slack threads until volume forces a tool.
- **Cross-org routing-decision analytics.** Dashboards are SQL-on-demand until a standing view is needed.
- **Agent-initiated feature requests from non-Orchestrator agents.** The `request_feature` skill is technically available to any system/org agent, but in practice only the Orchestrator calls it in this spec. If other agents (e.g. the Configuration Assistant) want to file feature requests during their own runs, that's a prompt-level extension, not new infrastructure.

### 10.3 Relationship to other in-flight specs

- **Canonical data platform (`docs/routines-response-dev-spec.md`).** Independent. This spec can ship entirely before P4 of the canonical spec lands. Once the canonical Gmail adapter and the `modify_email_labels` skill exist, the Integration Reference entry for Gmail gets updated (from `partial` → `fully_supported`) and the Orchestrator automatically picks up the change via `list_platform_capabilities`. No code changes required in this spec's artifacts.
- **Configuration Assistant spec (`docs/configuration-assistant-spec.md`).** Consumed, not modified. The two additive Configuration Assistant behaviours (§6.6) are specified here; the Configuration Assistant's own spec remains the contract for its internals.
- **Skill Analyzer v2 (`docs/skill-analyzer-v2-spec.md`).** Adjacent — the Skill Analyzer inspects individual skills for issues; this spec inspects the platform as a whole for capability coverage. They share no code but share an operational goal: make the platform's capabilities explicit and auditable.

### 10.4 Glossary

- **Required capability** — an atomic unit of platform function needed to fulfil a request (integration, read capability, write capability, skill, primitive).
- **Configured** — the current org/subaccount has the capability active right now.
- **Configurable** — the platform supports the capability but the current org hasn't set it up.
- **Unsupported** — the platform does not support the capability at all.
- **Path A / B / C / D** — the four routing decisions the Orchestrator can emit. See §2.
- **Integration Reference** — the static, machine-parseable doc at `docs/integration-reference.md` describing what the platform supports. See §3.
- **System-promotion candidate** — a configurable request whose pattern looks broadly applicable and is flagged for the Synthetos team's review. See §2 Path C and §6.3.
- **Decision record** — the structured object the Orchestrator writes on every routing decision, capturing path, availability map, and reasoning. See §6.4.

### 10.5 Appendix: worked example — full end-to-end run

For reference, the complete sequence for the Gmail inbox-labelling example (assuming P1–P5 have all shipped):

1. User writes a task: _"Label my Gmail inbox into LEADS, CLIENTS, JUNK, INVOICES every 5 minutes."_ Task is inserted with `status: open`, `assigned_to_agent_id: null`.
2. `task_created` trigger fires. `orchestratorFromTask` worker picks it up from pg-boss.
3. Orchestrator run starts. Its first LLM turn decomposes the task into required capabilities: `[{integration: gmail}, {read: inbox_read}, {write: modify_labels}, {skill: classify_email}, {primitive: scheduled_run}]`.
4. Orchestrator calls `check_capability_gap` with the required-capability list and the originating org/subaccount.
5. `check_capability_gap` internally calls `list_platform_capabilities`, `list_connections`, `config_list_agents`, `config_list_links`. Returns `verdict: 'configurable'`, with `missing_for_configurable: ['gmail:oauth']`.
6. Orchestrator's prompt applies the narrow-vs-broad heuristic. Pattern matches `inbox_triage` in the Gmail reference entry's `broadly_useful_patterns`. Classified as Path C.
7. Orchestrator calls `request_feature` with `category: 'system_promotion_candidate'`. Row written; Slack + email fired to Synthetos support.
8. Orchestrator calls `spawn_sub_agents` targeting the Configuration Assistant with the structured context payload.
9. Orchestrator writes a decision record into the run transcript.
10. Orchestrator posts the Path C task comment and chat message. Task status → `awaiting_configuration`.
11. Configuration Assistant picks up the handoff, runs its plan-approve-execute loop, walks the user through Gmail OAuth with the `gmail.modify` scope, creates the labelled-inbox agent, links it, schedules it.
12. Configuration Assistant posts a completion comment on the source task. Task status → `configured` (or the downstream agent's lifecycle handles the next status).
13. Separately, the Synthetos team reads the `system_promotion_candidate` Slack notification and decides whether to promote _"inbox triage"_ to a system agent template.

No code in this sequence says _"Gmail"_. Swap the user's request for Slack, HubSpot, or any other integration in the reference, and the same sequence runs with different capability slugs. This is the integration-agnostic outcome the spec is optimising for.
