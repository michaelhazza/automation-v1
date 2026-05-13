# Auto Knowledge Retrieval, Development Brief

> **Status:** Rev 4. Pre-spec, mockups attached. Considered final at brief level; further detail belongs in the spec.
> **Date:** 2026-05-08
> **Branch:** to be created (`claude/auto-knowledge-retrieval` or similar)
> **Audience:** Internal stakeholders, plus LLM and external reviewers without prior context.
> **Posture:** Product / strategic, not technical. Engineering detail belongs in the spec that follows.
> **Relationship to other work:** This is **Phase 1** of the broader agent workspace strategy described in `docs/agent-cloud-compute-dev-brief.md`. It ships before agent workspace (Phase 2) because the workspace UI depends on this knowledge retrieval foundation working correctly. This brief stands on its own; auto knowledge retrieval is valuable independently of the agent workspace work.
>
> **Mockups attached** (in `_archive/prototypes/auto-knowledge-retrieval/`):
> - [Index of all mockups](../_archive/prototypes/auto-knowledge-retrieval/index.html)
> - **Mockup 1:** [Knowledge: Files tab (new)](../_archive/prototypes/auto-knowledge-retrieval/knowledge-files-tab.html)
> - **Mockup 2:** [Add to Knowledge modal](../_archive/prototypes/auto-knowledge-retrieval/add-to-knowledge-modal.html)
> - **Mockup 3:** [Agent edit: Data Sources tab](../_archive/prototypes/auto-knowledge-retrieval/agent-data-sources.html)
> - **Mockup 4:** [Knowledge: Documents tab refreshed](../_archive/prototypes/auto-knowledge-retrieval/knowledge-documents-tab.html)
> - **Mockup 5:** [Document Detail modal](../_archive/prototypes/auto-knowledge-retrieval/document-detail-modal.html)
> - **Mockup 6:** [Knowledge: Bundles sub-tab](../_archive/prototypes/auto-knowledge-retrieval/knowledge-bundles-tab.html)
> - **Mockup 7:** [Bundle Edit modal](../_archive/prototypes/auto-knowledge-retrieval/bundle-edit-modal.html)
>
> **What's new in Rev 3:** Incorporates a thorough reviewer pass. Adds explicit retrieval ordering formula and invariants (§3), chunking model (§8), three new engineering-invariant sections (§9 retrieval observability, §10 tenant isolation, §11 lifecycle and re-embedding), elevates token-budget philosophy to a platform principle, strengthens bundle framing, reserves space for system-generated documents, and adds a §14 spec-risk areas section so the spec author knows where the booby-traps are.
>
> **What's new in Rev 4:** Three small high-leverage clarifiers from a final reviewer pass, plus one risk callout. Always-available documents participate in overall budgeting and must fail gracefully on overflow (§3). Retrieval injects relevant chunks, not whole documents by default (§8). Retrieval explainability is an operator-facing product principle, not just internal telemetry (§9). Reference-only mode must share infrastructure with Auto retrieval to avoid drift (§14). Brief is now considered final; further detail belongs in the implementation spec.

---

## Contents

1. What this brief is and the question it answers
2. The problem we're solving
3. The new model: Auto, Always available, Reference only
4. The five-tier hierarchy
5. Files vs Documents, how they relate
6. The Add to Knowledge flow
7. Memory blocks at additional tiers
8. The shared retrieval engine
9. Retrieval observability
10. Tenant isolation invariants
11. Lifecycle, versioning, and re-embedding
12. What this enables (Phase 2, agent workspace)
13. Decisions made
14. Spec-risk areas to watch
15. Out of scope for v1
16. Success criteria for v1
17. UI patterns established through mockups

---

## 1. What this brief is and the question it answers

Synthetos agents need access to the right knowledge at the right time. Today, an operator who wants their agent to "know" something has to upload a document, link it to the agent, decide whether it loads into every prompt or only on demand, and manage that linkage forever as documents come and go. This is the *eager-vs-lazy* maintenance burden. It scales badly — at 50 documents per agent, no human can sensibly decide which ones load into which task.

The question this brief answers: **how does Synthetos automatically deliver the right knowledge to the right agent at the right moment, without forcing the operator to configure it?**

The answer, in one sentence: **the operator links a document to a scope; the system handles the rest** — generating a summary, embedding it, retrieving only the documents semantically relevant to each task at run time, while honouring sensible overrides for the rare cases where the system should always or never load a document.

This is a brief, not a spec. It captures the design decisions reached through reviewer iteration. Engineering detail (schema, API contracts, migration, etc.) belongs in the spec that follows.

## 2. The problem we're solving

The current model has three failure modes:

1. **The maintenance tax.** Every document linked to an agent has a "loading mode" (eager or lazy). Choosing wrong wastes tokens (eager docs that aren't relevant) or wastes runs (lazy docs the agent doesn't know to fetch). At small scale this is annoying; at scale it's unworkable.
2. **The relevance gap.** Memory blocks already use semantic retrieval — the system loads only the memory entries relevant to the current task. Documents don't. They're loaded by linkage alone, regardless of whether they have anything to do with what the agent is currently doing. Two parallel knowledge primitives, two different mental models, one of which is markedly smarter.
3. **The hierarchy gap.** Documents can be linked to a specific agent or scheduled task, but there's no clean way to pin a document to *all agents in a sub-account* or *all agents across an entire organisation.* An agency that wants every client's agents to have access to a brand briefing has to manually link it to each agent. That doesn't scale.

The fix is to extend the proven memory-block retrieval pattern to documents, add the missing scopes, and remove the user-facing eager/lazy concept entirely.

## 3. The new model: Auto, Always available, Reference only

Three modes. The default is Auto. The other two are escape hatches for the rare cases.

### Auto (default)
The document is in the **candidate pool** for the scope it's linked to. When the agent runs a task, the system embeds the task description and runs vector similarity against all candidate documents. Documents above a minimum **relevance threshold** are loaded in score order until either all relevant documents are loaded or the token budget cap is reached.

Critical: **the budget is a cap, not a target.** The system never loads documents to fill the budget. If only one document is relevant, only one loads. If none are relevant, none load. Most tasks load zero to three documents. The cap is a backstop for the rare case where many documents are genuinely relevant.

### Retrieval ordering and invariants

Retrieval is deterministic, in this order:

1. **Authorization filter.** Build the candidate pool from documents the agent is authorized to see (see §10). Documents outside that pool never enter retrieval, regardless of similarity.
2. **Threshold filter.** Drop any document whose relevance score is below the minimum threshold.
3. **Rank.** Compute the final ranking score: `final_score = (relevance_score × relevance_weight) + scope_bonus + recency_bonus + operator_pin_bonus`.
4. **Truncate to budget.** Load documents in `final_score` order until the token budget is reached.

**Hard invariants** the implementation must preserve:

- **Scope is a tiebreaker, not a multiplier.** Scope bonuses are bounded and small. They MUST NEVER cause an irrelevant document to outrank a materially more relevant one. A highly-relevant agent-scope document beats a marginally-relevant org-pinned document; an org-pinned document only "wins ties" against documents at similar relevance scores.
- **Always-available documents bypass threshold and ranking.** They load every run. They are the only category that ignores relevance. **They do, however, still participate in overall context budgeting.** If the always-available set alone exceeds safe context limits, the system must fail gracefully and surface operator guidance (rather than silently truncating or unbounded expansion). Always-available is a relevance bypass, not a budget bypass.
- **Reference-only documents never enter the candidate pool.** Their manifest is added to the prompt; their content is fetched by the agent on demand via tool call.
- **Operator pins are bounded too.** A user-pinned document gets a bonus, but the same hard rule applies: the bonus must never cause irrelevant content to outrank relevant content.

### Platform principle: retrieval quality over retrieval volume

This system is intentionally not optimised for "how many documents can we fit." It is optimised for "how few documents can we load while still answering well."

> **Retrieval quality is prioritised over retrieval volume.** The system always prefers loading fewer highly-relevant documents over many marginally-relevant documents.

This shapes every threshold-tuning decision, every UI surface that shows the model's behaviour, and every default that ships. Future improvements (better re-ranking, learned thresholds, cross-encoder rescoring) all serve this principle. Reviewers and spec authors should weight any proposed change against it.

### Always available
The document is loaded into every run regardless of relevance. Use for compliance rules, brand voice guidelines, or any context the agent must always have. Replaces the old "eager" mode for cases where the operator genuinely needs the guarantee.

### Reference only
The document is never auto-loaded. Only its title and a 1-2 sentence summary appear in the prompt as a manifest entry. The agent calls a tool to fetch the full content when it explicitly decides it needs to. Use for huge manuals, codebases, or reference material the agent should look up rather than memorise.

The UI shows all three with descriptive helper text inline, and defaults Auto on every document. 99% of documents stay in Auto and the operator never thinks about loading mechanics again.

## 4. The five-tier hierarchy

Documents can be linked at five scopes, ordered from most specific to least specific. The retrieval engine searches across the union of all scopes the agent has access to.

| Tier | Scope | Use case |
|---|---|---|
| 1. Task instance | A single task run | One-off attachment for a specific question |
| 2. Recurring task | A scheduled task definition (e.g. nightly CRM hygiene) | Knowledge specific to a recurring job |
| 3. Agent | A specific agent | Knowledge this agent always uses |
| 4. Sub-account | All agents in a client workspace | Client-specific knowledge (CRM context, brand, voice) |
| 5. Organisation | All agents across all sub-accounts | Agency-level knowledge (master playbook, agency-wide rules) |

When an agent runs, the candidate pool is the union of documents at every tier the agent is exposed to. The retrieval engine picks the most relevant from across the union.

**Scope is determined by where the document is added.** Adding from the Knowledge page in a sub-account view defaults to sub-account scope; adding from the org view defaults to org-wide; adding from the Agent edit Data Sources tab defaults to agent scope; adding from a Manage Task page defaults to task instance. Operators don't pick a scope from a menu in the common case — the surface they're on tells the system. Org-admin operators can promote upward.

When relevant documents come from multiple tiers and the budget is tight, **more-specific scopes win ties** — task instance beats recurring task beats agent beats sub-account beats org. Specific knowledge beats general when relevance scores are close.

## 5. Files vs Documents, how they relate

Files and Documents are kept as **separate primitives** because they have fundamentally different roles in how the system works:

- **Documents** are *what an agent knows.* They're loaded into agent context (eager via Always available, smartly via Auto, on-demand via Reference only). They have token costs, scopes, and retrieval rules. They live in the database as durable text content.
- **Files** are *what an agent has produced or used.* They're artifacts — CSVs, images, generated reports — tied to specific runs. They're not in the agent's prompt unless explicitly cited. They live in object storage (S3/R2) with metadata in the database.

Different lifecycles, different costs, different mental models. Forcing them into one storage layer would either bloat the database with binaries or destroy query power on knowledge content. Keeping them separate is the right architectural call.

But the user mental model should be **"stuff in my workspace,"** not *"where is my stuff."* So both surfaces live on the **Knowledge page** as sibling tabs, and the bridge between them is a one-click promotion flow (§6).

The Knowledge page tab strip becomes:

- **Authored memory** — manually written facts, rules, preferences (existing)
- **Auto-memory** — agent-extracted memory pending review (existing)
- **Documents** — durable knowledge documents with scope and mode (existing, refreshed for new model)
- **Files** — agent-produced artifacts across all runs (new tab, surfaces what already exists in the database)

A file becomes a document via the **Add to Knowledge** action (§6). This is the only direction we support; promoting an artifact to durable knowledge. The reverse (document to file) is uncommon and unsupported in v1.

### What bundles are, and what they aren't

The Knowledge → Documents tab has a *Bundles* sub-tab (existing primitive). To prevent ambiguity:

> **Bundles are organisational and operational groupings only. Retrieval still occurs at the document level. Bundles do not alter semantic ranking behaviour.**

A bundle is a curatorial collection of documents you can attach to an agent or task in one action, or clone across sub-accounts. A document inside a bundle is retrieved per its own mode and scope; the bundle does not modify relevance scoring, threshold behaviour, or token budget rules. Mode is set on the document, not on the bundle. This is enforced in the UI (Bundle Edit modal shows mode chips read-only) and called out in the brief here so it does not drift during spec.

## 6. The Add to Knowledge flow

The user clicks the three-dot menu on a file row → **Add to Knowledge.** A modal opens.

**The modal asks for:**

1. **Title** — pre-filled from filename, editable.
2. **Content preview** — auto-extracted text from the file (when extractable; e.g. PDF text, Markdown, transcript).
3. **Scope** — defaults to the surface the file came from (sub-account / org / agent). Org-admin sees "Promote to org-wide" if applicable.
4. **Apply to** — defaults to "All agents in scope." Power users can pick specific agents from a multi-select.
5. *(Advanced expander, hidden by default)* — option to override mode to *Always available* or *Reference only.* 99% of users skip this; the default Auto handles them.

**On confirm:**

- A new Reference Document is created with the extracted content.
- Document Data Source links are created at the chosen scope.
- The system runs the document through the cheap-LLM summariser (one-time, async) and generates an embedding.
- The source file gets a **"Linked: [Document name]"** indicator on its row.
- The source file is automatically marked durable (no TTL expiry) so the link remains valid.

**Auto-suggestion path** (parallel feature): when an agent produces a text-heavy output (markdown summary, transcript, structured report), the agent emits a *"candidate for knowledge"* hint. The file appears in the **Auto-memory tab** alongside agent-extracted memory entries. The user clicks Approve and it's promoted via the same flow with sensible defaults. No new UI surface; this reuses the existing Auto-memory pending-review pattern.

This means most knowledge accumulation happens via review-and-approve, not manual addition. The operator stays in control without doing the curation work.

### System-generated documents (future-native concept)

The promotion flow above covers *agent-produced files become durable documents*. The architecture should reserve conceptual space for a stronger version: **agents synthesizing reusable knowledge directly**, without going through a file step.

Example future flow:
- An agent completes a research task across many runs.
- The agent identifies a recurring pattern worth keeping ("Acme Corp's primary buyer always asks about SOC 2 first").
- The agent emits a *knowledge candidate* directly (no intermediate file).
- The candidate appears in the Auto-memory tab for operator approval.
- On approval, it becomes a durable Reference Document with the standard scope and mode controls.

We are NOT building this in v1. The brief reserves the concept so the schema, the source-provenance taxonomy, and the Auto-memory tab UX can accommodate it without rework when it ships. Concretely: the document source taxonomy includes a future *"synthesised by agent"* badge alongside the current *"From file"*, *"Approved from auto-memory"*, *"Manually authored"*, *"Uploaded"* badges.

## 7. Memory blocks at additional tiers

Memory blocks today support three scopes (org, sub-account, agent). Documents in this brief use five scopes (org, sub-account, agent, recurring task, task instance).

When the shared retrieval engine (§8) is built, **memory blocks gain the recurring-task scope** as a free side-effect. This is genuinely valuable: a recurring task running daily for months accumulates patterns specific to that scheduled job (e.g. *"the inbox cleanup agent learned that emails from this vendor are always promotional"*). That knowledge is task-bound, not agent-bound, and there's nowhere clean to put it today.

**Memory blocks do not gain the task-instance scope.** Memory is persistent by definition; task instances are ephemeral. Putting persistent memory at an ephemeral scope creates a mental-model contradiction. What you'd actually want at task-instance level is *"facts the agent learned during this run"* — which is exactly what Auto-memory already captures.

Final tier matrix:

| Tier | Memory blocks | Documents |
|---|---|---|
| Org | Yes (existing) | Yes (new) |
| Sub-account | Yes (existing) | Yes (existing) |
| Agent | Yes (existing) | Yes (existing) |
| Recurring task | **Yes (new)** | Yes (existing) |
| Task instance | No | Yes (existing) |

Documents support five tiers because they can be one-off attachments to a single run; memory blocks support four because persistent knowledge at an ephemeral scope doesn't make sense.

## 8. The shared retrieval engine

Today, memory blocks have a relevance ranker buried in the memory-block service. Documents have nothing equivalent; they're loaded by linkage alone.

The build extracts the existing ranker into a small shared **RetrievalService** that:

- Takes a set of candidate items (memory blocks or documents) with embeddings already computed.
- Applies the relevance threshold and ranks by similarity to the current task context.
- Honours the token budget cap as a backstop.
- Returns the items to load, in priority order.

Memory blocks and documents each have their own data-source layer (different tables, different scoping rules) but plug into the same ranker. The infrastructure that already exists; OpenAI `text-embedding-3-small`, pgvector storage, cosine similarity, stays exactly as it is. Documents adopt it.

This abstraction is small but high-leverage:

- Single source of truth for relevance ranking, threshold tuning, and budget enforcement.
- Future improvements (better re-ranking, cross-encoder rescoring, learned threshold tuning) ship to both primitives at once.
- New knowledge primitives in the future (e.g. structured CRM entities) can plug into the same engine.

Cost per task at scale: under one cent of embedding overhead per run. End-to-end retrieval latency: under 100ms added per run. Already proven by memory blocks in production today.

### What gets embedded (chunking model)

Critical decision the spec must lock: **retrieval operates on chunked semantic units, not whole-document embeddings.**

- During ingestion, documents are split into semantically coherent chunks. Chunk size and boundaries are tuned for the embedding model in use; the spec author owns the tuning.
- Each chunk gets its own embedding and is independently retrievable.
- **Retrieval operates at chunk granularity. The system may inject only the relevant portions of a document, not necessarily the entire document.** A chunk match identifies the relevant content; the system decides whether to inject just that chunk (with optional surrounding chunks for coherence) or the full document, based on size and relevance. The default is *inject the relevant portions, not the whole document* — full-document injection is the exception, not the rule.
- Whole-document embeddings are NOT used. They scale poorly (embedding quality drops as documents get longer) and produce worse retrieval.

This decision determines whether the system handles a 50-page playbook gracefully or chokes. The spec author should treat chunking as a first-class engineering concern with explicit tests for boundary conditions (very short documents, very long documents, mixed-content documents).

**For the *Reference only* mode** (large manuals, codebases): chunks are still indexed for the manifest preview, but the full content is fetched on-demand by the agent rather than auto-loaded. This preserves the manifest-only behaviour while still benefiting from chunked semantic indexing.

## 9. Retrieval observability

Without this, debugging is guesswork and operators won't trust the system. **First-class concept, not an afterthought.**

> **Operator-facing principle:** *Retrieval behaviour should be inspectable by operators. The system should explain why documents were or were not loaded.* Observability is not just internal telemetry; it is a product surface.

For every agent run, the system must record:

- **Candidate pool size** for each tier (org / sub-account / agent / recurring task / task instance).
- **Retrieved documents** with their final score, mode, and tier.
- **Rejected documents that were above threshold** but didn't make it into context, with the reason: budget exhausted, lower-scoring at tie, etc.
- **Rejected documents below threshold** (counts only, not full list): how many candidates were filtered before ranking.
- **Token contribution per document** loaded.
- **Retrieval score per document** loaded.
- **Reference-only fetches** the agent invoked during the run via tool call.

This data powers four operator-facing surfaces and one internal one:

- **"Why was this loaded?" tooltip** on each document row in Agent Data Sources and Documents tabs. Hover shows the recent task contexts where this document scored above threshold, in plain language ("Frequently retrieved for CRM enrichment and lead scoring tasks").
- **"Why wasn't this loaded?"** drill-in on a specific run trace, showing which documents were considered, scored, and rejected, with reasons.
- **"Loaded in N of last 30 runs" relevance bar** (already in mockups) backed by this data.
- **Token usage per workspace and per agent**, for the spending / budget surface.
- **Internal telemetry** for the engineering team: relevance threshold tuning, retrieval drift detection, embedding model evaluation, RAG quality benchmarking.

The data feed is structured (per-run JSON in the LLM observability ledger that already exists in the codebase). Spec author should choose between: (a) write to existing ledger with new event types, or (b) dedicated `retrieval_events` table. Recommend (a) for v1, can split later if volume justifies.

Without retrieval observability, four things go wrong: operators don't trust retrieval, debugging is impossible, token optimisation is guesswork, support burden balloons. This section is non-negotiable for v1.

## 10. Tenant isolation invariants

This is a security concern, not just an architectural concern.

**Hard invariants** the implementation must preserve:

> **Authorization filtering occurs BEFORE semantic retrieval.** A document outside the agent's authorized scope MUST NEVER enter the retrieval candidate pool, regardless of semantic similarity.

Concretely:

- **Cross-org boundary is absolute.** Retrieval never crosses organisations. An agent in Org A cannot see Org B's documents under any condition.
- **Sub-account isolation is enforced at the candidate-pool level.** An agent in sub-account X with sub-account-scoped documents available cannot see sub-account Y's documents.
- **Org-pinned documents flow downward only.** An org-pinned document is visible to all sub-accounts in that org. The reverse is impossible.
- **Embeddings are tenant-scoped.** The vector store schema must enforce org_id (and sub-account_id where relevant) on every embedding row. RLS policies apply before similarity search.
- **The candidate pool is constructed from authorization first, then filtered by relevance.** The order matters: never retrieve, then filter; always filter, then retrieve.

This applies equally to memory blocks and to documents (both run through the shared RetrievalService). The spec must include explicit RLS / authorization tests that verify cross-tenant queries return empty pools, never partial results.

## 11. Lifecycle, versioning, and re-embedding

Knowledge artifacts are not static. The system must handle change over time without requiring operator intervention.

**Lifecycle philosophy** the spec must build to:

> **Knowledge artifacts are versioned and re-indexable. Embedding generations are replaceable infrastructure, not permanent truth. The system supports background re-embedding and retrieval regeneration without operator intervention.**

Concretely, the system handles:

- **Document edited.** Re-summarise (cheap LLM) and re-embed in the background. Retrieval continues using the prior version until the new version is ready, then swaps atomically. UI shows a `summary_stale` flag during the brief catch-up window.
- **Source file changes** (e.g. underlying CSV updated). Same as document edit.
- **Bundle changes.** Bundle composition affects which documents are pulled into a scope; the affected documents' linkage is updated, no re-embedding needed.
- **Embedding model upgrades.** When OpenAI ships text-embedding-4-small or we choose to migrate, the system supports a background re-embedding job that walks every document and replaces the vectors. No operator intervention. Old embeddings remain valid until the new ones are ready, then swapped.
- **Extraction quality improvements.** As text extraction from PDFs / images improves, documents derived from those sources should support being re-extracted and re-embedded without losing their linkage history or scope settings.

What the spec must include:

- A `summary_stale` flag (or equivalent) that surfaces transitional states.
- A background job that re-embeds documents whose source has changed, on a configurable cadence.
- A migration path for embedding-model upgrades.
- Clear ownership: re-embedding is the system's job, not the operator's. The UI never asks the user to "click here to update embeddings."

This is the difference between v1 working at scale and v1 becoming a pile of operational debt the team has to manually maintain.

## 12. What this enables (Phase 2, agent workspace)

This work ships as Phase 1 of the broader agent workspace strategy described in `docs/agent-cloud-compute-dev-brief.md`. It is valuable in its own right — smarter knowledge retrieval improves every agent run regardless of whether the workspace UI ever ships. But it is also a prerequisite for several Phase 2 surfaces:

- The **per-agent Data Sources tab** becomes a clean view of what an agent knows, with relevance signals and easy linking. Today it's complicated by eager/lazy decisions; once those are gone, it simplifies dramatically.
- The **Add to Knowledge flow on artifacts** lets an agent's run output flow back into its persistent knowledge in one click — directly supporting the "agent embodiment" surface the workspace UI delivers.
- **Org-wide and sub-account-wide pinning** unlocks agency-tier value: brand briefs, agency playbooks, and shared rules flow down to every client without per-agent linkage. This is a structural fit for the multi-tenant model that differentiates Synthetos from VM-per-agent competitors.
- **Memory blocks at the recurring-task tier** lets long-running scheduled work accumulate task-bound learning, which surfaces naturally in the agent workspace UI later.

In short: shipping Phase 1 first means Phase 2 mockups are simpler, the agent workspace surface has better content to display, and several Phase 2 decisions get easier.

## 13. Decisions made

All decisions reached and approved through reviewer iteration. Recorded here for the spec authors.

| # | Decision | Approved direction |
|---|---|---|
| 1 | Default mode for documents | **Auto** — embedding-based retrieval, relevance-thresholded, budget-capped. |
| 2 | Override modes | **Always available** (force-load every run) and **Reference only** (manifest only, agent fetches on demand). Both opt-in, hidden behind an Advanced expander. |
| 3 | Token budget behaviour | **Cap, not target.** Only relevant docs above the threshold load. Most tasks load 0-3 documents. |
| 4 | Hierarchy tiers (documents) | Five tiers: org, sub-account, agent, recurring task, task instance. |
| 5 | Hierarchy tiers (memory blocks) | Four tiers: gain recurring task; skip task instance. |
| 6 | Scope determined by | Where the document is added from (sub-account view, org view, agent edit, manage task). No scope picker in the common case. |
| 7 | Embedding provider | OpenAI `text-embedding-3-small` (existing, already in production for memory). No change. |
| 8 | Files vs Documents | Stay separate primitives. Unified UX on the Knowledge page (sibling tabs). One-click promotion via Add to Knowledge. |
| 9 | Auto-suggestion of files-to-knowledge | Yes — reuses the existing Auto-memory pending-review pattern. |
| 10 | When to update summary/embedding | Async, in background, within seconds of save. `summary_stale` flag while pending. |
| 11 | Backfill of existing documents | Not required — dev environment with no existing documents. |
| 12 | Who can pin org-wide | Org admins only. Promotion-request flow can come later if needed. |
| 13 | Multi-scope budget allocation | One shared budget; more-specific scopes win ties. |
| 14 | Document deletion | Cascade delete with audit log; affected agents see a notice on their Data Sources tab. |
| 15 | Cold-start (new agent first task) | No special handling. Works as normal; relevance improves as task corpus grows. |
| 16 | Telemetry | Yes from day one. Track loaded docs per run, relevance scores, costs, latency. |
| 17 | Cost attribution | Sub-account Compute Budget. Same place agent runs are billed. |
| 18 | Always-available abuse | Soft warn in UI when total Always-available token cost exceeds threshold. No hard cap in v1. |
| 19 | Relevance threshold | Calibrated empirically. Start with default (e.g. cosine 0.6). Tune from telemetry. |
| 20 | Branch separation | Ship as its own feature on `claude/auto-knowledge-retrieval` (or similar) before agent workspace work resumes. |

## 14. Spec-risk areas to watch

The spec author and implementer should treat these as the messy areas. Each one is more likely than average to require iteration, careful design, and explicit testing.

| Area | Risk |
|---|---|
| Chunking strategy (§8) | Huge downstream impact on retrieval quality. Wrong choice scales poorly. |
| Relevance threshold tuning (§3) | Threshold drift over time as document corpora grow. Needs telemetry-driven tuning. |
| Cross-tier ranking (§3) | Non-deterministic behaviour if scope bonus is unbounded. Hard invariant in §3 must be tested. |
| Reference-only mode UX | Risk that agents ignore the manifest and don't fetch when they should. Tool-call behaviour needs prompt-level reinforcement. |
| Massive documents (>50K tokens) | Potential token explosions if Reference-only mode isn't selected correctly. Default behaviour for large uploads needs care. |
| Bundle semantics (§5) | User confusion: are bundles for retrieval, organisation, security, or all? Brief locks the answer (organisational only); spec must enforce. |
| Re-embedding lifecycle (§11) | Operational debt if not built in from v1. Stale embeddings produce silent retrieval drift. |
| Retrieval observability (§9) | Without it, debugging is impossible. Build it day one, not as a v1.1 follow-on. |
| Tenant isolation (§10) | Security risk if RLS / authorization order is wrong. Must be explicitly tested with cross-tenant query attempts. |
| "Always available" abuse | Cost blowout if users mark many documents as Always available. v1 has soft warning only; revisit hard caps if real abuse emerges. |
| Reference-only as second retrieval system | Long term, "Reference only" tool-fetched docs and Auto retrieved docs may drift apart in quality, ranking, and observability. The spec should keep both paths on shared infrastructure: shared chunk store, shared ranking logic, shared authorization, shared observability. Otherwise operators eventually ask *"why can the tool find it but auto retrieval can't?"* |

The spec author should produce explicit test cases for each of these. Where ambiguity remains after the spec, flag back to the brief author rather than guessing.

## 15. Out of scope for v1

- **Document version-aware retrieval.** A document can be revised; the system uses the latest version. Diff-based retrieval (load the old version when relevant context is older) is not in v1.
- **Cross-encoder re-ranking.** Pure cosine similarity for v1; future re-ranking with a small LLM if telemetry shows we need it.
- **Per-agent or per-user Always-available token budget caps.** Soft warning in v1; hard caps come later if abuse emerges.
- **Document-level search UI.** Operators will be able to see what's linked but not run ad-hoc semantic search. That's a future feature if demand surfaces.
- **Document → File reverse promotion.** Uncommon, not supported.
- **Promotion-request workflow** for sub-account admins to request org pinning. v1 is org-admin-only; promotion flow comes later if needed.
- **Multilingual retrieval.** Embeddings work across languages but retrieval quality is best in English. Future improvement.
- **Custom embedding provider per workspace.** All workspaces use OpenAI text-embedding-3-small for v1.

## 16. Success criteria for v1

A non-technical operator can:

- Add a document to a sub-account (or org-wide if they're an org admin) without choosing a loading mode. The system handles retrieval automatically.
- Click "Add to Knowledge" on an agent-produced file and have it promoted to a durable document in three clicks or fewer.
- See, on the Agent edit Data Sources tab, what documents the agent has access to — with a relevance signal indicating how often each is actually used.
- Pin a document to the entire organisation and have every client's agents pick it up automatically.
- Add 50 documents to a sub-account without any of them blocking or bloating their agents' runs. The system loads only the relevant ones per task.

A reasonable internal observer can:

- Verify that the document and memory-block retrieval engines share a single ranker (no duplicated logic).
- Verify that retrieval latency stays under 100ms added per run.
- Verify that telemetry captures relevance scores, loaded documents, and token costs per run for tuning.
- Verify that documents flagged Always available always load and Reference only never auto-load.

The competitive frame writes itself: *"Your agents see the right knowledge at the right moment, automatically. You curate; we route."*

## 17. UI patterns established through mockups

Three rounds of mockup feedback (May 2026) established a set of UI decisions for this feature. They are captured here so the spec author and the implementer don't re-litigate them, and so future surfaces in the product can adopt the same patterns. Many of these have been promoted into `docs/frontend-design-principles.md` as recurring patterns.

**Decisions about controls and surfaces:**

1. **Mode is changed via the three-dots menu, not via an inline dropdown.** Mode rarely changes after the initial choice. Inline dropdowns invited fiddling and added visual noise. The menu has a *"Change mode ›"* item that opens a flyout with Auto / Always available / Reference only.
2. **Three-dots menus stay short** (6 to 8 items max). Grouped sub-options (mode, scope) collapse into single items with chevron flyouts, not expanded inline sections.
3. **"Open document" and "Edit details" merge into one action.** Row-click opens the detail modal; the menu has *Edit*, never both.
4. **Source / origin badges only appear for non-default cases.** "Manually authored" is the default and gets no badge. *"From file"*, *"Approved from auto-memory"*, *"Uploaded PDF"* are non-default and do get badges.

**Decisions about modals:**

5. **The Add to Knowledge modal is minimal by default.** Title, content preview, and (for org admins only) scope. Available-to and mode override live behind a collapsed *Advanced* expander. Most users complete the action with default everything.
6. **Scope picker is hidden for non-org-admins.** The control is absent from the DOM, not disabled. Org admins see it with a small *"Org admin only"* pill on the field label.
7. **Document Detail modal is a two-column layout.** Main column has editable fields (title, content, mode, scope, available to). Side panel has read-only metadata (tier, size widget, created info, linked agents with usage bars).
8. **Bundle Edit modal shows per-document mode chips as read-only.** Mode is set on each document, not on the bundle. This is enforced by the UI and explicitly called out (dismissable) in the modal.

**Decisions about token / cost / size information:**

9. **Token counts are never shown by default.** No per-document token counts, no per-run cost tiles, no embedding-size detail in user-facing surfaces.
10. **Size is shown only as a warning chip when over recommended.** A "⚠ Large document" chip appears on the doc name when a document exceeds the recommended size threshold. The chip carries the action: *something here is unusual, you might want to look*.
11. **The Document Detail modal has one expanded size widget** (visual bar + qualitative label like "Small"). Acceptable because users opening the modal are doing so deliberately. Still no raw numbers as the primary information.

**Decisions about page-level chrome:**

12. **Stat tiles capped at 2 per list page.** Each one must be something the operator would act on. Operational metrics (avg per run, cost MTD) do not qualify.
13. **Explainer banners are dismissable.** All info banners ship with a `×` close button that persists per-user. Permanent help copy is not shipped.
14. **Filter pills appear when collection size justifies them** (rough threshold: more than 8 items). Below that, search alone is enough.
15. **Footer notes are avoided** when a banner above already covers the same content.

**Decisions about copy and content:**

16. **No em-dashes in any UI copy or sample data.** Use commas, colons, or rewrite. Applies to mockup data (sample document names) too.
17. **Row sub-text is trimmed to one most-actionable fact.** Mime types, run identifiers, and verbose author / version metadata do not appear in default rows.
18. **"Used by" copy drops the contextual scope when the breadcrumb already provides it.** *"9 agents"* not *"9 agents in Acme Corp"*.

These decisions are visible in the mockups linked in the brief header. The mockups should be considered the authoritative reference for any disagreement between this list and the implementation.

---

> **Brief is final at Rev 4.** Design decisions in §13; UX in §17 and the linked mockups. Architectural invariants in §3 (retrieval ordering), §8 (chunking), §9 (observability), §10 (tenant isolation), §11 (lifecycle). Risk surface in §14. The reviewer's final assessment was *"strategically coherent, product-complete for pre-spec, implementation-guiding, reviewer-friendly, architecturally safe to proceed without being overengineered."* Further conceptual revisions should arise only from new evidence, not from re-framing.
>
> **Next move:** create a fresh branch (`claude/auto-knowledge-retrieval` or similar), invoke the architect agent against this brief, and produce a proper implementation spec. After that ships, the agent workspace work in `docs/agent-cloud-compute-dev-brief.md` resumes on its branch with this foundation in place.
