# Brief Result Contract (v1)

**Status:** Draft — foundational contract for cross-branch development
**Source of truth (types):** `shared/types/briefResultContract.ts`
**Version:** `BRIEF_RESULT_CONTRACT_VERSION = 1`
**Intended consumers:** Brief chat surfaces (client), Orchestrator + capability skills (server), CRM Query Planner (separate branch)

---

## Purpose

Defines the shape of "artefacts" that any capability can emit into a Brief chat thread. The contract exists so that multiple capabilities — shipped across different branches, by different sessions — can produce renderable results in Brief chats without each one inventing its own envelope.

Without this contract, every new capability forces the chat client to add a new rendering path. With it, the client renders any artefact whose `kind` it recognises, and any capability that emits a valid artefact gets rendered for free.

---

## The three artefact kinds

Every artefact rendered into a Brief chat is one of:

| `kind` | Purpose | Produced by |
|---|---|---|
| `'structured'` | "Here's the data you asked for" — tables, counts, filter chips | Read-only capabilities (CRM Query Planner, observability queries, canonical metrics) |
| `'approval'` | "I want to do this write — confirm first" — approval card with action details | Capabilities that propose structured writes (email sends, task creations, status changes) |
| `'error'` | "I couldn't do this, here's why" — with refinement suggestions | Any capability, on any failure mode |

A single chat turn may emit **zero or more** artefacts. Example: a CRM Query returns a structured result + two approval card suggestions for follow-up actions.

---

## Shared fields on every artefact

Every artefact — regardless of kind — carries the fields in `BriefArtefactBase`:

| Field | Required | Purpose |
|---|---|---|
| `artefactId` | Yes | Unique identifier so other artefacts can reference this one (via `parentArtefactId` or `relatedArtefactIds`) |
| `status` | No — default `'final'` | Lifecycle signal: `final` / `pending` / `updated` / `invalidated` |
| `parentArtefactId` | No | When status is `'updated'` or `'invalidated'`, points to the superseded artefact |
| `relatedArtefactIds` | No | Loose relationships to sibling artefacts (e.g., approval card → result that spawned it) |
| `contractVersion` | No — defaults to `BRIEF_RESULT_CONTRACT_VERSION` | Per-artefact version for mixed-version rollouts |

### Lifecycle semantics

- **`final`** — This artefact is authoritative. No further updates expected. Default when omitted.
- **`pending`** — A refinement is expected (e.g., long-running query emits an initial partial result, will replace with a complete one). UI may render a spinner badge.
- **`updated`** — This artefact supersedes a previous one referenced by `parentArtefactId`. UI replaces the previous artefact in place; the superseded one remains in history via the parent link.
- **`invalidated`** — The underlying data for a previous artefact has changed; that artefact is no longer accurate. `parentArtefactId` points to what's invalidated. UI visually marks the predecessor as stale; does not render this artefact as primary content.

### Relationship semantics

`relatedArtefactIds` is intentionally loose — it expresses "these artefacts are related in the user's flow," not a strict parent/child graph. Typical uses:
- An approval card lists the result artefact that spawned it
- A follow-up error artefact references the structured result it failed to produce
- A set of suggestions references the result they refine

The UI uses this for grouping and "show related" affordances; it doesn't enforce any specific relationship semantics. Keep it loose.

### Per-artefact versioning

`contractVersion` exists for mixed-version rollout scenarios (e.g., a capability branch shipping to production on v2 while another is still on v1). Most artefacts omit it and inherit the global version. When a capability opts into a newer version, it stamps each artefact explicitly so consumers can adapt per-artefact, not per-deployment.

---

## Structured result (`kind: 'structured'`)

The common shape. Used by any capability returning data to the user.

**Required fields:**
- `summary` — one-sentence human description ("18 VIP contacts inactive 30d")
- `entityType` — canonical entity discriminator; drives UI rendering
- `filtersApplied[]` — filters the system interpreted, rendered as chips so users can see (and correct) how their intent was parsed
- `rows[]` — entity records; shape is entity-dependent
- `rowCount` — total matching; may exceed `rows.length` when truncated
- `truncated` + optional `truncationReason`
- `suggestions[]` — refinement or follow-up affordances
- `costCents` — actual spend
- `source` — `canonical`, `live`, or `hybrid`

**Design notes:**

- **`filtersApplied` is not optional.** Every interpreted filter must be surfaced. Users need to see how their intent was parsed; silent filter application erodes trust.
- **`suggestions[].intent` must be re-parseable.** Phrase as a full instruction ("Narrow to last 7 days and show VIP contacts") not a fragment ("last 7 days"). A suggestion becomes a new Brief if clicked.
- **`rowCount` is authoritative**, not `rows.length`. Clients showing "14 of 1,482" use the former.
- **`columns` is optional but recommended.** Capabilities that can emit a column hint should — it eliminates UI-side defensive logic for field labels, ordering, and type-appropriate rendering (currency, dates, booleans).

### Source semantics — tightened

`source` and `freshnessMs` together describe where the data came from and how old it is. Precise definitions:

| `source` | Meaning |
|---|---|
| `'canonical'` | Read from our ingested canonical tables. Data is as fresh as the most recent sync — surface via `freshnessMs`. Well-suited to repeatable, hot-path queries. |
| `'live'` | Direct call to the provider API at query time. `freshnessMs` close to 0 (allowing for adapter latency). Used for long-tail queries canonical doesn't cover. |
| `'hybrid'` | Combined read — e.g., canonical base + live augmentation. `freshnessMs` reports the **oldest** data element contributing to the result (conservative). |

**`freshnessMs` applies to all three.** A capability returning cached provider data (e.g., 60-second in-memory cache) reports `source: 'live'` with `freshnessMs` reflecting the cache age, not zero. The user cares about the freshness, not the internal classification.

**Important:** the answer to "is cached API data canonical or live?" is: **it's `live` with `freshnessMs` > 0.** Cache is a latency optimisation, not a data-source change.

---

## Approval card (`kind: 'approval'`)

Used when the system has interpreted a write-intent and wants human confirmation before acting.

**Required fields:**
- `summary` — human description of the proposed action
- `actionSlug` — must be a registered slug in `server/config/actionRegistry.ts`
- `actionArgs` — arguments matching the action's typed schema, validated on dispatch
- `affectedRecordIds[]` — which records this action will touch
- `riskLevel` — `low` / `medium` / `high`

**Optional:**
- `estimatedCostCents` — predicted spend for the action

**Design notes:**

- **Approval cards never bypass `actionRegistry`.** The `actionSlug` must exist. The `actionArgs` must match the registered schema. Approval dispatch goes through the same path as any other structured action — approval cards are a UX affordance over the existing review gate, not a parallel system.
- **`riskLevel` lives here because UX is risk-aware.** A `low`-risk card (e.g. "log a note") can be approved with one click. A `high`-risk card ("send email to 500 contacts") should require explicit confirmation even if the user has fast-approve enabled for routine work. Risk is computed from the action's default gate level + the scope of the args (e.g. record count, monetary impact).
- **`affectedRecordIds` is load-bearing for preview.** The UI renders a preview of affected records. Without IDs, there's no way to show the user what they're approving.

### Execution linkage

Once the user approves an action, the orchestrator populates `executionId` on the approval card and emits an updated artefact (`status: 'updated'`, `parentArtefactId` pointing to the original). The card transitions through `executionStatus` values as the action runs:

| `executionStatus` | UI treatment |
|---|---|
| `'pending'` | Approved, queued for dispatch |
| `'running'` | Dispatched, executing — show spinner |
| `'completed'` | Success — show ✓ and any return value summary |
| `'failed'` | Failure — show ✗ and retry affordance |

This keeps the Brief chat coherent end-to-end: the user sees the approval → execution → outcome on a single linked artefact chain, not across disconnected updates.

---

## Error result (`kind: 'error'`)

Used for any failure mode — not just technical errors. Includes "I don't understand your question," "you don't have permission for this," and "this would cost too much."

**Required fields:**
- `errorCode` — machine-readable; drives UI treatment
- `message` — plain-English explanation

**Optional:**
- `suggestions[]` — refinement options (when applicable)

**Error codes:**

| Code | Meaning | Typical suggestion |
|---|---|---|
| `unsupported_query` | Intent outside the system's capability | "Try asking X instead" / file feature request |
| `ambiguous_intent` | Multiple valid interpretations | "Did you mean A or B?" (clarifying options) |
| `missing_permission` | User lacks permission for the detected scope | "This is an org-admin action — here's the admin to ping" |
| `cost_exceeded` | Would exceed per-query or per-run budget | "Narrow to last 30 days to reduce cost" |
| `rate_limited` | Provider rate limit hit | "Try again in N seconds" |
| `provider_error` | External provider returned an error | Provider-specific |
| `internal_error` | Catch-all; indicates system bug | None |

**Design notes:**

- **Errors carry suggestions whenever possible.** A bare `unsupported_query` is a dead-end; `unsupported_query` with three refinement options is a productive branch.
- **`message` is shown to users verbatim.** It should be plain English, not a stack trace or technical identifier.
- **`severity` drives UX treatment.** `'low'` renders as an inline toast ("couldn't find that one — try a different search"). `'medium'` renders as a banner in chat. `'high'` renders as a modal or blocking state. When omitted, treat as `'medium'`.
- **`retryable` drives the retry affordance.** `true` for transient failures (`rate_limited`, `provider_error`, some `internal_error` cases). `false` for structural failures (`unsupported_query`, `missing_permission`, `ambiguous_intent`). When omitted, the UI conservatively offers retry for transient-looking errors and hides it for structural ones.

---

## Confidence surfaces

Both `BriefStructuredResult` and `BriefApprovalCard` carry an optional `confidence: number` field (0.0–1.0) that represents the system's self-assessed confidence in the interpretation.

**When to set it:**
- Capabilities backed by deterministic logic (e.g., a canonical read against a well-formed filter) can skip it — confidence is effectively 1.0 and surfacing it adds noise.
- Capabilities backed by LLM interpretation (query planning, intent parsing, approval-card synthesis) should set it — it's the signal users need to spot-check borderline cases.

**UI surfacing guidance:**
- `confidence >= 0.85` — no badge; render normally.
- `0.60 <= confidence < 0.85` — subtle indicator ("~70% confident this is what you meant").
- `confidence < 0.60` — prominent indicator + explicit refinement prompt. For `BriefApprovalCard`, low-confidence forces the card into explicit-approval-required mode regardless of `riskLevel`.

**Design intent:** the confidence field builds trust by admitting uncertainty. Users given a 70%-confident answer know to verify; users given a 100%-confident wrong answer don't. The field is a first-class trust surface, not a debugging hint.

**Thresholds are UI-owned.** The contract doesn't enforce thresholds — capabilities report the raw number; the client decides when to show / hide / escalate. This lets UX iterate without contract churn.

---

## Cost preview (separate, not an artefact)

`BriefCostPreview` is returned by capabilities *before* execution, when the Orchestrator is deciding whether to dispatch. It's not rendered as a chat artefact — it surfaces in the pre-dispatch confirmation UI (or skipped for cheap/free operations).

Fields: `predictedCostCents`, `confidence`, `basedOn`.

`basedOn` tells the UI how much to trust the prediction:
- `planner_estimate` — the capability's own estimate (most trustworthy)
- `cached_similar_query` — approximated from a previous similar call
- `static_heuristic` — fallback when neither of the above applies

---

## RLS and scoping contract

Every capability that produces an artefact **must** scope its reads to the Brief's caller context:

- Brief's `organisationId` — always set; all reads must filter by this
- Brief's `subaccountId` — set for subaccount-scoped Briefs; reads must respect
- Brief's `userId` + principal permissions — enforce at the service layer via `withPrincipalContext`

**Primary enforcement: at the capability layer.** No capability may emit rows the caller isn't authorised to see. This is enforced inside the capability, not by a post-filter at the chat layer. Post-filtering is brittle and misses aggregated cases (counts, sums).

**Recommended defence-in-depth: orchestrator-level sanity check.** Relying purely on capability-side enforcement means one mis-implemented capability can leak data across tenants. The orchestrator should implement a lightweight backstop that verifies artefact output doesn't contain IDs outside the Brief's scope (e.g., `organisationId` mismatches, unexpected `subaccountId` references). This isn't a replacement for capability-layer enforcement — it's a safety net that catches implementation errors before they leak. Exact implementation is a spec-level detail; the principle belongs in every capability spec's review checklist.

**Budget context scoping.** `budgetContext` (when populated) reflects the caller's budget for the current scope (per-Brief, or per-run, or per-day). It's populated by the orchestrator after the capability returns, since the capability typically doesn't know the caller's broader budget posture.

---

## Versioning

- `BRIEF_RESULT_CONTRACT_VERSION` starts at `1`
- **Additive changes** (new optional fields, new enum values on existing fields) do not require a version bump. Consumers ignore unknown fields.
- **Breaking changes** (renaming, removing fields, re-typing) require bumping the version and a migration plan for consumers.
- Capabilities may emit artefacts at any supported version; the chat client renders the highest version it understands and falls back gracefully for older ones. (v1 is the only version; this is forward-looking.)

---

## What this contract does NOT cover

- **Streaming / progressive results.** v1 is one-shot artefacts. If progressive rendering is needed later, add a `kind: 'streaming'` variant with a terminal frame.
- **Conversation state.** Chat thread storage, turn history, user↔system message shape — all separate from the artefact contract.
- **Tool-call transparency UI.** How a capability's intermediate steps render (tool-use expanders, thinking blocks) is a separate concern.
- **Multi-artefact grouping semantics.** If a turn emits 3 artefacts, how they're visually grouped/ordered is a UI concern, not a contract concern. The contract just says "a turn produces an ordered array."
- **Localisation.** v1 assumes English `message` / `humanLabel` / `summary`. i18n is a future concern.

---

## For the CRM Query Planner branch specifically

The planner is expected to emit `BriefStructuredResult` artefacts for all reads and `BriefApprovalCard` artefacts for any write-intent follow-ups it detects. It should set:

- `entityType` per the canonical entity (`contacts`, `opportunities`, etc.)
- `source` per where the data came from (`canonical` for hot-path, `live` for provider calls, `hybrid` for combined)
- `filtersApplied` for every filter the planner interpreted from the query
- `suggestions` for refinement options when results are broad, truncated, or borderline
- `costCents` for observed spend

Unsupported queries emit `BriefErrorResult` with `errorCode: 'unsupported_query'` and refinement `suggestions`.

---

## For the universal Brief chat surface branch specifically

The client must:
- Discriminate artefacts by `kind` and render each via a dedicated component
- Treat unknown `kind` values as an error-boundary failure (log + show generic fallback), not a hard crash — forward compatibility with future artefact kinds
- Respect `truncated` and `truncationReason` — never silently hide the truncation
- Render `suggestions` as clickable follow-ups that, when clicked, create a new Brief turn with `suggestion.intent` as the input

---

## Change log

- **v1 (initial):** Structured result, approval card, error, cost preview.
- **v1 (additive, round 1):** Added optional `confidence?: number` field to `BriefStructuredResult` and `BriefApprovalCard` following external review feedback. Backward-compatible — existing consumers ignore the new field; new consumers opt in.
- **v1 (additive, round 2):** Following second external review, added lifecycle + relationship primitives and kind-specific extensions:
  - **Shared (via new `BriefArtefactBase`):** `artefactId` (required), optional `status`, `parentArtefactId`, `relatedArtefactIds`, `contractVersion`
  - **Structured result:** optional `columns` (soft schema hint), `freshnessMs`, `budgetContext`; tightened `source` semantics (cached provider data is `'live'` with non-zero `freshnessMs`)
  - **Approval card:** optional `executionId`, `executionStatus`, `budgetContext` for execution linkage
  - **Error result:** optional `severity`, `retryable` for UX treatment
  - **RLS:** clarified defence-in-depth recommendation for orchestrator-level sanity check in addition to capability-layer primary enforcement
  - All additions are backward-compatible. Consumers ignore unknown fields; capabilities opt in.
