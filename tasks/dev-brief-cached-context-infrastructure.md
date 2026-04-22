# Cached Context Infrastructure — Development Brief

**Status:** Draft for external review
**Owner:** Michael
**Audience:** External reviewer (no prior context on this codebase)
**Purpose:** Capture the problem, the design decisions, and the reasoning before we commit to a technical spec. This is a brief, not a spec — implementation detail is deliberately light.

---

## Contents

1. Executive summary
2. The problem we're solving
3. What we discovered when we mapped this to the codebase
4. What we're actually building (v1)
5. Why these specific choices (and what we rejected)
6. What we're NOT building in v1
7. Codebase context for the reviewer
8. Decision points deferred to the spec
9. Success criteria
10. Principles carried forward

---

## 1. Executive summary

We need recurring AI tasks that operate over a stable set of reference documents plus a variable input (transcript, report, email thread) and produce a structured output. The canonical example is a "daily macro report" task: five reference markdown files totalling ~30–50k tokens, plus a daily video transcript, producing a formatted report via Anthropic's API.

Today we'd build this ad-hoc per tenant. Wrong shape. Every tenant on our platform will eventually need this pattern, and solving it once as reusable infrastructure is the correct move before we build the second one-off.

After mapping the initial design against the codebase, we found that most of the *plumbing* exists (LLM router, HITL gate, cost ledger, cache-control support, scheduled tasks) but the *reference-document primitive itself is a genuine gap*. Documents are explicitly-attached, never-cascaded material — a different loading model from memory blocks, and a different primitive. v1 introduces `reference_documents` + `document_packs` as a new sibling to memory blocks, adds run-time pack snapshots for reproducibility, unifies three overlapping budget primitives into one canonical `ExecutionBudget` at the router, and wires a concrete block-path through the existing HITL gate.

---

## 2. The problem we're solving

**Product pattern:** "file-attached recurring task."

- A stable pack of reference documents (brand guidelines, SOPs, framework notes, client context)
- A variable input that changes every run (today's transcript, this week's emails)
- A recurring schedule (daily, weekly, triggered)
- A consistent structured output

**Why it hurts without shared infra:**

1. **Cost:** sending 30–50k tokens of reference material on every run without prompt caching multiplies the per-run bill by ~10×. Getting caching right (deterministic ordering, correct cache-control placement, measurable hit rate) is fiddly and easy to silently break.
2. **Safety:** AI context windows are large but not unlimited, and output quality degrades well before the hard ceiling. Without a pre-flight budget check, a tenant who adds a 20th document silently gets degraded results or a surprise bill.
3. **Reuse:** if every tenant's version is hand-built, we never amortise the work. The second one-off costs the same as the first.
4. **Observability:** without per-run cache attribution, we can't tell whether caching is working until a margin problem surfaces. Estimates will drift from reality.

**Pilot task:** a daily macro report that ingests a video transcript and produces a structured report using five reference documents. We'll validate the infrastructure on this task, then open it to other file-attached patterns.

---

## 3. What we discovered when we mapped this to the codebase

The initial brief (drafted before codebase analysis) proposed a new `reference_documents` table, a new request-builder utility, a new threshold config table, and new HITL wiring. When we mapped this against the repo, most of the *plumbing* already exists — but the *reference-document primitive itself is a genuine gap*. The codebase has several memory-like systems; none of them are the right shape for large, explicitly-attached, task-specific documents.

**Why documents are a different primitive from memory blocks.** The platform already has `memory_blocks` for curated persistent facts the agent learns — small, size-capped, lifecycle-managed, quality-scored, and **cascaded by scope** (org → subaccount, always-on). That model is correct for learned facts. It is wrong for reference documents:

- A subaccount with 200 client documents would inject all 200 on every run under the cascade model — context blown, attention diluted, cost explodes.
- Document relevance is task-specific, not inferable from scope position.
- Cascading would train users to be stingy about uploads, defeating the point.

Documents need the opposite loading model: **explicitly linked, never cascaded, snapshotted at run time**. That is a separate primitive. Our original instinct to propose a `reference_documents` table was correct.

| Brief's proposed primitive | What the codebase has today |
|---|---|
| `reference_documents` table | **Gap.** `memory_blocks` serves learned facts with a cascade model; it is not the right home for large, explicitly-attached reference material. We build `reference_documents` + `document_packs` as a new primitive, sibling to `memory_blocks`. |
| "Explicit `cache_control` placement" | `anthropicAdapter.ts` already sets `cache_control: { type: 'ephemeral' }` on the system prefix in production — we extend the shape, not rebuild it. |
| "Builder returns a validated payload" | `llmRouter.routeCall()` is the single financial chokepoint; it *just gained* an `estimatedContextTokens` param — the pre-flight hook we wanted. |
| "Block at the HITL gate on breach" | `actions.gateLevel: 'auto' \| 'review' \| 'block'` + `hitlService` already model this path. |
| "Capture cache tokens per run" | `llm_requests` ledger already has `cachedPromptTokens`; schema is append-only (audit-grade). We add cache-write tracking and a prefix-hash field. |
| New threshold config table | `scheduledTasks.tokenBudgetPerRun` exists; `runCostBreaker` exists; adding a third is fragmentation. We unify under one canonical `ExecutionBudget` (see §4.3). |

**The shift this caused.** v1 is a thin new primitive plus an orchestration layer over existing infrastructure:
1. Introduces `reference_documents` + `document_packs` as a *new* primitive — sibling to `memory_blocks`, never cascaded, explicitly attached at agent / task / scheduled-task level.
2. Resolves packs to immutable snapshots at run time for reproducibility.
3. Assembles deterministically with a stamped `assembly_version` for cache-coherence under code change.
4. Validates against one canonical `ExecutionBudget` via the existing router pre-flight hook.
5. Routes via the existing `llmRouter.routeCall()`; captures cache-read, cache-write, and prefix-hash on the existing ledger.
6. Blocks at the existing HITL gate on budget breach with a concrete structured payload.
7. Composes alongside `memory_blocks` (Universal Brief continues to inject learned facts dynamically) — the two systems are orthogonal, not competing.

---

## 4. What we're actually building (v1)

Six concrete additions. Each is small. Together they turn a one-off pattern into a reusable primitive.

**1. Reference documents + document packs.** A new sibling primitive to memory blocks. `reference_documents` stores user-uploaded reference material. `document_packs` bundle them into named sets ("42 Macro context pack," "Acme client brief pack"). The pack itself has a version counter that increments on edit; immutable snapshots are captured at run time (see §4.1a).

Documents are versioned explicitly via a `reference_document_versions` table: `{ document_id, version, content_hash, token_counts_by_model_family, serialized_bytes_hash, created_at }`. The current-version pointer lives on `reference_documents`; every edit writes a new immutable version row. Snapshots reference `(document_id, document_version)`, not `content_hash` alone — this gives durable audit, diff, rollback, and future connector-sync safety in one move. Without an explicit version layer, document edits would lose traceability and snapshot reproducibility would rely entirely on hash collisions staying rare.

**Attachment is explicit, never cascaded.** Three attachment surfaces:

- **Agent-level** — "this agent can read Q3 Board Pack." Persistent; shows up on every run of that agent. Analogous to how skills/data-sources attach.
- **Task-level** — "this specific task uses these packs." Scoped to the run.
- **Scheduled-task-level** — "every run spawned from this schedule uses these packs." Same shape as task-level, applied at the schedule row.

Documents are *not* scope-cascaded through org or subaccount hierarchy. Attempting to cascade 200 client documents on every run would blow context, dilute attention, and explode cost. Packs are the unit of grouping; attachment is the unit of relevance.

**1a. Pack snapshots at run time.** At the start of every run, the engine resolves each attached pack to an immutable snapshot: `{ pack_id, pack_version, ordered_document_ids, document_content_hashes }`. The snapshot is persisted on the run row. Assembly then reads from the snapshot, not from live pack data. This gives three things we can't otherwise get:

- **Reproducibility** — historical runs can be reconstructed exactly, even if the pack was edited afterwards.
- **Concurrency safety** — a pack edit mid-run doesn't poison the in-flight call.
- **Audit trail** — every run has a durable record of what it was shown.

Snapshots dedup by prefix-hash fingerprint: two back-to-back cron runs against an unchanged pack share one snapshot row. The dedup is enforced at the DB level with `UNIQUE(prefix_hash)` on the snapshots table — concurrent cron bursts cannot race-insert duplicates. Pinning (`task.pinned_pack_version = 3`) is a v2 extension requiring no schema change.

**Atomic resolution invariant.** Pack resolution happens once, at run start, under a single transaction. Subsequent edits to documents, packs, or attachments do not affect the in-flight run. Assembly reads from the snapshot row; live tables are not consulted past the resolution moment. This is stated explicitly because "helpful" future code that re-reads pack state mid-run is the most plausible way this invariant gets broken.

**2. Pre-measured document size, with drift tracking.** Every document is sized (per model family, since tokenisers differ) when it's saved, and the number is stored. Instant "will this fit?" checks before firing a task, no wasted cost or latency re-measuring the same documents daily. Refresh triggers on content change. Every run also captures actual input tokens from the response and compares against the pre-flight estimate — systematic drift (tokeniser changes, assembly separators, boilerplate) is flagged for per-model correction. The calibration algorithm is a spec-level detail; the brief commits to measuring drift, not solving it upfront.

**3. One canonical execution budget.** Today three overlapping budget primitives exist: `scheduledTasks.tokenBudgetPerRun` (per-task token cap), `runCostBreaker` (per-run USD cap), and the proposed per-model-tier thresholds (soft-warn, hard-limit, output-reserve, per-document-cap). Running three in parallel produces conflicting decisions and un-debuggable blocks. We collapse them.

The canonical shape:

```
ExecutionBudget {
  max_input_tokens
  max_output_tokens
  max_total_cost_usd
  reserve_output_tokens
}
```

Resolved per invocation as `resolve(task_config ∩ model_tier_defaults ∩ org_ceilings)` — task config narrows within model-tier defaults, which narrow within org ceilings. Enforced at the router boundary via the existing `estimatedContextTokens` hook. The proposed `model_tier_thresholds` table becomes the *second input* to the resolver, not a parallel enforcement path. `tokenBudgetPerRun` and `runCostBreaker` become derivations of the canonical struct, preserved for backwards compatibility but no longer source-of-truth.

Why three inputs not one: safety (output quality degrades below capacity), cost (dollars), and capacity (literal context window) are genuinely different concerns with different owners (model-tier defaults encode safety; org ceilings encode cost; task config encodes the individual run's needs). Collapsing at the enforcement boundary preserves the enforcement invariant; collapsing at the resolution layer would lose important signal.

**Hard invariant at resolution time:** `max_input_tokens + reserve_output_tokens ≤ model_context_window`. Asserted when the budget is resolved, not when the call fires. Without this check, a valid-looking budget can produce an invalid model call — runtime failure instead of pre-flight failure.

**4. The context assembly engine.** A single engine every file-attached task calls. The pipeline shape:

```
assemble → validate → (optional transform) → execute
```

- **Assemble** — resolve pack snapshot, sort deterministically by stable document ID, place one `cache_control` breakpoint at the end of the reference block, append the variable input after the breakpoint.
- **Validate** — check the assembled payload against the resolved `ExecutionBudget` via the router's pre-flight hook.
- **Optional transform** — v1 has no transforms; the slot is reserved. v2+ degrade strategies (drop lowest-priority document, truncate, fall back to a smaller model, summarise inline) plug in here without reshaping the pipeline.
- **Execute** — hand to `llmRouter.routeCall()` for attribution, idempotency, and dispatch.

Every future file-attached task uses this engine. No per-tenant glue. One implementation in v1; named "engine" because the slot for growth is explicit.

**Serialization is part of the assembly contract, not an implementation detail.** The exact bytes between documents — block markers, separators, metadata ordering, trailing whitespace — affect both tokenisation and the prefix hash. The serialization format is specified (delimiters, metadata block shape, newline conventions) and covered by `assembly_version`. Any change to the serialization — adding a separator, changing a delimiter, altering metadata order — is a logic change that requires a version bump. Without this rule, a well-meaning `\n\n` tweak silently invalidates every cached prefix without any signal. The exact format is a spec decision; the principle is that it's versioned.

**5. Prefix identity + cache attribution.** The cache fingerprint is not a handwavy hash. It is a contract:

```
prefix_hash = hash({
  ordered_document_ids,
  document_content_hashes,
  included_flags,
  model_family,
  assembly_version
})
```

- `ordered_document_ids` — detects order changes.
- `document_content_hashes` — detects content edits.
- `included_flags` — per-document inclusion state at resolution time. A document is *included* iff: not paused, not deprecated, passes attachment scope (agent / task / scheduled-task), and is listed in the pack's current version. Any state change that flips an included_flag invalidates the hash naturally — no special-case handling needed.
- `model_family` — Opus 4.7 and Sonnet 4.6 have different tokenisers and cannot share a cache.
- `assembly_version` — a constant in the engine, bumped manually by the PR that changes assembly logic (sort order, breakpoint placement, separator tokens). Without this, a code deploy silently serves stale cached prefixes against new assembly logic. Automating the bump is a spec-level decision.

The hash *and its components* are logged on the run. When two runs with identical content disagree on hash, we can diff components without re-assembling. Cheap storage, massive debugging win.

**Three separate attribution fields, same row on `agent_runs`:**

- `applied_memory_block_ids` — learned facts Universal Brief injected. *Already exists.*
- `cited_memory_block_ids` — blocks actually referenced in the output. *Already exists, populated by `scoreRunBlocks`.*
- `cached_prefix_hash` + `pack_snapshot_id` — what this work contributes.

Three fields, not one — conflating them loses signal. Universal Brief's attribution and cached-context's attribution are siblings, not the same concept.

**Cache cost attribution captures both writes and reads.** `cache_creation_input_tokens` (cost of writing the cache on the first run in a TTL) and `cache_read_input_tokens` (savings on subsequent runs). True hit rate = reads / (reads + writes). Derived metrics (hit type: full / partial / miss, cache efficiency ratio, estimated cost saved) surface in the Usage Explorer as query-time calculations — no extra storage required.

**Pack utilization as a progressive signal, not just a cliff.** A scheduled background metric (`pack_utilization = estimated_prefix_tokens / max_input_tokens`) is computed per pack per model-tier and surfaced in the Pack UI and Usage Explorer. Thresholds: 70% → warning ("approaching limit"), 90% → urgent ("one more document may block"), 100% → block at run time. Without this, packs grow silently and users only learn they've breached the limit when a scheduled task fires at 3am and blocks at the HITL gate. With it, users see the ramp and prune proactively.

**6. The safety valve, with a concrete block payload.** If a task would exceed `ExecutionBudget`, it does not silently run expensive and it does not silently fail. It stops at the existing HITL gate as `block`. The structured payload the operator sees:

```
{
  threshold_breached: 'max_input_tokens' | 'max_total_cost_usd' | 'per_document_cap',
  budget_used,
  budget_allowed,
  top_contributors: [{ document_id, name, tokens, percent_of_budget }]  // top 5
  suggested_actions: ['trim_pack', 'upgrade_model', 'split_task', 'abort']
}
```

Soft-warn breaches (above warn threshold, below hard limit) log and proceed, flagged in the run row for later review in the Usage Explorer.

---

## 5. Why these specific choices (and what we rejected)

**Explicit cache-control over Batch API.** Batch would halve cost for async workloads but doubles observability complexity and adds up-to-24-hour latency. For v1 we want standard latency and simple attribution; Batch is a future optimisation, not a v1 requirement.

**TTL resolved, not hardcoded.** Anthropic's cache supports two TTLs: 5 minutes (cheap write) and 1 hour (2× write cost, far longer reuse window). We don't hardcode one — we resolve per invocation: `ttl = min(model_default, task_override, org_max)`, where the resolver picks between `5m`, `1h`, or no-cache based on the three inputs. Default is `1h` because QA iteration, ad-hoc testing, and clustered schedules all benefit; scheduled tasks at >1h cadence gain nothing from either but pay almost nothing for `1h`. Task-level override exists for the scheduled-task case that wants to explicitly avoid the write-cost surcharge; org-level max exists so a cost-sensitive tenant can cap all their tasks at `5m`. Actual reuse window is logged so we can tune after first live runs.

**Deterministic ordering, everywhere.** Non-deterministic ordering is the single most common subtle bug in this kind of system — identical content, zero cache hits, nobody can explain why. Sort by stable ID before concatenation; stamp a prefix hash on every run so we can prove the prefix was identical across runs.

**One cache-control breakpoint, not four.** The Anthropic API supports up to four breakpoints, useful when document sets are tiered by change frequency. For v1 our document sets are monolithic — one breakpoint at the end of the reference block covers everything. Multi-breakpoint strategies wait for a real use case.

**Pack-level grouping, not file-level.** If every task references individual files, we spend the rest of our lives updating task configs. Pack-level grouping adds one layer of indirection and buys us the ability to evolve document sets without touching tasks.

**Thresholds in the database, not code.** Per the platform's "configured behaviour in the database" principle. If tuning a limit requires a code deploy, we've put it in the wrong place.

**Sonnet 4.6 default.** Standard tier, 1M context, good enough for synthesis tasks. Opus for the narrow set of tasks that explicitly need it. Haiku for simple cases. Per-tenant override via task config.

---

## 6. What we're NOT building in v1

Explicit scope cuts, so the spec stays tight:

- **External document connectors** (Drive / Dropbox / S3 / Notion / GitHub). Valuable and almost certainly v2. The right pattern is *ingest-sync* (snapshot into our store on a schedule or webhook), not *live-read* (pull from the external API on every task run — kills caching, adds latency, breaks on auth drift). v1 ships with manual upload only, but `reference_documents` carries three columns from day one to make v2 a non-refactor: `source_type` (`'manual' | 'external'`), `source_ref` (nullable URI identifying the external source), `last_synced_at` (nullable timestamp). v1 only writes `manual`; v2 connector jobs populate external rows without schema change.
- **Batch API** (future 50% discount, async latency).
- **Multi-breakpoint cache strategies** (only needed when document sets are tiered).
- **Automatic document summarisation** on threshold breach (manual review only for now).
- **Cross-tenant document sharing** (tenants keep their own packs).
- **Vector retrieval / RAG** as an alternative to full-context attachment — adjacent problem, different brief already exists in the backlog. v1 explicitly assumes the full pack fits in context.
- **Parallel fan-out** (splitting a task across multiple API calls).

The goal is the minimum viable infrastructure that makes file-attached recurring tasks safe and observable. Optimisations come after live data.

---

## 7. Codebase context for the reviewer

Just enough to evaluate fit without reading the repo:

- **Backend:** Node/TypeScript, Express routes → service layer → Drizzle ORM over Postgres. Raw SQL migrations checked into git (not `drizzle-kit push`). Next migration number after the merge is 0202.
- **Three-tier agent model:** System agents (platform IP) → org agents (tenant-configured) → subaccount agents (per-client). All runs flow through a single run model with a cost ledger.
- **LLM routing:** Every LLM call goes through `llmRouter.routeCall()` — the financial chokepoint. It handles attribution, idempotency, cost ceilings, and provider fallback. It just gained an `estimatedContextTokens` param (the pre-flight hook for us).
- **Memory blocks (existing, *not* our document store):** per-tenant markdown with a rich lifecycle — priority, authoritative flag, paused/deprecated states, quality score (0.00–1.00), provenance tag. Cascades by scope (org → subaccount), always-on, size-capped. Correct home for curated *learned* facts the agent accumulates over time. **Not** the right shape for large user-uploaded reference material.
- **Reference documents (new, what we're building):** large user-uploaded reference material, versioned, token-counted per model family, grouped into `document_packs`, explicitly attached at agent / task / scheduled-task level, never cascaded by scope. Sibling primitive to memory blocks, not a replacement.
- **HITL gate:** Every gated action declares a `gateLevel` of `auto` (proceed), `review` (human must approve), or `block` (hard stop). A dedicated service blocks execution until a human decides. Projects into a `reviewItems` table for the operator UI.
- **Recurring tasks:** `scheduled_tasks` table with rrule-based cadence. Jobs dispatch via `pg-boss`. Each run writes to a `scheduled_task_runs` table.
- **Universal Brief (just shipped, orthogonal):** a conversational surface that injects *memory blocks* dynamically at call time and scores which blocks were cited post-run via `scoreRunBlocks`. Universal Brief is *call-time dynamic* on learned facts; cached-context is *pre-declared static* on reference documents. Same ledger, same attribution schema (three siblings on the run row), different orchestration. An agent run can use both — they compose, they do not compete.
- **Review workflow:** specs go through `spec-reviewer` (Codex loop) → implement → `spec-conformance` (verifies code matches spec) → `pr-reviewer` (independent code review). Specs live at `docs/`; the cached-context spec would be `docs/cached-context-infrastructure-spec.md`.

---

## 8. Decision points deferred to the spec

The six open questions raised in the first-draft brief have all been resolved — see §3, §4.3, §4.5, §7, and the corresponding choice in §5. What remains is genuinely spec-level material that should be decided during implementation, not in the brief:

1. **How `assembly_version` bumps.** v1 manual (a constant in the engine, bumped by the PR that changes assembly logic). v2 may automate via CI detection. Spec decides where it lives and who owns the bump.
2. **Token-estimate calibration algorithm.** Brief commits to measuring drift per model family; spec decides the correction strategy (additive offset, multiplicative factor, threshold for applying the correction, how often to recalibrate).
3. **Exact HITL-block UX.** Brief commits to the structured payload shape in §4.6; spec decides the operator-side UI — one-click "swap to Opus" vs review-and-approve, inline document-trim affordance, etc.
4. **Soft-warn threshold exposure in the Usage Explorer.** Brief commits that soft-warn runs are flagged; spec decides the dashboard shape.
5. **Pack-version pinning.** Brief confirms v1 always resolves to the latest pack version. Spec decides whether v1 ships the pinning *column* on tasks (cheap future-proofing) or defers entirely to v2.
6. **Agent-level access vs task-level use.** v1 treats attachment as inclusion: a pack attached at agent level loads on every run of that agent. A future pattern — "the agent has *access* to the pack but only *loads* it when the task justifies it" — is a retrieval behaviour, explicitly deferred with the RAG brief (§6). Spec decides whether the v1 attachment model needs a forward-compatible flag (`attachment_mode: 'always_load' | 'available_on_demand'`) so v2 retrieval can slot in without reshaping the attachment table.

---

## 9. Success criteria

The infrastructure is validated when:

- A new task can reference a pack by ID and a variable input, and the worker assembles a cached-prefix API request with no per-task glue code.
- Running the same task twice within the 1-hour TTL produces a cache hit on the second run, confirmed by the `cache_read_input_tokens` field on the response.
- A task configured with a pack that exceeds the hard limit is blocked at the HITL gate with a structured error, and no API credits are consumed.
- The Usage Explorer shows actual cache-hit rate and cache-attributed cost per tenant per task — measured, not estimated.
- The pilot macro-report task runs end-to-end on this infrastructure for a week without surprises.

---

## 10. Principles carried forward

- Generic infrastructure in code, tenant behaviour in the database.
- Deterministic ordering everywhere (documents, hashes, serialisation).
- **Documents are explicitly attached, never cascaded.** Memory blocks cascade; documents do not. Different primitives, different loading models.
- **Snapshot at run time; assemble from the snapshot.** Runs are reproducible and concurrency-safe by construction.
- **Pack resolution is atomic at run start.** No mutation to documents, packs, or attachments affects an in-flight run. Live tables are not consulted past the resolution moment.
- **One canonical budget at the enforcement boundary.** Many inputs resolve into one `ExecutionBudget`; no parallel enforcement paths.
- Fail fast and loud at the HITL gate; never silently burn credits.
- Capture actual cache attribution per run (reads *and* writes), not estimated.
- Defer complexity; v1 must be boring and observable before it is clever.
