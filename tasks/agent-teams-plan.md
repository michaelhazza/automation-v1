# Autonomous Agent Teams as a Service — Design Plan

## The Vision

"Staff-in-a-box" — an agency loads a pre-built team of AI workers into a client's account, trains them with that client's data, and they start doing real work on a schedule. The platform coordinates agent teams through shared memory, scheduled execution, and a library of tools.

### Architectural Principle: Execution Mode Abstraction

The autonomous execution layer is designed around an **execution mode abstraction**. Today, the platform executes agent runs via direct Anthropic API calls with server-side tool handling. The architecture intentionally separates _what an agent does_ (tools, workspace, context) from _how the agent run is executed_ (the execution backend).

This means every agent run flows through a common interface:

```
AgentRunRequest {
  agentId, subAccountId, runType (scheduled | manual | triggered)
  executionMode: "api"          // Phase 1: direct Anthropic API calls
                | "headless"    // Future: Claude Code headless mode via container
  context: { masterPrompt, trainingData[], workspaceEntries[], tools[] }
  limits: { maxTokens, maxToolCalls, timeoutSeconds }
}
```

**Phase 1 (now):** All runs use `executionMode: "api"` — the platform calls the Anthropic Messages API with tool definitions and handles the tool-call loop server-side. This runs on Replit with zero infrastructure overhead.

**Future phase:** Runs can use `executionMode: "headless"` — the platform dispatches to an external runner service that spins up an isolated container with Claude Code CLI, executes the agent's task in headless mode, and writes results back to the shared workspace. This enables improvisation, code execution, MCP server access, and capabilities beyond pre-defined tools.

The key architectural decisions that enable this future:
1. **Agent runs produce structured output** — all results write to the shared workspace via a common format (agent, timestamp, category, content), regardless of execution mode
2. **Tool definitions are data, not code** — tools are declared as structured definitions attached to agents, so they can be interpreted by either the API loop or a headless session
3. **The execution loop is behind a service boundary** — agent run orchestration is isolated in its own service, making it swappable without touching scheduling, workspace, or the rest of the platform
4. **Every run is logged uniformly** — tool calls, token usage, duration, and outcomes are recorded the same way regardless of execution mode

---

## 1. Agent Templates — The Product Catalogue

**What they are:** A library of pre-built agent definitions at the system level (controlled by the platform owner). Each template defines:

- The agent's role (e.g. "Competitor Research Agent", "Social Media Agent", "Support Triage Agent")
- Its default personality and instructions (the master prompt)
- What types of training data it expects (e.g. "needs brand guidelines", "needs competitor list")
- What tasks it's designed to trigger or execute
- What tools the agent has access to (e.g. web search, workspace read/write, task triggers)
- A suggested schedule (e.g. "runs every 2 hours", "runs daily at 6am")
- **Execution mode preference** — whether this agent benefits from standard API execution or would benefit from headless mode in future (stored as metadata, not enforced until headless is available)

**How inheritance works:** When an agency creates a sub-account for a client, they browse the template library and pick which agents to install. "Install" means: copy the template into the sub-account as a real, editable agent. The agency can then customise the master prompt, tweak the schedule, and attach the client's training data.

Templates are platform-controlled and improvable over time. Every agency benefits when a better version of a template is released. Agencies can choose to update their installed agents or keep their customised version.

**What exists today:** Agents scoped to organisations, with master prompts, model configuration, and data source attachments. **Missing pieces:** system-level template library, the "install to sub-account" flow, and agent-to-subaccount scoping (agents currently live at the org level).

---

## 2. Training Data — What Makes Each Agent Unique

The same template becomes completely different depending on what you feed it.

- **For a plumber in Auckland:** service list, pricing, service areas, brand voice guide, customer FAQs
- **For a SaaS company in Sydney:** product docs, feature comparison sheet, competitor URLs, content calendar

**What exists today:** The `agent_data_sources` system with support for R2, S3, HTTP URLs, Google Docs, Dropbox, and file uploads. Priority ordering, token budgets, and both lazy and proactive sync modes. This is well-built for this use case.

**What needs to happen:** Data sources need to be attachable at the sub-account level (not just org level), and the "install from template" flow needs to prompt: "This agent expects brand guidelines — upload or link them now." A setup wizard per agent.

---

## 3. Shared Workspace — How Agents Coordinate

This turns individual agents into a team. Without it, nine separate agents doing nine separate things. With it, nine agents building on each other's work.

**What it is:** A structured journal per sub-account. Each entry has:
- Which agent wrote it
- When
- What category (insight, action, alert, recommendation)
- The content

Agents read recent entries relevant to their role every time they run. The Orchestrator agent reads everything.

**Design for execution mode abstraction:** The workspace read/write interface is the same regardless of whether the agent run used API mode or headless mode. In API mode, the platform executes `read_workspace` and `write_workspace` tool calls directly. In future headless mode, the Claude Code session would call the same workspace API endpoints. The workspace is the universal coordination layer.

This is a database addition, not a new system. Every agent run reads from it, does its work, writes back to it. The business owner sees this as an activity feed.

---

## 4. Autonomous Execution — How Agents Do Things

### Phase 1: API + Tools (Build Now)

The platform calls the Anthropic API directly with tool definitions. The agent receives its instructions (from schedule + shared workspace + training data), and the platform sends a structured API call including the agent's prompt plus tool definitions. The agent reasons about what to do, calls the tools it needs, and the platform executes those tool calls safely on the agent's behalf.

**Available tools (Phase 1):**

| Capability | Implementation |
|---|---|
| Web research | `web_search` tool calling a search API (Brave Search, SerpAPI, etc.) |
| Read/write shared workspace | `read_workspace` and `write_workspace` tools against workspace tables |
| Trigger tasks | `trigger_task` tool (already exists) — agent triggers n8n workflows |
| Read training data | Injected into agent context before the call |
| Generate structured output | Agent returns JSON (reports, social posts, email drafts) routed by the platform |
| Read external data | Tools calling specific APIs (Stripe, Google Analytics, CRM) — each is a controlled, scoped API call |

**How a single agent run works:**

1. Schedule fires (pg-boss cron job)
2. Backend loads the agent's master prompt, training data, and recent workspace entries
3. Constructs an API call to Anthropic with the agent's prompt + tool definitions
4. Claude reasons and requests tool calls (search, write to workspace, trigger tasks)
5. Backend executes each tool call safely and returns results to Claude
6. Loop continues until Claude is done (typically 3-10 tool calls per run)
7. Backend writes final summary to workspace and logs everything

**Why this works for Phase 1:**
- Runs on Replit — just API calls and database writes
- Secure by design — agent can only use defined tools
- Multi-tenant safe — each call is scoped to its sub-account
- Observable — every tool call is logged
- Cost-controlled — token budgets enforced per run

### Architecture for Future Headless Mode

The execution service is structured so that adding headless mode later requires **no changes** to scheduling, workspace, templates, or the dashboard. The only addition is a new execution backend behind the existing service boundary.

**What the execution service interface looks like:**

```
interface AgentExecutionService {
  executeRun(request: AgentRunRequest): Promise<AgentRunResult>
}

// Phase 1 implementation:
class ApiExecutionService implements AgentExecutionService {
  // Calls Anthropic API with tools, handles tool loop server-side
}

// Future implementation:
class HeadlessExecutionService implements AgentExecutionService {
  // Dispatches to container runner, Claude Code CLI in headless mode
  // Writes results back via workspace API
}
```

**What headless mode would add when ready:**
- Improvisation — agents can write and execute code, handle problems you didn't anticipate
- MCP server access — tap into an ecosystem of integrations without building each tool
- Complex data processing — write scripts on the fly to analyse data in novel ways
- Richer web interaction — browse full pages, interact with complex sites

**What headless mode would require (not needed now):**
- A VPS or cloud instance running Docker (separate from Replit)
- A runner service that pulls jobs from pg-boss and spins up isolated containers
- Container image with Claude Code CLI pre-installed
- Network bridge between containers and the platform's workspace API
- Per-container resource limits and security isolation

**The architectural seam is ready** — the `executionMode` field on agent runs, the service interface, and the uniform result format mean adding headless mode is an additive change, not a rewrite.

### Relationship Between Agents and Tasks

Tasks don't go away — their role becomes clearer.

- **Tasks** = specific, repeatable actions (send email, create CRM contact, post to social media). These are n8n workflows exposed through the platform.
- **Agents** = autonomous workers that decide _when and why_ to trigger tasks, based on their training, workspace, and judgment.

An agent run might trigger three different tasks. The agent does the thinking; the tasks do the doing.

---

## 5. Scheduling — The Heartbeat

pg-boss handles scheduling natively with cron-style support. No need for n8n here.

**Example agent team schedules:**

| Agent | Schedule | What It Does |
|---|---|---|
| Orchestrator | 6am and 8pm daily | Reads all workspace entries, writes daily priorities and evening summary |
| Competitor Research | Every 6 hours | Searches competitor sites, writes findings to workspace |
| Social Media | Every 2 hours (business hours) | Reads workspace for fresh material, drafts and queues posts |
| Support Triage | Every 30 minutes | Checks inbox/tickets, categorises, escalates urgent items |
| Finance | Daily at 7am | Pulls revenue data, flags anomalies, writes financial summary |
| Content | Daily at 9am | Reads workspace for topics, drafts blog/email content |
| Outreach | Every 3 hours | Reads lead priorities, sends personalised outreach |
| Reporting | Weekly Friday 4pm | Compiles weekly report from workspace, sends to business owner |

Agencies customise schedules per client. Scheduling lives in the app, not in n8n.

**Cost controls are built into the schedule.** Each agent run has a configurable token budget and maximum tool calls. The agency sets these per client. The platform enforces limits automatically — when budget is exhausted, the agent wraps up and stops.

---

## 6. The Full Picture — Agency Experience

**Step 1: Onboard a new client**
- Create a sub-account
- Browse the agent template library
- Install 6-8 agents relevant to this client's business type

**Step 2: Train the agents**
- Upload/link the client's brand guidelines, product info, competitor list, tone of voice doc
- Each agent gets data sources relevant to its role
- Customise master prompts if needed

**Step 3: Configure schedules and budgets**
- Set each agent's run frequency
- Set token budgets per agent to control costs
- Set up the Orchestrator's daily rhythm

**Step 4: Agents start working**
- Each agent fires on schedule via pg-boss
- Platform builds context (prompt + training data + workspace entries)
- Calls Anthropic API with tool definitions
- Agent reasons, searches, reads workspace, makes decisions
- Triggers n8n tasks for concrete actions
- Writes findings and results back to shared workspace
- Every tool call is logged for full transparency
- Next agent picks up where the last one left off

**Step 5: Business owner sees results**
- Dashboard shows what agents did today
- Workspace entries visible as activity feed
- Every agent run is expandable: "Here's what I did and why"
- Weekly report agent sends a summary
- Business owner can still chat with any agent for ad-hoc questions

**Step 6: Agency monitors and optimises**
- Agent performance across all clients
- Token spend per client, per agent
- Adjust schedules, prompts, and training data
- Roll out improved templates to all clients at once

---

## 7. What Makes This a Killer App

**A) It's a team, not a chatbot.** Everyone else sells single-purpose AI assistants. This is a coordinated team that builds shared context over time. The Competitor Research Agent makes the Social Media Agent smarter. The whole is greater than the sum of the parts.

**B) Agencies scale without scaling headcount.** 50 clients doesn't need 50 social media managers — it needs 50 instances of a Social Media Agent, each trained on different client data, all running autonomously.

**C) The training data moat.** Over time, each client's agents accumulate context in the shared workspace. That history makes agents more effective month over month. Switching costs go up naturally.

**D) Headless mode as a premium differentiator (future).** When headless mode is added, it unlocks capabilities no other platform offers — agents that can improvise, write code, process data in novel ways, and use the MCP ecosystem. This becomes the "enterprise tier" that justifies premium pricing. The architecture is ready for it from day one.

---

## 8. Build Sequence (What to Do First)

All steps use the API execution mode. The execution service abstraction is built into step 4 so that headless mode can be added later without rework.

1. **Move agents to sub-account level** — so each client gets their own agent instances
2. **Build the template library** — system-level agent definitions that can be installed into sub-accounts
3. **Add the shared workspace tables** — the coordination layer between agents
4. **Build the autonomous execution service** — behind a clean interface (`AgentExecutionService`). Phase 1 implementation uses Anthropic API with tool definitions and server-side tool-call loop. The interface accommodates future execution modes without changing callers.
5. **Add agent tools** — web search, workspace read/write, task triggers, external data connectors. Tools are declared as structured definitions (not hardcoded), so they can be interpreted by either execution mode in future.
6. **Add scheduling to agents** — cron-based schedules using pg-boss, stored per agent per sub-account, with token budget controls
7. **Wire up the full autonomous loop** — schedule fires → build context → execute via service → write results → trigger tasks if needed
8. **Build the agency dashboard** — visibility across all clients' agent activity, token spend, and agent performance

Each step delivers value on its own, and each one makes the next one more powerful.

---

## 9. Infrastructure Roadmap

### Now (Phase 1 — Ship the Product)
- **Replit** for web app, API, and database
- **pg-boss** for scheduling and job queue
- **Anthropic API** for agent execution (API mode)
- **No additional infrastructure required**

### Future (When Headless Mode is Added)
- **Replit** continues hosting the web app and API (unchanged)
- **VPS with Docker** (e.g. Hetzner, ~$40-80/month) for headless agent runs
  - Runner service pulls "headless" jobs from pg-boss
  - Each run = isolated Docker container with Claude Code CLI
  - Container writes results back to workspace via API
  - Destroyed after each run
- **No Kubernetes needed** until 50+ concurrent headless runs

### Scale Phase (When Customer Volume Demands It)
- Kubernetes cluster for auto-scaling agent runner pods
- Pre-warmed container pool for fast startup
- Namespace-per-tenant isolation
- Managed PostgreSQL, Redis for caching
- Full observability stack

**The decision of when to add headless mode is driven by customer demand, not architecture.** The platform is ready for it whenever the business needs it.
