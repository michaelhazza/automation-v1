# Auto Knowledge Retrieval — Development Brief

> **Status:** Rev 1 — first draft. Pre-spec, pre-review.
> **Date:** 2026-05-08
> **Branch:** to be created (`claude/auto-knowledge-retrieval` or similar)
> **Audience:** Internal stakeholders, plus LLM and external reviewers without prior context.
> **Posture:** Product/strategic, not technical. Engineering detail belongs in the spec that follows.
> **Relationship to other work:** This is **Phase 1** of the broader agent workspace strategy described in `docs/agent-cloud-compute-dev-brief.md`. It ships before agent workspace (Phase 2) because the workspace UI depends on this knowledge retrieval foundation working correctly. This brief stands on its own — auto knowledge retrieval is valuable independently of the agent workspace work.

---

## Contents

1. What this brief is and the question it answers
2. The problem we're solving
3. The new model — Auto, Always available, Reference only
4. The five-tier hierarchy
5. Files vs Documents — how they relate
6. The Add to Knowledge flow
7. Memory blocks at additional tiers
8. The shared retrieval engine
9. What this enables (Phase 2 — agent workspace)
10. Decisions made
11. Out of scope for v1
12. Success criteria for v1

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

## 3. The new model — Auto, Always available, Reference only

Three modes. The default is Auto. The other two are escape hatches for the rare cases.

### Auto (default)
The document is in the **candidate pool** for the scope it's linked to. When the agent runs a task, the system embeds the task description and runs vector similarity against all candidate documents. Documents above a minimum **relevance threshold** are loaded in score order until either all relevant documents are loaded or the token budget cap is reached.

Critical: **the budget is a cap, not a target.** The system never loads documents to fill the budget. If only one document is relevant, only one loads. If none are relevant, none load. Most tasks load zero to three documents. The cap is a backstop for the rare case where many documents are genuinely relevant.

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

## 5. Files vs Documents — how they relate

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

A file becomes a document via the **Add to Knowledge** action (§6). This is the only direction we support — promoting an artifact to durable knowledge. The reverse (document → file) is uncommon and unsupported in v1.

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

**Auto-suggestion path** (parallel feature): when an agent produces a text-heavy output (markdown summary, transcript, structured report), the agent emits a *"candidate for knowledge"* hint. The file appears in the **Auto-memory tab** alongside agent-extracted memory entries. The user clicks Approve and it's promoted via the same flow with sensible defaults. No new UI surface — this reuses the existing Auto-memory pending-review pattern.

This means most knowledge accumulation happens via review-and-approve, not manual addition. The operator stays in control without doing the curation work.

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

Today, memory blocks have a relevance ranker buried in the memory-block service. Documents have nothing equivalent — they're loaded by linkage alone.

The build extracts the existing ranker into a small shared **RetrievalService** that:

- Takes a set of candidate items (memory blocks or documents) with embeddings already computed.
- Applies the relevance threshold and ranks by similarity to the current task context.
- Honours the token budget cap as a backstop.
- Returns the items to load, in priority order.

Memory blocks and documents each have their own data-source layer (different tables, different scoping rules) but plug into the same ranker. The infrastructure that already exists — OpenAI `text-embedding-3-small`, pgvector storage, cosine similarity — stays exactly as it is. Documents adopt it.

This abstraction is small but high-leverage:

- Single source of truth for relevance ranking, threshold tuning, and budget enforcement.
- Future improvements (better re-ranking, cross-encoder rescoring, learned threshold tuning) ship to both primitives at once.
- New knowledge primitives in the future (e.g. structured CRM entities) can plug into the same engine.

Cost per task at scale: under one cent of embedding overhead per run. End-to-end retrieval latency: under 100ms added per run. Already proven by memory blocks in production today.

## 9. What this enables (Phase 2 — agent workspace)

This work ships as Phase 1 of the broader agent workspace strategy described in `docs/agent-cloud-compute-dev-brief.md`. It is valuable in its own right — smarter knowledge retrieval improves every agent run regardless of whether the workspace UI ever ships. But it is also a prerequisite for several Phase 2 surfaces:

- The **per-agent Data Sources tab** becomes a clean view of what an agent knows, with relevance signals and easy linking. Today it's complicated by eager/lazy decisions; once those are gone, it simplifies dramatically.
- The **Add to Knowledge flow on artifacts** lets an agent's run output flow back into its persistent knowledge in one click — directly supporting the "agent embodiment" surface the workspace UI delivers.
- **Org-wide and sub-account-wide pinning** unlocks agency-tier value: brand briefs, agency playbooks, and shared rules flow down to every client without per-agent linkage. This is a structural fit for the multi-tenant model that differentiates Synthetos from VM-per-agent competitors.
- **Memory blocks at the recurring-task tier** lets long-running scheduled work accumulate task-bound learning, which surfaces naturally in the agent workspace UI later.

In short: shipping Phase 1 first means Phase 2 mockups are simpler, the agent workspace surface has better content to display, and several Phase 2 decisions get easier.

## 10. Decisions made

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

## 11. Out of scope for v1

- **Document version-aware retrieval.** A document can be revised; the system uses the latest version. Diff-based retrieval (load the old version when relevant context is older) is not in v1.
- **Cross-encoder re-ranking.** Pure cosine similarity for v1; future re-ranking with a small LLM if telemetry shows we need it.
- **Per-agent or per-user Always-available token budget caps.** Soft warning in v1; hard caps come later if abuse emerges.
- **Document-level search UI.** Operators will be able to see what's linked but not run ad-hoc semantic search. That's a future feature if demand surfaces.
- **Document → File reverse promotion.** Uncommon, not supported.
- **Promotion-request workflow** for sub-account admins to request org pinning. v1 is org-admin-only; promotion flow comes later if needed.
- **Multilingual retrieval.** Embeddings work across languages but retrieval quality is best in English. Future improvement.
- **Custom embedding provider per workspace.** All workspaces use OpenAI text-embedding-3-small for v1.

## 12. Success criteria for v1

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

---

> **Note for the next reviewer.** This is Rev 1. Decisions reached through three reviewer rounds; all 20 decisions in §10 are approved. The remaining work is engineering — schema design, migration plan, telemetry shape, UX polish, and the spec that drives implementation. The next move is creating a fresh branch (`claude/auto-knowledge-retrieval` or similar), invoking the architect agent against this brief, and producing a proper implementation spec. After that ships, the agent workspace work in `docs/agent-cloud-compute-dev-brief.md` can resume on its branch with this foundation in place.
