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
8. Open questions for the external reviewer
9. Success criteria
10. Principles carried forward

---

## 1. Executive summary

We need recurring AI tasks that operate over a stable set of reference documents plus a variable input (transcript, report, email thread) and produce a structured output. The canonical example is a "daily macro report" task: five reference markdown files totalling ~30–50k tokens, plus a daily video transcript, producing a formatted report via Anthropic's API.

Today we'd build this ad-hoc per tenant. Wrong shape. Every tenant on our platform will eventually need this pattern, and solving it once as reusable infrastructure is the correct move before we build the second one-off.

After mapping the initial design against the codebase, we discovered the platform already has most of the plumbing. The v1 build is much smaller than first thought — six concrete additions that plug into existing primitives rather than parallel them.

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

The initial brief (drafted before codebase analysis) proposed a new `reference_documents` table, a new request-builder utility, a new threshold config table, and new HITL wiring. When we mapped this against the repo, most of it already exists:

| Brief's proposed primitive | What the codebase already has |
|---|---|
| `reference_documents` table | `memory_blocks` — per-tenant markdown with lifecycle (priority, authoritative, paused, deprecated, quality score, provenance) |
| "Explicit `cache_control` placement" | `anthropicAdapter.ts` already sets `cache_control: { type: 'ephemeral' }` on the system prefix in production |
| "Builder returns a validated payload" | `llmRouter.routeCall()` is the single financial chokepoint; it *just gained* an `estimatedContextTokens` param — the pre-flight hook we wanted |
| "Block at the HITL gate on breach" | `actions.gateLevel: 'auto' \| 'review' \| 'block'` + `hitlService` already model this path |
| "Capture cache tokens per run" | `llm_requests` ledger already has `cachedPromptTokens`; schema is append-only (audit-grade) |
| New threshold config table | `scheduledTasks.tokenBudgetPerRun` exists; `runCostBreaker` exists; a third threshold table is likely redundant — we need to reconcile the three, not add a fourth |

**The shift this caused:** v1 is not "build a parallel system." It's "add a thin orchestration layer that:
1. Groups memory blocks into named packs
2. Assembles them deterministically
3. Validates the budget via the existing pre-flight hook
4. Calls the existing LLM router
5. Captures the existing cache-attribution fields
6. Uses the existing HITL block path."

---

## 4. What we're actually building (v1)

Six concrete additions. Each is small. Together they turn a one-off pattern into a reusable primitive.

**1. Document packs.** A way to bundle memory blocks into named sets ("42 Macro context pack," "Acme client brief pack"). Tasks point at the pack, not at individual documents. Swap a document in or out once, every task that uses the pack picks it up automatically. Packs respect the memory-block lifecycle — a deprecated or paused block is excluded at assembly time.

**2. Pre-measured document size.** Every document is sized (for each AI model family, because they count tokens differently) when it's saved, and the number is stored. Instant "will this fit?" checks before firing a task, no wasted cost or latency re-measuring the same documents daily. Refresh triggers on content change.

**3. Tunable safety limits, in the database.** Soft warn / hard limit / output reserve / per-document cap, per model tier, stored as configuration rather than code. After the first live runs we *will* learn the defaults are wrong — tuning them should take five minutes, not a code release. Must reconcile cleanly with the two budget primitives that already exist (`tokenBudgetPerRun`, `runCostBreaker`) — we pick one as canonical and derive the others.

**4. The shared assembly recipe.** A single function that every file-attached task calls: resolve the pack, sort deterministically, check the budget against the pre-flight hook, place the cache-control breakpoint on the last reference block, hand off to the existing router. Every future task uses this recipe — no per-tenant glue.

**5. Cache fingerprint.** A short hash of the assembled prefix is logged on every run. When tomorrow's run costs 10× yesterday's, one glance tells us whether the documents actually changed or the cache just expired. Without this, cost surprises are invisible. Aligns naturally with the existing `applied_memory_block_ids` field on agent runs — citation attribution and cache attribution are sibling concerns and should live on the same row.

**6. The safety valve.** If a task would exceed the hard limit, it does not silently run expensive and it does not silently fail. It stops at the existing HITL gate as `block`, shows the operator exactly which documents pushed it over, and offers: trim the pack, upgrade the model, split the task, or abort. Soft-warn breaches log and proceed, flagged for review.

---

## 5. Why these specific choices (and what we rejected)

**Explicit cache-control over Batch API.** Batch would halve cost for async workloads but doubles observability complexity and adds up-to-24-hour latency. For v1 we want standard latency and simple attribution; Batch is a future optimisation, not a v1 requirement.

**1-hour TTL as default.** For a once-daily task the cache is long gone by the next run, so caching earns nothing on cadence alone. But QA iteration, ad-hoc test runs, and clustered schedules all benefit. 1-hour TTL is cheap insurance for minimal extra write cost.

**Deterministic ordering, everywhere.** Non-deterministic ordering is the single most common subtle bug in this kind of system — identical content, zero cache hits, nobody can explain why. Sort by stable ID before concatenation; stamp a prefix hash on every run so we can prove the prefix was identical across runs.

**One cache-control breakpoint, not four.** The Anthropic API supports up to four breakpoints, useful when document sets are tiered by change frequency. For v1 our document sets are monolithic — one breakpoint at the end of the reference block covers everything. Multi-breakpoint strategies wait for a real use case.

**Pack-level grouping, not file-level.** If every task references individual files, we spend the rest of our lives updating task configs. Pack-level grouping adds one layer of indirection and buys us the ability to evolve document sets without touching tasks.

**Thresholds in the database, not code.** Per the platform's "configured behaviour in the database" principle. If tuning a limit requires a code deploy, we've put it in the wrong place.

**Sonnet 4.6 default.** Standard tier, 1M context, good enough for synthesis tasks. Opus for the narrow set of tasks that explicitly need it. Haiku for simple cases. Per-tenant override via task config.

---

## 6. What we're NOT building in v1

Explicit scope cuts, so the spec stays tight:

- **External document connectors** (Drive / Dropbox / S3 / Notion / GitHub). Valuable and almost certainly v2. The right pattern is *ingest-sync* (snapshot into our store on a schedule or webhook), not *live-read* (pull from the external API on every task run — kills caching, adds latency, breaks on auth drift). v1 ships with manual upload and a storage interface clean enough to plug connectors in later.
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
- **Memory blocks:** Per-tenant markdown with a rich lifecycle — priority, authoritative flag, paused/deprecated states, quality score (0.00–1.00), and provenance tag. This is our document store.
- **HITL gate:** Every gated action declares a `gateLevel` of `auto` (proceed), `review` (human must approve), or `block` (hard stop). A dedicated service blocks execution until a human decides. Projects into a `reviewItems` table for the operator UI.
- **Recurring tasks:** `scheduled_tasks` table with rrule-based cadence. Jobs dispatch via `pg-boss`. Each run writes to a `scheduled_task_runs` table.
- **Universal Brief (just shipped, adjacent):** a conversation surface that injects memory blocks at call time and scores which blocks were actually cited post-run. It does *not* do deterministic ordering, pre-flight budgeting, or cache-control placement. Our work layers on top of it, not beside it.
- **Review workflow:** specs go through `spec-reviewer` (Codex loop) → implement → `spec-conformance` (verifies code matches spec) → `pr-reviewer` (independent code review). Specs live at `docs/`; the cached-context spec would be `docs/cached-context-infrastructure-spec.md`.

---

## 8. Open questions for the external reviewer

Specifically useful feedback would focus on these:

1. **Surface question.** Is cached-context infrastructure best modelled as an extension of the Universal Brief system (a Brief is a pack + a frozen conversation surface), or as a parallel primitive called from the skill executor? The pilot task feels more like "a recurring programmatic Brief" than a separate thing — but we want a second opinion before deciding.
2. **Budget layering.** Three overlapping primitives today — `tokenBudgetPerRun` (per task), `runCostBreaker` (per run, cost-based), and the proposed model-tier thresholds. Which should be canonical? How should they compose?
3. **Lifecycle vs cache coherence.** If a memory block is marked `deprecated_at` or `paused_at` between runs, the cached prefix is stale. Should a lifecycle change invalidate the pack's prefix hash, or only a `content` change? The former is conservative, the latter is cheaper.
4. **Quality-score interaction.** Does pack membership win over quality score (include low-quality blocks if the pack says to), or does quality score filter the pack? Our default is "pack definition wins; only `paused_at`/`deprecated_at` hard-exclude."
5. **Attribution alignment.** Cache attribution (bytes cached vs re-sent) and citation attribution (blocks actually referenced in the output) are siblings. Ideally one row on `agent_runs` carries both. Any trap in conflating them?
6. **External connectors later.** We're explicitly deferring Drive/Dropbox/S3/Notion connectors to v2, with the ingest-sync pattern. Is the storage interface we design for v1 likely to hold up, or should we front-load one specific connector now to force better shape?

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
- Fail fast and loud at the HITL gate; never silently burn credits.
- Capture actual cache attribution per run, not estimated.
- Defer complexity; v1 must be boring and observable before it is clever.
