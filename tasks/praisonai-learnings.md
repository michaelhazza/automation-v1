# PraisonAI Learnings: What We Can Apply to Automation OS

**Date:** 31 March 2026  
**Status:** Research analysis  
**Source:** [PraisonAI](https://github.com/MervinPraison/PraisonAI) — open-source multi-agent framework, 5.6K+ stars

---

## Executive Summary

PraisonAI is a Python-based multi-agent framework that has solved many of the same problems we're solving in Automation OS — but from a developer-framework angle rather than a SaaS product angle. Their architecture validates several of our strategic recommendations and reveals specific patterns we should adopt. Below are the **concrete, actionable learnings** mapped to our codebase.

---

## 1. Workflow Composition Primitives

### What PraisonAI Does
They expose 6 composable workflow patterns as first-class primitives:
- **Sequential** — agents chain output → input
- **Parallel()** — concurrent agent execution on independent subtasks
- **Route()** — classifier agent routes to specialists based on input type
- **Loop()** — iterate over datasets/items
- **Repeat()** — evaluator-optimizer loop until quality threshold met
- **Orchestrator-Workers** — central agent delegates dynamically

### What We Have
- Agent handoffs via pg-boss (sequential only, max 5 hops)
- Sub-agent spawning (max 3 children, budget splitting)
- No explicit parallel execution, routing, or evaluator-optimizer patterns

### What We Should Build

**Priority: HIGH — extends our existing handoff system**

| Pattern | Implementation in Our Stack | Effort |
|---|---|---|
| **Parallel execution** | Spawn multiple sub-agents simultaneously via pg-boss, await all completions before parent resumes. We already have `spawn_sub_agents` — extend it to support `await_all` mode vs current fire-and-forget. | ~3 days |
| **Route()** | Add a `router` agent type that classifies incoming tasks and assigns to the right specialist agent. This is essentially a lightweight agent run that outputs a handoff decision. Can reuse our existing handoff infrastructure. | ~2 days |
| **Evaluator-Optimizer Loop** | After an agent produces output, a review agent scores it. If below threshold, send back with feedback. This maps perfectly to our existing review system — extend `review_items` to support automated re-execution on rejection. | ~1 week |
| **Loop over data** | Agent iterates over a list (e.g., CSV rows, board tasks). Add a `forEach` execution mode that creates sub-runs per item. | ~3 days |

**Key insight:** PraisonAI makes these patterns declarative (one line of code). We should make them configurable in our agent setup UI — "execution pattern: sequential | parallel | routing | loop" — so non-technical agency users can compose workflows visually.

---

## 2. Tiered Memory Architecture

### What PraisonAI Does
Four-tier memory system with quality scoring:
- **Short-term** — recent interactions (SQLite)
- **Long-term** — important information with quality filtering (ChromaDB/vector store)
- **Entity memory** — people, places, things with relationships (Neo4j/graph DB)
- **User memory** — preferences and history per user

Quality scoring (0.0–1.0) with configurable threshold (default 0.7) determines what gets persisted to long-term storage. Low-quality observations ("user said hello") are filtered out.

### What We Have
- `workspaceMemories` table with summary records
- Memory injection into agent prompts
- Periodic summarization of raw observations
- No quality scoring, no entity extraction, no vector search

### What We Should Build

**Priority: HIGH — directly improves our strategic recommendation #1 (Shared Memory)**

1. **Quality scoring on memory extraction** (~2 days)
   - After each agent run, score extracted observations 0.0–1.0
   - Only persist observations above threshold (0.7) to `workspaceMemories`
   - This immediately reduces noise and token waste in memory injection
   - Implementation: Add a `qualityScore` column to `workspaceMemories`, add a scoring step in `workspaceMemoryService.ts` post-run

2. **Entity extraction and tracking** (~1 week)
   - New `workspaceEntities` table: `{id, subaccountId, name, type, attributes, relationships, lastSeen}`
   - After each run, extract entities (people, companies, products, dates) from agent output
   - Inject relevant entities into agent prompts alongside memory summaries
   - This is what makes agents feel like they "know" the client's world

3. **Vector search for memory retrieval** (~1 week)
   - Currently we inject all memories. As workspaces grow, this bloats the prompt.
   - Add embedding-based retrieval: embed the current task description, find the top-K most relevant memories
   - Use pgvector (PostgreSQL extension) to avoid new infrastructure
   - Aligns with strategic recommendation #4 (Context Offloading)

4. **User-specific memory layer** (~3 days)
   - Track per-user preferences within a workspace (e.g., "CEO prefers bullet points", "Marketing lead wants data-backed claims")
   - New `userMemories` table linked to workspace users
   - Inject relevant user context when agent is working on tasks assigned to/by that user

---

## 3. Multi-Provider Model Router

### What PraisonAI Does
- Supports 100+ LLM providers through a unified interface
- **Model router** that automatically selects the cheapest capable model for a task
- Switch models by changing one config line

### What We Have
- `llmRouter.ts` with Anthropic (primary), OpenAI, Gemini adapters
- Per-agent model configuration
- Token estimation and budget tracking

### What We Should Build

**Priority: MEDIUM — our current setup works but leaves money on the table**

1. **Cost-aware model routing** (~3 days)
   - For simple tasks (classification, data extraction), automatically downgrade to cheaper models (Haiku, GPT-4o-mini)
   - For complex tasks (analysis, creative writing), use full models (Sonnet/Opus)
   - Add a `taskComplexity` scorer in the middleware pipeline that influences model selection
   - This could cut LLM costs 30-50% for agencies running high-volume workspaces

2. **Fallback chains** (~2 days)
   - If primary provider fails (rate limit, outage), automatically try the next provider
   - Current behavior: fail the run. Better behavior: Anthropic → OpenAI → Gemini fallback
   - Add to `llmRouter.ts` as a retry-with-fallback wrapper

3. **Per-skill model assignment** (~1 day)
   - Some skills (web search summarization) don't need the best model
   - Allow configuring which model handles which skill execution
   - Extend agent config: `{ defaultModel: "sonnet-4.6", skillOverrides: { web_search: "haiku-4.5" } }`

---

## 4. MCP Protocol Support

### What PraisonAI Does
- Full MCP support across 4 transports: stdio, HTTP, WebSocket, SSE
- Agents can both **consume** MCP tools and **expose themselves** as MCP servers
- One-line integration: `Agent(tools=MCP("npx @modelcontextprotocol/server-memory"))`

### What We Have
- Custom skill executor pattern (direct + action-gated)
- No MCP support

### What We Should Build

**Priority: HIGH — this is a competitive moat and extensibility play**

1. **MCP client in skill executor** (~1 week)
   - Add an `mcp` skill type that connects to external MCP servers
   - Users configure MCP tool sources per workspace: `{ name: "memory", command: "npx @modelcontextprotocol/server-memory" }`
   - Skill executor routes MCP tool calls to the configured server
   - This instantly gives our agents access to thousands of MCP-compatible tools

2. **MCP server exposure** (~2 weeks)
   - Expose our agents as MCP servers so external tools (Claude Desktop, Cursor, VS Code) can invoke them
   - Each workspace agent becomes an MCP tool: "Ask the research agent to find X"
   - Transport: SSE or Streamable HTTP (best for web-based deployment)
   - This is a massive distribution play — our agents become usable from any MCP client

3. **MCP tool marketplace** (future)
   - Agencies can browse and enable MCP tools for their workspaces
   - Pre-configured integrations: Google Drive, Slack, GitHub, databases, etc.
   - Each MCP connection goes through our permission system and action gates

---

## 5. Autonomous Scheduling Improvements

### What PraisonAI Does
- 24/7 agent scheduler with cron-like configs
- Agents run autonomously, checking conditions and executing when needed
- Session persistence across restarts with auto-save

### What We Have
- pg-boss scheduling with RRULE/cron
- Three run types: manual, scheduled, triggered
- Retry policies with backoff

### What We Should Build

**Priority: MEDIUM — we already have solid foundations, just need polish**

1. **Condition-based triggers** (~3 days)
   - Beyond time-based scheduling, add event-based triggers: "Run when a new task is created in column X", "Run when an email arrives", "Run when another agent completes"
   - Extend `agentScheduleService.ts` with a `triggerType: 'cron' | 'event' | 'condition'`
   - Events flow through our existing WebSocket system

2. **Session persistence / checkpointing** (~1 week)
   - If a long-running agent is interrupted (server restart, timeout), resume from last checkpoint
   - Store intermediate state in `agentRuns` table: `{ checkpoint: { lastToolCall, partialOutput, messageHistory } }`
   - On restart, detect incomplete runs and resume

3. **Chain scheduling** (~3 days)
   - "Every Monday: Agent A runs → hands off to Agent B → triggers n8n automation"
   - Visual chain builder in the UI (drag agents into a sequence)
   - Stored as a `scheduledChain` with ordered steps

---

## 6. Observability & Telemetry

### What PraisonAI Does
- OpenTelemetry integration: spans, metrics, traces
- Session management with auto-save
- Git-based checkpoints for rollback

### What We Have
- Agent run logging
- Token/cost tracking per run
- Activity logs on tasks

### What We Should Build

**Priority: MEDIUM — important for production trust**

1. **OpenTelemetry integration** (~3 days)
   - Add trace spans around: LLM calls, skill executions, handoffs, memory operations
   - Export to any OTLP-compatible backend (Grafana, Datadog, etc.)
   - Enables agencies to debug agent behavior and optimize performance

2. **Run replay** (~1 week)
   - Store the full message history of each agent run
   - UI to replay an agent's "thought process" step by step
   - Critical for debugging: "Why did the agent do X instead of Y?"

3. **Cost analytics dashboard** (~3 days)
   - Per-workspace, per-agent cost breakdowns over time
   - Trend lines, anomaly detection (sudden cost spike alerts)
   - Helps agencies manage margins

---

## 7. CLI / API-First Design

### What PraisonAI Does
- Everything available via CLI, Python SDK, and YAML config
- Auto mode: describe what you want, framework creates agents automatically
- `praisonai workflow auto "Research AI trends" --pattern parallel`

### What We Should Learn

**Priority: LOW for now — our SaaS UI is the primary interface**

But worth noting: PraisonAI's "AutoAgents" pattern (describe a goal, system creates the right agents) could become a powerful onboarding feature:
- "Describe your business operations" → system auto-generates an agent team
- Reduces setup friction for agencies onboarding new clients
- Implementation: A meta-agent that reads the workspace description and creates agent configurations

---

## Implementation Roadmap (Recommended Order)

| Phase | Items | Effort | Impact |
|---|---|---|---|
| **Phase 1** | Memory quality scoring, Entity extraction, Evaluator-optimizer loop | ~2 weeks | Agents get dramatically smarter |
| **Phase 2** | Parallel execution, Route() pattern, MCP client | ~2 weeks | Agents can handle complex workflows |
| **Phase 3** | Cost-aware model routing, Fallback chains, Vector memory search | ~2 weeks | 30-50% cost reduction, better scale |
| **Phase 4** | Condition-based triggers, Session checkpointing, OpenTelemetry | ~2 weeks | Production reliability |
| **Phase 5** | MCP server exposure, Run replay, Auto-agent generation | ~3 weeks | Competitive moat, distribution |

---

## Key Architectural Takeaway

PraisonAI's core insight is **composability**. Every feature is a building block that combines with others: memory + routing + parallel = intelligent team coordination. Our architecture already supports this through the middleware pipeline and skill executor patterns. The gap is making these patterns **explicit, configurable, and composable** rather than implicit in code.

Our advantage over PraisonAI: we're a **product**, not a framework. We have multi-tenancy, permissions, billing, UI, and human-in-the-loop — none of which PraisonAI provides. The learnings above are about stealing their best architectural ideas and wrapping them in our product experience.
