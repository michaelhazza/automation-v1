# External patterns review — `awesome-llm-apps`

**Source:** https://github.com/Shubhamsaboo/awesome-llm-apps (Apache-2.0, ~100+ runnable demos)
**Date:** 2026-04-24
**Author:** Claude Code (research branch `claude/review-llm-apps-repo-4xzO8`)
**Status:** For review — no code changes proposed in this commit

---

## Why this review exists

`awesome-llm-apps` is a curated gallery of self-contained LLM/agent demos. Most of it is a novelty catalogue — single-file Streamlit apps that don't translate to our backend/worker/client architecture. But four examples cover patterns this codebase will eventually need (or already has partial versions of), and the gallery's own "agent skills" taxonomy is a useful lens on how we're naming things in `server/skills/`.

This memo does a deep read of five components and, for each, answers three questions:

1. **What does it do?** (one paragraph, mechanical summary)
2. **How does our equivalent look today?** (citing specific files / line numbers)
3. **What's worth taking, worth ignoring, and why?**

The goal is concrete: by the end you should be able to say *"yes, file an ADR for X"* or *"no, we already have Y and it's better."* I have a strong opinion on each — push back if it's wrong.

## TOC

1. [Corrective RAG (`rag_tutorials/corrective_rag`)](#1-corrective-rag)
2. [Hybrid search RAG (`rag_tutorials/hybrid_search_rag`)](#2-hybrid-search-rag)
3. [Database routing RAG (`rag_tutorials/rag_database_routing`)](#3-database-routing-rag)
4. [Multi-MCP agent router (`mcp_ai_agents/multi_mcp_agent_router`)](#4-multi-mcp-agent-router)
5. [Skill taxonomy comparison (`awesome_agent_skills/` vs. `server/skills/`)](#5-skill-taxonomy-comparison)
6. [Overall recommendations](#overall-recommendations)
7. [Open questions for the user](#open-questions-for-the-user)

---

## 1. Corrective RAG

**Source:** `rag_tutorials/corrective_rag/corrective_rag.py` (453 lines, single file)
**Stack:** LangGraph, LangChain, Qdrant, Tavily, OpenAI embeddings, Claude for generation/grading.

### What it does

A five-node LangGraph state machine implements the "Corrective RAG" (CRAG) paper pattern. Flow:

```
retrieve → grade_documents → (if all relevant) → generate → END
                           → (if any not relevant) → transform_query → web_search → generate → END
```

1. **`retrieve`** — standard Qdrant vector search against the indexed document.
2. **`grade_documents`** — Claude grades each retrieved chunk against the question with a strict JSON-only prompt (`{"score": "yes"|"no"}`) and lenient criteria ("only filter clear mismatches"). A single "no" sets a `run_web_search` flag.
3. **`transform_query`** — Claude rewrites the user question into a "search-optimized" variant (semantic intent preserved, wording tuned for a web search engine).
4. **`web_search`** — Tavily advanced search with `tenacity` retries (3 attempts, exponential 4–10s backoff); results are stuffed back into the document list as a synthetic `Document`.
5. **`generate`** — final answer generation over the (possibly augmented) context.

The graph is declarative — `StateGraph(GraphState)` with `add_node`/`add_edge`/`add_conditional_edges`. Each node reads and writes a `keys` dict (single-level state bag, no channel reducers). On error in grading, documents are kept to be safe — "false positive beats false negative."

### How our equivalent looks today

| Concept | Their implementation | Our implementation | Gap? |
|---|---|---|---|
| Vector retrieval | Qdrant + OpenAI embeddings | pgvector + HNSW on `workspace_memory_entries` (`server/services/workspaceMemoryService.ts:326`) | None |
| Relevance grading | LLM-as-judge per chunk, "yes"/"no" | Cosine score threshold + optional Cohere rerank (`server/lib/reranker.ts:26`) | Different — we use reranker, not explicit grader |
| Query rewriting | LLM paraphrase on failure | HyDE expansion **always** (`workspaceMemoryService.ts:233`) | Ours runs unconditionally; theirs is fallback-only |
| Web search fallback | Tavily on grading miss | Not present in the retrieval path | **Present gap** |
| Decision routing | LangGraph conditional edge | No graph; linear call | Different pattern, not clear which is better for our shape |

### Worth taking, worth ignoring

**Take (medium value):**

- **The fallback-on-miss pattern.** Our retrieval always embeds, searches, reranks, and returns what it finds — good or bad. We have no "this retrieval is weak, escalate to live web" branch. For the agent-intelligence use cases where workspace memory is thin (new tenant, small corpus), a Tavily-or-equivalent fallback is the right move. This is a small addition: a relevance floor (top reranker score < threshold OR n_results < k) triggers a second retrieval against a web search skill. We already have `web_search.md` and `fetch_url.md` skills, so the plumbing is present — the logic isn't. **Size: ~1 day, pure service-layer change in `workspaceMemoryService` + a new "fallback trigger" config. No schema change.**

- **Query-rewrite as an *optional* second pass, not an always-on first pass.** We HyDE-expand on every query. That's fine for cold corpora but burns tokens unnecessarily when the raw question retrieves well. Worth measuring: if top-1 reranker score > X, skip HyDE. Defer this until we have retrieval telemetry.

**Ignore:**

- The LangGraph `StateGraph` pattern. Their graph has 5 nodes and one conditional edge — the state-machine overhead isn't worth it for flow that small. Our `runContextLoaderPure.ts` handles multi-source loading in plain TypeScript; adding a graph library to escape four `if` statements would be worse.
- LLM-as-judge grading per document. We already have Cohere rerank which does the same job cheaper and with calibrated scores. Their grader is a workaround for not having a reranker in the default LangChain toolchain.
- The `tenacity` retry decorator — we have first-class job infra (`server/jobs/`, BullMQ) for retry semantics; bolting `tenacity`-style retries onto in-process calls would fragment the retry story.

### Recommendation

**File an ADR for "retrieval fallback on low confidence."** Scope: a configurable floor on top rerank score that triggers a secondary retrieval via `web_search` or `fetch_url` skill. Not a graph; a 20-line branch in `workspaceMemoryService`. Value: the first time we encounter a tenant with empty workspace memory, this pattern is what rescues the UX.



## 2. Hybrid search RAG

**Source:** `rag_tutorials/hybrid_search_rag/main.py` (214 lines, single file)
**Stack:** RAGLite (thin wrapper), SQLite-backed vector store, OpenAI `text-embedding-3-large`, Cohere reranker, Claude for generation.

### What it does

Delegates almost everything to the `raglite` library:

1. **Config** — `RAGLiteConfig` holds embedder model, reranker provider, chunk size, sentence-window size, DB URL. One config object is passed to every call.
2. **Ingest** — `insert_document(Path, config)` handles chunking + embedding + storage.
3. **Retrieve** — `hybrid_search(query, num_results=10, config)` returns `(chunk_ids, scores)`. No explicit signal on how hybrid is scored — RAGLite internally combines BM25 (SQLite FTS) with vector similarity.
4. **Rerank** — `rerank_chunks(query, chunks, config)` calls Cohere Rerank.
5. **Generate** — `rag(prompt, system_prompt, search, messages, max_contexts=5, config)` — end-to-end RAG with streaming generation; takes the `hybrid_search` function as an injectable search primitive.
6. **Fallback** — if reranker returns empty chunks, a direct Claude call answers from general knowledge ("no relevant documents found; using general knowledge").

Notable: this is less a "pattern" and more a demo of a well-designed library. The interesting bit is the *interface shape*, not the implementation.

### How our equivalent looks today

| Concept | Their implementation | Our implementation | Gap? |
|---|---|---|---|
| Embedding | `text-embedding-3-large` via RAGLite | pgvector + our embedder (see `memoryBlocksEmbeddingBackfillJob.ts`) | None |
| BM25 / keyword search | Built in (SQLite FTS via RAGLite) | **Not present** — retrieval is vector-only | **Present gap** |
| Hybrid fusion | RAGLite internal (RRF or weighted, unclear) | N/A (would need BM25 first) | **Present gap** |
| Reranking | Cohere via RAGLite | Cohere in `server/lib/reranker.ts:40` | None |
| Sentence-window expansion | `embedder_sentence_window_size=2` — chunks include ±2 neighbor sentences in retrieval | Chunk-exact retrieval (no window) | Minor gap, likely low-value |
| Streaming generation | Yes, `rag(...)` returns a stream | Present in chat APIs; orthogonal | N/A |
| Empty-result fallback | Plain Claude call, "general knowledge" mode | Not present in retrieval flow | Minor gap |

### Worth taking, worth ignoring

**Take (high value — this is the strongest recommendation in the memo):**

- **Hybrid search via Postgres FTS + pgvector, combined with RRF.** We already have pgvector. Postgres has first-class full-text search (`tsvector`, `ts_rank_cd`). The missing piece is a reciprocal rank fusion (or weighted) combination of (a) BM25-like `ts_rank_cd` scores and (b) cosine-distance vector scores. This is genuinely valuable because:
    1. **Vector-only retrieval fails on proper nouns, SKUs, acronyms, short queries.** For a marketing/ops automation OS handling agent IDs, campaign names, subaccount codes, product SKUs — pure semantic search under-retrieves exact-match content. BM25 catches it. RRF combines them without a calibration problem.
    2. **Postgres FTS is free.** We already have Postgres; we already have pgvector. The added cost is one `tsvector` generated column + GIN index per content table we want to hybrid-search.
    3. **No external dependency.** Unlike Cohere rerank (which is already an optional add-on), FTS is local.

    **Rough shape of the change:**

    ```sql
    -- schema
    ALTER TABLE workspace_memory_entries
      ADD COLUMN content_tsv tsvector
      GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
    CREATE INDEX ON workspace_memory_entries USING GIN (content_tsv);
    ```

    ```ts
    // service — retrieve candidates from both, RRF-merge, then rerank
    const vectorHits = await vectorSearch(queryVec, k=30);
    const bm25Hits   = await ftsSearch(query, k=30);
    const fused      = reciprocalRankFusion(vectorHits, bm25Hits, k=60);
    return rerank(fused.slice(0, 30));
    ```

    **Size: ~3–5 days.** Migration + service method + test + telemetry comparing vector-only vs. hybrid recall on a held-out query set.

**Take (low value):**

- **Sentence-window expansion at retrieval time.** Chunks are embedded at fine granularity but retrieved with ±N neighbor sentences attached. Useful for research-paper corpora where context spans sentence boundaries. Our memory entries are already short and semi-structured, so the payoff is small. Defer.

**Ignore:**

- **RAGLite itself.** It's a thin wrapper we don't need — adding a Python library as a dependency is a non-starter (we're TypeScript), and the pattern it encodes is implementable in ~100 lines of TS. The value is the *interface shape*, not the library.
- **SQLite as the vector store.** They use it because RAGLite supports it; we have Postgres + pgvector which is strictly better for our multi-tenant RLS story.

### Recommendation

**This is the highest-leverage take-away in the memo. File an ADR for "hybrid retrieval: pgvector + Postgres FTS with RRF fusion."** Follow the shape above. Target: `workspace_memory_entries` first, then extend to any other corpus where we index text for retrieval. This change meaningfully improves recall on exact-match terms (IDs, names, SKUs) without changing the external contract of `searchMemory()` — callers get better results, same interface.



## 3. Database routing RAG

**Source:** `rag_tutorials/rag_database_routing/rag_database_routing.py` (387 lines)
**Stack:** Qdrant (three separate collections), LangChain, Agno agent for routing, LangGraph ReAct agent for web fallback, DuckDuckGo for web search.

### What it does

Indexes documents into three *separate* Qdrant collections — `products`, `support`, `finance` — each with its own purpose. At query time, routes the question to ONE collection using a two-stage router:

1. **Stage A — vector-similarity routing.** Runs `similarity_search_with_score(k=3)` against *every* collection, computes average score per collection, picks the highest. If best score ≥ 0.5, route there.
2. **Stage B — LLM fallback.** If no collection scores above the floor, ask an Agno-framework routing agent ("analyze and return exactly one of: 'products', 'support', 'finance'"). Strict one-word output.
3. **Stage C — web fallback.** If the LLM declines or returns something unrecognized, route to a LangGraph ReAct agent with DuckDuckGo search.

Each collection has human-readable name + description in a `CollectionConfig` dataclass. The Streamlit UI surfaces routing decisions to the user ("Using vector similarity routing: products (confidence: 0.73)"). Ingestion is per-collection — the UI has three upload tabs, one per collection.

### How our equivalent looks today

| Concept | Their implementation | Our implementation | Gap? |
|---|---|---|---|
| Multiple data sources | Three Qdrant collections | Multiple `workspace_data_sources` per subaccount (`docs/cascading-context-data-sources-spec.md`) | Conceptually similar, different granularity |
| Source-level routing | Pre-search: score all, pick best | **Post-search** per-source relevance ranking (`runContextLoaderPure.ts:42`) — all sources loaded, then ranked and budget-pruned | **Architectural difference, not a gap** |
| LLM fallback routing | Agno agent classifies to one of N | Not present — we do not have explicit source classification | Present gap, probably low-value for us |
| Web search fallback | DuckDuckGo via ReAct agent | We have `web_search.md` skill but it's agent-invocable, not automatic fallback | Same gap as §1 |
| Confidence surfacing | UI shows routing decision + score | Not surfaced in our UI | Minor — our model is "load all, prioritize" so routing decisions are less salient |

### Worth taking, worth ignoring

**Take (low–medium value):**

- **Confidence surfacing in the UI.** When our context loader picks which data sources to include in a prompt, we make that decision silently. For debuggability — and for user trust — showing "we pulled from data sources A, B, and C because they scored highest against your question" is useful, especially for agent operators who want to understand why an answer came out a certain way. This is a UI change, not a backend change: the ranking is already done in `runContextLoaderPure.ts:42`; we just don't surface the decision in traces. **Size: small — expose ranking metadata in run traces, render in the run detail view.**

- **Per-source descriptive metadata that LLMs can read.** Their `CollectionConfig(name, description, collection_name)` is a small but important idea: each data source carries a description that the routing agent consumes. We have data source names but I'm not sure we consistently store *descriptions intended for LLM consumption* (e.g. "Revenue and cost data for the last 24 months, updated daily"). This is worth verifying — if missing, adding a `description_for_llm` field on data sources makes future routing and LLM-driven source selection meaningfully better.

**Ignore:**

- **The pre-search-score-everything routing pattern.** Running a vector search against every data source before deciding which one to use costs N× the query latency and N× the embedding cost. Our "load all, then rank and prune by budget" model is strictly better for small N, and their model doesn't scale when N is large. For a tenant with 30 data sources, theirs would issue 30 parallel searches before doing anything useful. Don't adopt.
- **Hard routing to exactly one source.** Our cascading context model explicitly allows *multiple* sources to contribute to a single prompt, budget-permitting. Forcing a single-source pick would regress us.
- **The LLM fallback router.** If vector similarity scoring is bad, adding an LLM on top doesn't help — you're still working from weak signal. Fix the ranking, don't stack fallbacks.
- **Agno framework and LangGraph ReAct agent.** Framework sprawl; we have a clean three-tier agent model in `architecture.md`. Don't import patterns from demos that conflict with it.

### Recommendation

**No ADR.** The one concrete take-away — `description_for_llm` on data sources — is a minor field addition worth investigating via a code spot-check, not a new ADR. The UI confidence-surfacing is a nice-to-have for a future observability pass, not urgent.

The more valuable lesson here is what NOT to do: don't copy the "score all, pick one" pattern when our `load-all-then-rank` model is strictly better for our shape.



## 4. Multi-MCP agent router

**Source:** `mcp_ai_agents/multi_mcp_agent_router/agent_forge.py` (371 lines)
**Stack:** Python MCP SDK (`mcp.ClientSession`, `StdioServerParameters`), Anthropic SDK direct tool-calling loop, Streamlit.

### What it does

Demonstrates the pattern of *specialized agents, each bound to a subset of MCP servers*, rather than one agent wired to everything. Four agents are declared as `@dataclass Agent` objects:

- `code_reviewer` — bound to `github` and `filesystem` MCP servers.
- `security_auditor` — bound to `github` and `fetch`.
- `researcher` — bound to `fetch` and `filesystem`.
- `bim_engineer` — bound to `filesystem` only.

Each agent has `name`, `description`, `icon`, `system_prompt`, `mcp_servers` (list of `{command, args, env}` configs for `StdioServerParameters`).

The per-query flow:

1. **`classify_query(query)`** — keyword-based classifier picks an agent (`security_keywords`, `code_keywords`, `bim_keywords`, else `researcher`). Trivial `if any(kw in query_lower for kw in keywords)` logic.
2. **`connect_mcp_servers(agent)`** — async; spawns each of the agent's MCP servers as subprocesses via `stdio_client`, initializes an `mcp.ClientSession` per server, lists each server's tools, translates them into Anthropic tool-format, and builds a `session_map: tool_name -> session` so tool-use dispatches back to the right server.
3. **Agentic loop** — classic Anthropic tool-use loop: call `messages.create` with merged tool list, while `stop_reason == "tool_use"`, dispatch each `tool_use` block to `session_map[tool.name].call_tool(...)`, append results as `tool_result` blocks, re-call.
4. **Cleanup** — `AsyncExitStack.aclose()` tears down all MCP subprocesses and sessions in order.

The most interesting structural detail: **`session_map: dict[str, ClientSession]`**. Tool names have to be globally unique across all servers bound to one agent, and the router uses the map to route a tool call back to the server that registered the tool. This is the pattern.

### How our equivalent looks today

| Concept | Their implementation | Our implementation | Gap? |
|---|---|---|---|
| MCP role | **Client** — spawns external MCP servers as subprocesses | **Host** — we run one `McpServer` per HTTP request, exposing ~180 tools | **Different architecture** |
| Tool binding | Agent-scoped list of MCP servers | All tools exposed uniformly via `buildMcpServer()` (per-request); consumers decide which to use | Different model |
| Routing | Keyword-based classifier to agent | We don't route externally — clients (Claude Code, Cowork, etc.) connect to our MCP and pull tools | N/A |
| Tool-name deduplication | `session_map` dict — tools must be globally unique per agent | We deduplicate across action-registry and system-skills via the registration pipeline (`server/mcp/mcpServer.ts:225`) | Similar problem, similar solution |
| Async lifecycle mgmt | `AsyncExitStack` for teardown | Our server is a long-running process, not per-request subprocess spawn | Different; ours simpler |

### Worth taking, worth ignoring

**The strategic question this raises:**

This is the most interesting of the four directories because it surfaces a real question about our MCP architecture: **do we ever want to BE a client of other MCP servers?** Right now we're strictly a host. But:

- If an agency operator connects their own third-party MCP server (e.g. a client-owned internal tools server), do we want our agents to consume it? That's a client-mode capability.
- If we want agents bound to subsets of our *own* skills (e.g. "Editor agent only gets access to `draft_*`, `update_copy`, `review_ux`, `publish_post`"), that's a **scoping** problem that exists today regardless of MCP.

On the second point: scoped skill access is already in our system via the `system_skills.visibility` enum and per-agent link/skill assignment (`config_set_link_skills.md` et al.), but **we don't scope at the MCP-tool level** — all MCP clients currently see every exposed tool. That's a legitimate gap if we ever expose our MCP server to external clients with per-tenant scope.

**Take (medium value, strategic):**

- **The "agent = system prompt + subset of tools" pattern as a first-class concept.** We nominally have this (an agent's `linked_skills` is a subset of the registry) but we do not currently propagate it into the MCP surface. If we want an external consumer (Claude Code, a customer-facing Cowork experience) to connect to a *per-agent* MCP endpoint and only see that agent's authorized skills, we need to build that routing. The `session_map` pattern is the mechanical answer: one MCP server per agent, filtered from the full registry at build time. We already build `McpServer` per-request; extending this to "per-agent filtered MCP server" is a natural next step.

- **The explicit `session_map` pattern** for resolving tool-name collisions when composing multiple tool sources. We already deduplicate between action-registry and system-skills, but as we add more tool sources (e.g. connecting upstream MCP servers in the future), this pattern is the right way to avoid name collisions without requiring globally unique names.

**Take (low value):**

- **Keyword-based query classification.** Don't adopt — it's brittle, and we have proper agent dispatch via the three-tier model. Mentioned only for completeness.

**Ignore:**

- **Spawning MCP servers as subprocesses on every query.** Terrible for latency and cost. Their demo can afford it because it's a Streamlit app with one user at a time. Our multi-tenant request model can't.
- **Streamlit UI patterns.** N/A.
- **Per-agent `mcp_servers` list as literal subprocess specs.** The right abstraction for us is "per-agent tool allowlist against a registry," not "per-agent subprocess configs."

### Recommendation

**File a design note — not an ADR yet — on "scoped MCP surface per agent."** Scope: can we build `buildMcpServer({ agentId })` that filters the exposed tool list to the agent's linked skills before registration? This is probably one day of work on the existing `server/mcp/mcpServer.ts` infrastructure. Value: unlocks per-agent MCP endpoints for external consumers without needing a broader architectural change. Pre-requisite: a clear use case — right now we only host MCP for internal consumption, so the priority is low until we have an external client asking for it.



## 5. Skill taxonomy comparison

This is the section you specifically asked for, and it's where the most durable insight sits. Both repos use the word "skill" — and they mean fundamentally different things by it. Clarifying the mismatch is useful independent of any code we take.

### The core mismatch — two different definitions of "skill"

| Aspect | `awesome-llm-apps/awesome_agent_skills/` | `automation-v1/server/skills/` |
|---|---|---|
| **Count** | 20 skills | 152 skills |
| **Format** | Single `SKILL.md` (frontmatter + prose) | `name.md` (frontmatter + `## Parameters` + `## Instructions`) + handler in TS registry |
| **Nature** | A **persona / discipline** loaded into the agent's prompt | An **invocable tool** with a deterministic handler |
| **Invocation** | Triggered by matching user intent via `description` frontmatter ("Use when: editing, proofreading…") | Called via Anthropic tool-use with typed parameters |
| **Output** | Free-form LLM text, structured by the skill's prose examples | Return value from a TypeScript handler — can be pure LLM, pure code, or mixed |
| **Validation** | None at runtime — the LLM either follows the prompt or not | Startup validator rejects a boot if any `system_skills` row references a missing `handler_key` |
| **Scope** | Self-contained prompt discipline (editing checklist, publishing conventions) | Integrated action in the platform (writes to DB, hits APIs, produces artifacts) |
| **Storage** | File-only, read at load | Files are seed; runtime reads/writes `system_skills` Postgres table |

**Plainly:** their "skill" is *how to think about X*; our "skill" is *what to do when asked to do X*.

### Their skills are closer to our agents than to our skills

The honest analog in our repo for `awesome_agent_skills/editor/SKILL.md` is NOT `server/skills/draft_content.md` — it's the agent definitions in `.claude/agents/` (`architect.md`, `pr-reviewer.md`, `spec-conformance.md`, etc.). Those files have the same shape: a name, a description, a triggering contract, a system prompt's worth of discipline about how to do the work.

Our `.claude/agents/` is small (9 agents — all internal-development focused) because we've only needed personas for development-process work so far (review, triage, orchestration). Product-level agents (the three-tier model in `architecture.md`) are code-configured, not markdown-configured.

That's the real gap: **we have no equivalent of a user-installable "persona pack."** If an agency wants their own content team's "Editor" discipline baked into an agent (with their checklist, their style guide, their quality bar), we don't have a first-class artifact for that yet.

### What each side does well

**Theirs, well-designed:**

1. **Triggering metadata.** Each `SKILL.md` has a `description` frontmatter that enumerates intent phrases ("Use when: editing, proofreading, or when user says 'edit'/'improve'/'revise'"). This is designed for an agent to autonomously pick the right skill without the orchestrator knowing the list. Cleaner than hardcoded routing.
2. **Output templates.** Each skill prescribes an output format (the Editor skill has a `## Editing Output Format` section with explicit markdown templates). This is pattern reuse — the skill not only defines *how to think* but *what to hand back*.
3. **Examples in the skill itself.** Every skill has a worked example (input → structured output). This is few-shotting without calling it few-shotting.
4. **MIT-licensed content.** Explicitly designed for reuse. You can fork the Editor skill, change the rules, ship it to your agents.
5. **`self-improving-agent-skills/` subdirectory.** Meta-skills that improve other skills — a small but interesting pattern for a future version of our skill analyzer.

**Ours, well-designed:**

1. **Typed parameters.** Every skill declares its parameter surface (`content_type: enum[blog_post, landing_page, case_study, whitepaper, email_newsletter] (required)`). Theirs have none. The parameter-typing catches bad invocations at the SDK layer; prose-only skills catch nothing until the LLM misfires.
2. **Handler-backed execution.** Skills aren't prompts — they're code paths that happen to include prompts. `draft_content.md` ultimately runs a handler in `SKILL_HANDLERS`. That's a real platform capability; theirs is a markdown config.
3. **Startup validation.** `systemSkillHandlerValidator.ts` refuses to boot if a skill slug has no handler. This is the kind of "fail loud at startup, never in production" discipline that's absent from their demo code.
4. **Visibility gating.** `visibility` enum (`none | basic | full`) integrates with the permission model. Their skills have no notion of who can invoke them.
5. **Scale.** 152 vs 20. Ours cover a real product surface (CRM mutations, config operations, content generation, financial analysis, GEO auditing, skill/playbook self-management). Theirs are "knowledge worker starter pack."

### What's worth taking from their skill model

**Take (medium–high value):**

1. **Triggering metadata (`description`) as a first-class prompt for agents to self-select skills.** Our skills have `description` frontmatter — I checked — but it's a *marketing* description ("Drafts long-form content... from a content brief"). Theirs is an *invocation* description ("Use when: user asks to edit, proofread, improve..."). The distinction matters because agent skill-selection is done by matching user intent to descriptions; intent-phrased descriptions work better than feature-phrased ones. **Action: propose a `trigger` or `invoke_when` field on skill frontmatter, separate from `description`.** Low cost, improves agent skill-selection accuracy.

2. **Output-format templates in skill definitions.** Our `draft_content.md` DOES have an output format section — good — but many of our action/read skills do not. Enforcing a prescribed output shape per skill is worth a consistency pass. **Action: audit the 152 skills for "does this skill prescribe its output format." The ones that don't, should.**

3. **"Persona pack" as a new artifact class, distinct from skills.** This is the biggest unexplored idea in the comparison. A persona pack is *a named system prompt + a linked skill bundle + output conventions*. If an agency uploads "Our Editor Persona Pack" (markdown file with their brand voice, their house style, their approved skill whitelist), it instantiates as a specialized agent. This is a product surface question — it touches marketing ("customize your agents"), not just engineering. **Action: consider as a future product direction, not a near-term code change.** Worth flagging to the product lead.

4. **The `self-improving-agent-skills/` meta-pattern.** Skills that improve other skills. We have a skill analyzer subsystem (`/api/system/skill-analyser`) that does something similar — propose skill updates based on usage telemetry. Worth a cross-check: does the analyzer expose itself *as a skill* that the agent can invoke to improve its own skill set? If not, that's a nice symmetry to add.

**Ignore:**

- The prose-only, no-parameter format. Our typed-parameter model is strictly better for a platform. Don't drop it.
- The "single SKILL.md file as both prose and config" format. Our two-file (md seed + TS handler) model is closer to real software engineering practice.
- Copying specific skill personas (Editor, Data Analyst, etc.) one-to-one. The surface they cover is a "knowledge worker toolkit" not an "agency automation OS." If we want a persona pack called Editor, it should use OUR skills (`draft_content`, `update_copy`, `review_ux`, `publish_post`), not theirs.

### Where the taxonomy comparison points

Our 152 skills are **verbs** (`draft_content`, `analyse_financials`, `geo_compare`, `crm.send_email`). Theirs are **nouns / roles** (`Editor`, `Data Analyst`, `Fact Checker`).

A mature agent platform usually has **both layers**:

- **Verbs / actions** — what can be done. (Our strength.)
- **Roles / personas** — how a particular agent approaches a set of actions. (Their strength; our gap.)

The roles layer compiles *down to* the verbs layer — an "Editor" persona is not a new primitive; it's `{ system_prompt, allowed_skills: [draft_content, update_copy, ...], output_style, tone_guidelines }`. We have the pieces (agent records, `linked_skills`, `system_prompt` field). We don't have the named, shareable, installable artifact.

**The durable insight:** don't confuse their "skills" with ours. If we end up adding a "persona pack" concept, it's a NEW artifact type in our system — not a rebrand of skills, not a merge with skills. Keep the verbs/actions layer we have. Add a roles/personas layer *above* it.



## Overall recommendations

Consolidated, prioritized. Each recommendation is scoped to something that could reasonably become an ADR / task / spec.

### Priority 1 — hybrid retrieval (from §2)

**"Hybrid pgvector + Postgres FTS retrieval with RRF fusion, starting with `workspace_memory_entries`."**

- **Why:** Biggest recall improvement per unit of effort. Vector-only retrieval under-performs on exact-match terms (IDs, SKUs, names, acronyms) that are common in our multi-tenant operational context. Postgres FTS is local, free, and already available.
- **Size:** 3–5 days. Migration + service method + RRF utility + test on a held-out query set.
- **Owner:** TBD — cross-cutting retrieval work, touches `workspaceMemoryService.ts` and likely every other table we embed.
- **Pre-req:** A small labeled evaluation set (10–20 queries with known-relevant entries) to measure before/after.

### Priority 2 — `trigger` / `invoke_when` frontmatter on skills (from §5)

**"Separate `description` (human-readable) from `trigger` (LLM-invocation-directive) on skill frontmatter."**

- **Why:** Our skills are selected by an LLM matching user intent to skill descriptions. Intent-phrased triggers (their pattern) outperform feature-phrased descriptions (our current pattern) for that matching.
- **Size:** 1–2 days. Schema addition + backfill pass across 152 skills + validator update. Most time is in writing good trigger phrases.
- **Owner:** Could be done incrementally — field added now, skill-by-skill backfill over time.

### Priority 3 — retrieval fallback on low confidence (from §1)

**"Configurable relevance floor that triggers a web-search / URL-fetch fallback skill when workspace memory comes back weak."**

- **Why:** New tenants and thin corpora produce bad retrievals today with no recovery. We already have `web_search` and `fetch_url` skills; we don't automatically reach for them.
- **Size:** ~1 day. A 20-line branch in `workspaceMemoryService.ts` plus a config knob.
- **Owner:** Low-risk; whoever owns retrieval.

### Priority 4 — persona pack as a product concept (from §5)

**"Named, installable persona packs as a layer above skills — not a rebrand of skills."**

- **Why:** Biggest strategic idea in the memo. Unlocks "bring your own voice/discipline/style" as a product surface without any new primitives — it compiles down to existing agent records + linked_skills + system_prompt.
- **Size:** This is a product-direction question, not an engineering task. Needs a spec before sizing. Call it 2–3 weeks if it becomes a real feature, but first it needs product validation.
- **Owner:** Product lead + architect.
- **Action:** A 1-page brief (not a spec) to decide whether this becomes a real roadmap item.

### Priority 5 — scoped MCP surface per agent (from §4)

**"Build `buildMcpServer({ agentId })` that filters exposed tools to an agent's linked skills."**

- **Why:** Enables per-agent MCP endpoints for external consumers. Natural extension of our existing per-request MCP server.
- **Size:** ~1 day.
- **Gate:** Don't build until an external client asks for it. Right now our MCP is internal-only, so priority is low.

### Priority 6 — output-format audit across skills (from §5)

**"Audit the 152 skills for 'does this skill prescribe its output format?' Add one where missing."**

- **Why:** Output consistency improves LLM reliability. Their skills prescribe output formats universally; ours do it inconsistently.
- **Size:** 1–2 days, mostly reading and writing prescribed output sections.
- **Owner:** Whoever owns the skill catalogue quality.

### Priority 7 — source descriptions for LLM consumption (from §3)

**"Verify that `workspace_data_sources` has a `description_for_llm` field. Add if missing."**

- **Why:** Enables smarter source selection by agents at prompt-time. Small schema change; we probably already have a `description` column but it's worth checking it's intent-phrased for LLMs, not humans.
- **Size:** Half a day including verification.

### Things to explicitly NOT do

- Adopt LangGraph, LangChain, or Agno as dependencies. Our clean TS backend shouldn't grow Python agent-framework parallels.
- Swap pgvector for Qdrant. Irrelevant to our architecture.
- Mirror their "score every source, pick one" pre-search routing pattern. Our "load all, rank, budget-prune" model is better for our shape.
- Rename `server/skills/*` to match their taxonomy, or merge skills and agent definitions. The two concepts are legitimately different and should stay separated.

## Open questions for the user

These blocked me from making firmer recommendations. Answers here sharpen the next steps.

1. **Do we have a labeled retrieval evaluation set?** If not, the hybrid-retrieval ADR needs to start by creating one — 10–20 queries with known-relevant entries. If we do, where?

2. **Does `workspace_data_sources` carry an LLM-facing description today?** (Priority 7.) Pinging you rather than guessing because the subagent didn't look at schema for data sources specifically.

3. **What's the product appetite for persona packs?** The idea emerged from §5 and is the most interesting strategic lever in the memo. It's also the one most likely to be "cool but not right now." I want a signal before any spec work.

4. **Is our MCP server internal-only forever, or is external MCP consumption on the roadmap?** This determines whether §4's scoped-MCP-per-agent work is P5 or P2.

5. **Anything I missed?** I restricted the deep read to four examples out of ~100. If there's a specific sub-directory you wanted scrutinized (voice agents, multi-agent teams, RAG failure diagnostics) — say so, and I'll run the same analysis shape on it.

---

## Appendix — source code read

For audit / reproducibility. All files read in full:

- `rag_tutorials/corrective_rag/corrective_rag.py` (453 lines)
- `rag_tutorials/hybrid_search_rag/main.py` (214 lines)
- `rag_tutorials/rag_database_routing/rag_database_routing.py` (387 lines)
- `mcp_ai_agents/multi_mcp_agent_router/agent_forge.py` (371 lines)
- `awesome_agent_skills/editor/SKILL.md` (213 lines, as representative sample)
- `awesome_agent_skills/README.md` + directory listing

All source is Apache-2.0, freely forkable. No code has been copied into this repo as part of this review — just analyzed.

