# Configuration Assistant — Development Specification

> **Status:** Draft
> **Author:** AI-assisted (session 2026-04-14)
> **Last updated:** 2026-04-14

---

## Table of Contents

1. [Overview and Goals](#1-overview-and-goals)
2. [Architecture and Scoping](#2-architecture-and-scoping)
3. [Module and Subscription Placement](#3-module-and-subscription-placement)
4. [Skill Tool Handlers](#4-skill-tool-handlers)
5. [Knowledge Architecture](#5-knowledge-architecture)
6. [Conversation UX and Plan-Approve-Execute Flow](#6-conversation-ux-and-plan-approve-execute-flow)
7. [Config History System](#7-config-history-system)
8. [View History and Restore](#8-view-history-and-restore)
9. [Error Handling, Notifications, and Safety](#9-error-handling-notifications-and-safety)
10. [QA Scenarios](#10-qa-scenarios)
11. [Phasing, Effort, and Deferred Items](#11-phasing-effort-and-deferred-items)

---

## 1. Overview and Goals

### What this is

A system-managed AI agent ("Configuration Assistant") that helps organisation administrators configure the Automation OS platform through natural language conversation. Instead of navigating multiple admin pages to set up agents, skills, schedules, and data sources, the admin describes what they want to achieve and the Configuration Assistant designs and executes the configuration.

### Problem it solves

The platform is powerful but configuration-heavy. Setting up a working agent workflow for a client requires:
- Creating or selecting the right org agent
- Linking it to the correct subaccount
- Choosing appropriate skills from 130+ options
- Writing effective custom instructions with client-specific context
- Configuring schedules (heartbeat or cron)
- Setting execution limits (token budget, tool call cap, cost ceiling)
- Attaching relevant data sources
- Creating scheduled tasks with clear descriptions
- Repeating this across multiple clients

This is a multi-page, multi-step process that requires deep platform knowledge. The Configuration Assistant compresses it into a single conversation.

### Goals

1. **Reduce configuration time** — A workflow that takes 30-60 minutes via the UI should take 5-10 minutes via conversation
2. **Improve configuration quality** — The assistant recommends appropriate skills, writes effective custom instructions, and validates the result
3. **Make platform knowledge accessible** — The admin doesn't need to know every skill slug or scheduling option; the assistant knows the platform
4. **Provide full auditability** — Every configuration change is tracked with record-level history and version restore
5. **Enable safe iteration** — The admin can experiment with configurations knowing they can view history and restore previous versions

### What this is NOT

- Not a replacement for the admin UI — power users can still configure everything manually
- Not a chatbot for end users or client_users — org admins and system admins only
- Not a system-level management tool — scoped to a single organisation
- Not a general-purpose AI assistant — it can only perform configuration actions within its defined tool set

---

## 2. Architecture and Scoping

### System agent model

The Configuration Assistant is a **system-managed agent** (`isSystemManaged: true`) defined in the `systemAgents` table with the following key properties:

| Field | Value |
|---|---|
| `slug` | `configuration-assistant` |
| `name` | Configuration Assistant |
| `executionScope` | `org` |
| `isPublished` | `true` |
| `agentRole` | `specialist` |
| `modelProvider` | `anthropic` |
| `modelId` | `claude-sonnet-4-6` |
| `responseMode` | `balanced` |
| `status` | `active` |

Sonnet is the right model choice — configuration doesn't require Opus-level reasoning, it requires reliable tool calling, clear communication, and cost efficiency. A typical config session runs ~$0.85 on Sonnet vs ~$4.25 on Opus.

### Execution path

The Configuration Assistant runs through the **full agent execution service** (`agentExecutionService`), not the lightweight conversation service (`conversationService`). This provides:

- Multi-turn tool calling loops (execute 10+ mutations in sequence)
- Planning prelude (structured plan before execution)
- Budget tracking and cost breaker
- Streaming via `agentRunMessageService` + WebSocket
- Handoff documents (session can be resumed later)
- Config snapshots (audit trail of state before/after)
- Crash-resume capability

### Access control

| Rule | Implementation |
|---|---|
| **Org admins only** | Route-level role check: `req.user.role` must be `org_admin` or `system_admin` |
| **Org subaccount only** | Link guard on `POST /api/subaccounts/:id/agents`: reject if target subaccount is not `isOrgSubaccount: true` |
| **System admin org scoping** | System admins access via existing `X-Organisation-Id` header mechanism (audit-logged) |
| **Permission inheritance** | Config tools execute with the requesting user's org context via `req.orgId` — the service layer enforces existing org scoping on every query |
| **No granular permission key (v1)** | Access gated by role, not by a new permission key. Granular gating (e.g. `org.config_assistant.access`) deferred to Phase 2 if managers need access |

### Org subaccount restriction

The Configuration Assistant can only be linked to the org subaccount (`subaccounts.isOrgSubaccount = true`, migration 0106). A one-line guard enforces this:

```typescript
// In subaccountAgents link route
if (systemAgent?.slug === 'configuration-assistant' && !subaccount.isOrgSubaccount) {
  throw { statusCode: 400, message: 'Configuration Assistant can only be linked to the org subaccount' };
}
```

The agent is NOT visible in regular subaccount agent pickers. It appears only in the org-level admin UI as a dedicated nav entry.

### Org-level scope with subaccount reach

The Configuration Assistant runs in the org subaccount but has **read and write access to all subaccounts in the organisation**. This is natural — the org subaccount execution context provides `req.orgId`, and all service-layer queries scope by org ID, returning data across all subaccounts.

This enables cross-subaccount operations:
- "Set up weekly reporting for all my clients" → iterates all subaccounts
- "Link the SEO agent to Company ABC, Company DEF, and Company GHI" → resolves each by name
- "Show me how Client X is configured" → reads a specific subaccount's agent links

### Self-modification guard

The Configuration Assistant cannot modify its own definition. The `config_update_agent` and `config_activate_agent` tools reject mutations targeting the config agent's own ID:

```typescript
if (targetAgentId === configAgentId) {
  return { error: 'The Configuration Assistant cannot modify its own definition.' };
}
```

### Scope boundaries — what the agent CAN and CANNOT do

**In scope (v1):**
- Org agents (create, update, activate/deactivate)
- Subaccount agent links (link, update skills/instructions/schedule/limits)
- Scheduled tasks (create, update)
- Data sources (attach, update, remove — HTTP URLs and file uploads only)
- Skill assignment (read available skills, assign to agents/links — not create/edit skills)
- Subaccounts (create — name and slug only)
- Config history (view versions, restore to previous version)
- Health validation (run workspace health audit after changes)

**Out of scope (v1) — agent will explicitly decline and suggest the admin UI:**
- User management, permissions, roles
- Integration connections (OAuth, API keys)
- MCP server configuration
- Processes and workflow engines
- Playbooks
- Policy rules (tool call gating)
- Org budgets and workspace limits
- Board configurations
- Custom skill creation/editing (Skill Studio)
- Memory blocks
- Agent triggers (event-driven automation)
- Modules and subscriptions

---

## 3. Module and Subscription Placement

### Module definition

| Field | Value |
|---|---|
| `slug` | `configuration_assistant` |
| `displayName` | Configuration Assistant |
| `description` | AI-powered conversational configuration for agents, skills, schedules, and data sources. Helps org admins set up and manage their platform through natural language. |
| `allowedAgentSlugs` | `["configuration-assistant"]` |
| `allowAllAgents` | `false` |
| `sidebarConfig` | `["config_assistant", "agents", "skills", "companies", "manage_org"]` |

The `config_assistant` sidebar item is a new nav entry in the org admin section that opens the Configuration Assistant chat interface.

### Subscription placement

The Configuration Assistant module is included in subscriptions that already include the `operator` module (full platform access). It does not make sense for ClientPulse-only tiers because the config agent configures platform entities (agents, skills, schedules) that those users don't have access to.

| Subscription | Current modules | Add `configuration_assistant`? |
|---|---|---|
| `starter` | client_pulse | No — ClientPulse only |
| `growth` | client_pulse | No — ClientPulse only |
| `scale` | client_pulse | No — ClientPulse only |
| `automation_os` | operator | **Yes** |
| `agency_suite` | operator + client_pulse | **Yes** |
| `internal` | operator + client_pulse | **Yes** |

**Rule:** The Configuration Assistant goes wherever the `operator` module goes.

### Migration

A SQL migration adds the module and updates the relevant subscription `moduleIds` arrays:

```sql
-- Insert the configuration_assistant module
INSERT INTO modules (slug, display_name, description, allowed_agent_slugs, allow_all_agents, sidebar_config)
VALUES (
  'configuration_assistant',
  'Configuration Assistant',
  'AI-powered conversational configuration for agents, skills, schedules, and data sources.',
  '["configuration-assistant"]',
  false,
  '["config_assistant","agents","skills","companies","manage_org"]'
);

-- Update automation_os, agency_suite, and internal subscriptions
-- to include the new module ID in their moduleIds arrays
```

### Runtime gating

The existing `moduleService.isAgentAllowedForOrg(agentSlug, orgId)` check gates access at runtime. When the `configuration-assistant` agent slug is not in any of the org's active modules' `allowedAgentSlugs`, the agent is invisible and inaccessible. No new gating code required.

---

## 4. Skill Tool Handlers

All tools below are system skills assigned exclusively to the Configuration Assistant via `defaultSystemSkillSlugs` on its system agent definition. No other agent receives these skills. The existing `skillSlugs` restriction mechanism enforces this — skills are only available to agents that have them listed.

Universal skills (`ask_clarifying_question`, `read_workspace`, `web_search`, `read_codebase`, `search_agent_history`, `read_priority_feed`) are also available since they bypass allowlists. `ask_clarifying_question` is particularly useful during the discovery phase.

### 4.1 Mutation tools (15)

These tools create or modify configuration entities. All mutation tools use `defaultGateLevel: 'review'` in the action registry so the user must approve before execution. All use `idempotencyStrategy: 'keyed_write'` for safe retries. All record a `config_history` entry before applying the change.

| # | Slug | Description | Service call | Key parameters |
|---|---|---|---|---|
| 1 | `config_create_agent` | Create a new org-level agent with name, prompt, model settings, and default skills | `agentService.createAgent()` | name, description, masterPrompt, modelProvider, modelId, responseMode, outputSize, defaultSkillSlugs, icon |
| 2 | `config_update_agent` | Update an existing org agent's prompt, model, skills, or description | `agentService.updateAgent()` | agentId, plus any fields from create (all optional) |
| 3 | `config_activate_agent` | Set an agent's status to active or inactive | `agentService.activateAgent()` / `deactivateAgent()` | agentId, status ('active' or 'inactive') |
| 4 | `config_link_agent` | Link an org agent to a subaccount, creating the subaccount-agent relationship | `subaccountAgentService.linkAgent()` | agentId, subaccountId, isActive (default true) |
| 5 | `config_update_link` | Update a subaccount agent link (generic — accepts any subset of override fields) | `subaccountAgentService.updateLink()` | linkId, subaccountId, plus any override fields |
| 6 | `config_set_link_skills` | Set the skill slugs on a subaccount agent link | `subaccountAgentService.updateLink()` | linkId, subaccountId, skillSlugs (string array) |
| 7 | `config_set_link_instructions` | Set custom instructions on a subaccount agent link (per-client context and directives) | `subaccountAgentService.updateLink()` | linkId, subaccountId, customInstructions (text, max 10000 chars) |
| 8 | `config_set_link_schedule` | Set the heartbeat or cron schedule on a subaccount agent link | `subaccountAgentService.updateLink()` + `agentScheduleService.updateSchedule()` | linkId, subaccountId, heartbeatEnabled, heartbeatIntervalHours, heartbeatOffsetMinutes, scheduleCron, scheduleEnabled, scheduleTimezone |
| 9 | `config_set_link_limits` | Set execution limits on a subaccount agent link | `subaccountAgentService.updateLink()` | linkId, subaccountId, tokenBudgetPerRun, maxToolCallsPerRun, timeoutSeconds, maxCostPerRunCents, maxLlmCallsPerRun |
| 10 | `config_create_subaccount` | Create a new subaccount (client workspace) with name and slug | `subaccountService.createSubaccount()` | name, slug (auto-derived if not provided) |
| 11 | `config_create_scheduled_task` | Create a recurring scheduled task with title, description, assigned agent, and schedule | `scheduledTaskService.createTask()` | title, description, brief, priority, assignedAgentId, subaccountId, rrule, timezone, scheduleTime, isActive |
| 12 | `config_update_scheduled_task` | Update a scheduled task's description, schedule, agent assignment, or limits | `scheduledTaskService.updateTask()` | taskId, subaccountId, plus any fields from create (all optional) |
| 13 | `config_attach_data_source` | Attach a knowledge source (URL or uploaded file) to an agent, subaccount link, or scheduled task | `agentDataSourceService.createDataSource()` | name, sourceType ('http_url' or 'file_upload'), sourcePath, contentType, priority, maxTokenBudget, loadingMode, cacheMinutes; plus one of: agentId, subaccountAgentId, scheduledTaskId |
| 14 | `config_update_data_source` | Update an existing data source's priority, loading mode, or content type | `agentDataSourceService.updateDataSource()` | dataSourceId, plus any updatable fields |
| 15 | `config_remove_data_source` | Remove a data source from an agent, link, or task | `agentDataSourceService.deleteDataSource()` | dataSourceId |

**Design note — why separate link update tools (6-9) exist alongside the generic update (5):** Narrower tools produce more reliable LLM tool selection. When the user says "make the SEO agent run weekly for Client X," the AI should reach for `config_set_link_schedule` specifically, not a generic update with 15 optional fields. The specific tools are the primary interface; the generic `config_update_link` is the catch-all for less common combinations.

### 4.2 Read-only tools (9)

These tools query current configuration state. They have `defaultGateLevel: 'auto'` — no user approval needed for reads.

| # | Slug | Description | Returns |
|---|---|---|---|
| 16 | `config_list_agents` | List all org agents with current status, model, and default skills | Array of agent summaries (id, name, slug, status, modelId, defaultSkillSlugs, description) |
| 17 | `config_list_subaccounts` | List all subaccounts with name, slug, and status | Array of subaccount summaries (id, name, slug, status) |
| 18 | `config_list_links` | List all agent links for a given subaccount, showing active skills and schedule | Array of link summaries (id, agentId, agentName, isActive, skillSlugs, heartbeatEnabled, scheduleCron) |
| 19 | `config_list_scheduled_tasks` | List scheduled tasks for a subaccount, showing assigned agent and schedule | Array of task summaries (id, title, assignedAgentId, agentName, rrule, scheduleTime, isActive) |
| 20 | `config_list_data_sources` | List data sources attached to a given agent, link, or task | Array of source summaries (id, name, sourceType, sourcePath, loadingMode, priority) |
| 21 | `config_list_system_skills` | List available system skills with name, description, and category | Array of skill summaries (slug, name, description, visibility) |
| 22 | `config_list_org_skills` | List available org-created skills with name and description | Array of skill summaries (slug, name, description, isActive) |
| 23 | `config_get_agent_detail` | Get full configuration detail for a specific agent | Full agent record (all fields except deletedAt) |
| 24 | `config_get_link_detail` | Get full configuration detail for a specific subaccount agent link | Full subaccount agent record (all fields) |

### 4.3 Validation and history tools (4)

| # | Slug | Description | Gate level |
|---|---|---|---|
| 25 | `config_run_health_check` | Run workspace health audit and return findings (missing skills, broken schedules, etc.) | `auto` |
| 26 | `config_preview_plan` | Emit a structured configuration plan for user review before executing mutations | `auto` |
| 27 | `config_view_history` | List version history for a given entity (entity type + entity ID) | `auto` |
| 28 | `config_restore_version` | Restore an entity to a previous version from config history | `review` |

**Total: 28 skill tool handlers** (15 mutation, 9 read-only, 4 validation/history).

### 4.4 Action registry entries

Every mutation tool (1-15) and `config_restore_version` (28) gets an entry in `actionRegistry.ts`:

```typescript
config_create_agent: {
  actionType: 'config_create_agent',
  description: 'Create a new org-level agent via the Configuration Assistant',
  actionCategory: 'api',
  topics: ['configuration'],
  isExternal: false,
  defaultGateLevel: 'review',
  createsBoardTask: false,
  parameterSchema: z.object({
    name: z.string().describe('Agent name'),
    description: z.string().optional().describe('Agent description'),
    masterPrompt: z.string().describe('System prompt for the agent'),
    modelProvider: z.string().optional().default('anthropic'),
    modelId: z.string().optional().default('claude-sonnet-4-6'),
    // ... remaining fields
  }),
  retryPolicy: {
    maxRetries: 2,
    strategy: 'exponential_backoff',
    retryOn: ['timeout', 'network_error'],
    doNotRetryOn: ['validation_error', 'auth_error'],
  },
  idempotencyStrategy: 'keyed_write',
}
```

All 16 action entries follow this pattern. The `topics: ['configuration']` assignment ensures topic filtering surfaces only config tools during config conversations.

### 4.5 Scope enforcement — four independent layers

| Layer | Mechanism | What it prevents |
|---|---|---|
| **Skill allowlist** | `defaultSystemSkillSlugs` on the system agent definition lists only `config_*` tools. No other tools are available. | Agent cannot call non-config tools (e.g. `send_email`) |
| **System prompt** | Explicit "you can / you cannot" declaration in the prompt | Agent will not attempt out-of-scope actions conversationally |
| **Action registry** | Only `config_*` actions are registered. Unknown action types are rejected by `actionService.proposeAction()` | Even if hallucinated, unregistered actions fail |
| **Topic filtering** | All config tools tagged with `topics: ['configuration']`. Topic classifier surfaces only config tools. | Other tools don't appear in the tool selection context |

---

## 5. Knowledge Architecture

The Configuration Assistant needs deep platform knowledge to make good recommendations. This knowledge comes from three layers — none of which require a manually-maintained recipes document.

### 5.1 Layer 1: Static platform knowledge (eager-loaded data sources)

Two existing documents are attached to the Configuration Assistant as eager-loaded agent data sources:

| Document | What it teaches the agent |
|---|---|
| `architecture.md` | The three-tier agent model, skill cascade, scheduling system, data source scoping, execution limits, handoff system, permission model — how the platform works structurally |
| `capabilities.md` | The full capability catalogue — what the platform can do, what each feature provides, what skills exist by category |

Both documents are already maintained as part of the codebase (CLAUDE.md enforces "docs stay in sync with code"). No extra maintenance burden. When a new feature ships, the docs update in the same commit, and the Configuration Assistant's knowledge updates automatically.

These are loaded as `loadingMode: 'eager'` data sources on the agent definition, subject to the `MAX_EAGER_BUDGET` (60k tokens). Combined they are approximately 40-50k tokens — within budget but tight. If they grow beyond budget, `capabilities.md` can be switched to `loadingMode: 'lazy'` and retrieved on demand via `read_data_source`.

### 5.2 Layer 2: Skill knowledge (dynamic, via tools)

The 130+ skill `.md` files each contain an `## Instructions` section explaining when and how to use the skill. The Configuration Assistant accesses this dynamically:

- `config_list_system_skills` returns name + description for all system skills
- `config_list_org_skills` returns name + description for all org-created skills
- For deeper detail on a specific skill, the agent can use `read_data_source` or the skill's full definition from the listing response

This is self-maintaining. When a new skill is added to the platform, the Configuration Assistant automatically discovers it through its listing tools. No prompt update needed.

### 5.3 Layer 3: Existing org configuration (dynamic, via tools)

The Configuration Assistant inspects what's already configured in the org:

- `config_list_agents` — what agents exist and how they're configured
- `config_list_links` — how agents are linked to subaccounts, with what skills and schedules
- `config_list_scheduled_tasks` — what recurring work exists
- `config_list_data_sources` — what knowledge is attached

This solves the "recipes" problem organically. If an org already has a reporting agent linked to 5 clients with specific skills and a weekly schedule, the Configuration Assistant can see that pattern and replicate it for a 6th client — without needing a static recipe document.

For a cold-start org (no existing configuration), the agent falls back on Layer 1 (platform knowledge) and Layer 2 (skill descriptions) to recommend sensible starting configurations.

### 5.4 System prompt — reasoning framework, not recipes

The system prompt encodes **how to think about configuration**, not specific recipes:

**Scope awareness:**
```
You are the Configuration Assistant. You help organisation administrators
configure agents, skills, schedules, and data sources through conversation.

You CAN: create/update agents, link agents to subaccounts, set skills,
write custom instructions, create scheduled tasks, attach data sources,
view configuration history, and restore previous versions.

You CANNOT: manage users/permissions, configure integrations/connections,
create/edit playbooks, modify processes, create custom skills, or change
budgets/limits. If asked, explain what you can't do and suggest the admin UI.
```

**Target scope gathering:**
```
Before making any changes, establish the target scope:
- If the user names a specific client/subaccount, look it up using
  config_list_subaccounts. Use fuzzy matching on the name — "Acme"
  should match "Acme Dental Pty Ltd". If multiple subaccounts match,
  present the options and ask the user to confirm which one.
- If the request is ambiguous, ask: "Which client is this for, or should
  I set this up for all clients?"
- If org-level (new agent, skill changes), confirm: "This will affect
  the org-level agent available to all subaccounts. Proceed?"
- Never assume scope. Always confirm before executing.
```

**Configuration reasoning:**
```
When recommending a configuration:
- Check what already exists before proposing new entities
- Prefer the minimal skill set needed for the task
- Use customInstructions to differentiate per-client behaviour rather
  than duplicating agents
- When writing customInstructions, include: client business context,
  industry, location, brand voice, and what success looks like
- Schedule tasks at staggered times to avoid thundering herd
- Set reasonable execution limits (default tokenBudgetPerRun: 30000,
  maxToolCallsPerRun: 20, timeoutSeconds: 300)
- After completing a configuration, run config_run_health_check to validate
```

**Plan-first discipline:**
```
Never execute mutations without a plan. Always:
1. Gather requirements through conversation
2. Call config_preview_plan with the proposed changes
3. Wait for user approval
4. Execute the approved plan step by step
5. Run config_run_health_check after completion
```

### 5.5 Orchestrator awareness

The orchestrator agent's `masterPrompt` or `additionalPrompt` needs one addition so it knows to delegate configuration requests:

```
When a user requests new capabilities, workflows, or agent configurations
that don't currently exist in the subaccount, delegate to the Configuration
Assistant agent rather than attempting the work directly. The Configuration
Assistant specialises in setting up agents, skills, schedules, and data
sources. Route configuration requests to it via spawn_sub_agents.
```

This is a prompt-only change — no new skills or code needed on the orchestrator.

---

## 6. Conversation UX and Plan-Approve-Execute Flow

### 6.1 Conversation phases

Every configuration session follows a natural progression:

| Phase | What happens | Agent behaviour |
|---|---|---|
| **Discovery** | User describes what they want. Agent asks clarifying questions. | Uses `ask_clarifying_question` and read-only tools to understand the request and current state |
| **Design** | Agent proposes a configuration plan. | Calls `config_preview_plan` with structured mutation list |
| **Review** | User reviews the plan, asks questions, requests changes. | Iterates on the plan; may call read-only tools to answer questions |
| **Execute** | User approves. Agent executes mutations step by step. | Calls mutation tools in sequence with real-time progress via WebSocket |
| **Validate** | Agent runs health check and reports results. | Calls `config_run_health_check`, summarises outcome |

The agent is not forced through these phases rigidly — they emerge naturally from the prompt discipline ("never execute without a plan").

### 6.2 Streaming

The Configuration Assistant runs through `agentExecutionService`, which provides real-time streaming via the existing WebSocket infrastructure:

- **Room:** `agent-run:${runId}` — the frontend subscribes when the run starts
- **Events during execution:**
  - `agent:run:iteration` — text chunk from the agent's response (streaming)
  - `agent:run:tool_call` — tool call started (renders as progress indicator)
  - `agent:run:tool_result` — tool call completed (updates progress)
  - `agent:run:complete` — run finished

The frontend renders streamed text progressively (not atomically) for a responsive conversational feel. This matches the Freedom Planner UX pattern where AI responses appear token by token.

### 6.3 Plan preview UX

When the agent calls `config_preview_plan`, it emits a structured plan:

```typescript
interface ConfigPlan {
  summary: string;             // "Create 2 agents, link to 8 subaccounts, create 16 scheduled tasks"
  targetScope: {
    type: 'org' | 'subaccount' | 'multiple_subaccounts';
    subaccountIds?: string[];
    subaccountNames?: string[];
  };
  steps: ConfigPlanStep[];
}

interface ConfigPlanStep {
  stepNumber: number;
  action: string;              // e.g. 'config_create_agent'
  entityType: string;          // e.g. 'agent'
  summary: string;             // Human-readable: "Create agent 'SEO Auditor'"
  parameters: Record<string, unknown>;  // The actual tool call parameters
  dependsOn?: number[];        // Step numbers this depends on (for entity ID resolution)
}
```

The frontend renders this as an **interactive checklist**:

```
┌─────────────────────────────────────────────────────┐
│ Configuration Plan                                   │
│ Create 2 agents, link to 8 subaccounts,             │
│ create 16 scheduled tasks                           │
│                                                      │
│ Scope: All subaccounts (8)                          │
│                                                      │
│ ☑ 1. Create agent "SEO Auditor"                     │
│ ☑ 2. Create agent "Performance Reporter"            │
│ ☑ 3. Link SEO Auditor → Acme Corp                   │
│ ☑ 4. Link SEO Auditor → Beta Inc                    │
│   ...                                                │
│ ☑ 19. Create task "Weekly SEO Audit" → Acme Corp    │
│ ☑ 20. Create task "Weekly SEO Audit" → Beta Inc     │
│   ...                                                │
│                                                      │
│          [ Execute Plan ]    [ Cancel ]              │
└─────────────────────────────────────────────────────┘
```

Each item has a checkbox (default: checked). The user can uncheck individual steps to skip them. "Execute Plan" sends the approved subset back to the agent for execution.

### 6.4 Execution progress

During plan execution, each step updates in real-time via WebSocket:

| State | Visual |
|---|---|
| Pending | Grey checkbox |
| In progress | Spinning indicator |
| Completed | Green checkmark |
| Failed | Red X with error message |
| Skipped (user unchecked) | Grey strikethrough |

Steps that depend on a failed step are automatically marked as "Blocked" with an explanation.

### 6.5 Context indicator

Once the agent establishes the target scope through conversation, the chat header shows a persistent context badge:

```
Configuration Assistant
Scope: Company ABC (subaccount)                    [change]
```

The agent updates this by including a `resolvedScope` metadata field in its responses:

```typescript
{
  resolvedScope: {
    type: 'subaccount',
    id: 'uuid-here',
    name: 'Company ABC'
  }
}
```

The frontend renders this as the header badge. The `[change]` link allows the user to redirect scope mid-conversation.

For multi-subaccount operations: `Scope: 8 subaccounts`
For org-level operations: `Scope: Organisation`

### 6.6 Suggested actions

The chat input area includes optional quick-action pills, contextualised to the conversation phase:

| Phase | Suggested actions |
|---|---|
| Start | "Set up a new client", "Configure reporting", "Show current configuration" |
| After plan approval | "Execute plan", "Modify step 3", "Show me the detail" |
| After execution | "Run health check", "Show what changed", "Set up another client" |

These are rendered as clickable pills below the input box (matching the Freedom Planner UX pattern). Clicking a pill pre-fills and sends the message.

### 6.7 Conversation persistence

Config conversations are stored in `agent_conversations` + `agent_messages` (existing tables). The `agentConversations.subaccountId` is set to the org subaccount ID.

All org admins in the org can see all configuration conversations (org-scoped, not user-scoped). Config sessions are institutional knowledge — "here's how we set up the SEO workflow" — not personal conversations.

Past conversations appear in a sidebar list (existing pattern from `AgentChatPage`), allowing admins to review previous config sessions and continue them.

---

## 7. Config History System

### 7.1 Design approach

A single generic JSONB changelog table tracks record-level history for all configuration entities. This approach (vs. per-entity history tables) was chosen because:

- One table, one migration, one service function — adding a new tracked entity is one line of wiring
- Schema changes to parent tables are automatically captured (JSONB is schemaless)
- Avoids duplicating 14 table schemas into 14 corresponding history tables
- Unifies the five inconsistent history patterns already in the codebase (`agentPromptRevisions`, `skillVersions`, `playbookTemplateVersions`, `pageVersions`, `audit_events`)

Existing history systems (`agentPromptRevisions`, `skillVersions`, etc.) are kept as-is. The `config_history` table sits alongside them, not replacing them. Over time, new features should use `config_history` rather than creating bespoke history tables.

### 7.2 Schema

```sql
-- Migration: 0114_config_history.sql

CREATE TABLE config_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id),
  entity_type      TEXT NOT NULL,
  entity_id        UUID NOT NULL,
  version          INTEGER NOT NULL,
  snapshot         JSONB NOT NULL,
  changed_by       UUID REFERENCES users(id),
  change_source    TEXT NOT NULL DEFAULT 'ui',  -- 'ui' | 'api' | 'config_agent' | 'system_sync' | 'restore'
  session_id       UUID,                        -- config agent conversation/run ID (null for non-agent changes)
  change_summary   TEXT,                        -- optional human-readable description
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT config_history_entity_version_uniq
    UNIQUE(entity_type, entity_id, version)
);

CREATE INDEX config_history_org_idx ON config_history(organisation_id);
CREATE INDEX config_history_entity_idx ON config_history(entity_type, entity_id);
CREATE INDEX config_history_session_idx ON config_history(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX config_history_changed_at_idx ON config_history(organisation_id, changed_at DESC);
```

### 7.3 Tracked entity types (14)

#### Must track (7) — high mutation frequency or high blast radius

| # | `entity_type` value | Source table | Key fields in snapshot |
|---|---|---|---|
| 1 | `agent` | `agents` | name, masterPrompt, additionalPrompt, modelProvider, modelId, temperature, maxTokens, responseMode, outputSize, defaultSkillSlugs, heartbeat settings, concurrency settings, status, complexityHint, icon, description |
| 2 | `subaccount_agent` | `subaccount_agents` | skillSlugs, allowedSkillSlugs, customInstructions, tokenBudgetPerRun, maxToolCallsPerRun, timeoutSeconds, maxCostPerRunCents, maxLlmCallsPerRun, heartbeat settings, schedule settings, concurrency settings, isActive, agentRole, agentTitle |
| 3 | `scheduled_task` | `scheduled_tasks` | title, description, brief, assignedAgentId, rrule, timezone, scheduleTime, priority, retryPolicy, tokenBudgetPerRun, isActive, endsAt, endsAfterRuns |
| 4 | `agent_data_source` | `agent_data_sources` | name, description, sourceType, sourcePath, contentType, priority, maxTokenBudget, loadingMode, cacheMinutes, syncMode |
| 5 | `skill` | `skills` | name, slug, definition, instructions, visibility, isActive, skillType, description |
| 6 | `policy_rule` | `policy_rules` | toolSlug, priority, evaluationMode, conditions, decision, interruptConfig, allowedDecisions, descriptionTemplate, timeoutSeconds, timeoutPolicy, confidenceThreshold, guidanceText, isActive |
| 7 | `permission_set` | `permission_sets` + `permission_set_items` | name, description, isDefault, permissionKeys (denormalized array from items join) |

#### Should track (7) — moderate change frequency, meaningful impact

| # | `entity_type` value | Source table | Key fields in snapshot |
|---|---|---|---|
| 8 | `subaccount` | `subaccounts` | name, slug, status, settings, includeInOrgInbox, isOrgSubaccount |
| 9 | `workspace_limits` | `workspace_limits` | dailyTokenLimit, dailyCostLimitCents, perRunTokenLimit, monthlyCostLimitCents, maxCostPerRunCents, maxRequestsPerMinute, maxRequestsPerHour, maxTokensPerRequest, maxLlmCallsPerRun, alertThresholdPct |
| 10 | `org_budget` | `org_budgets` | monthlyCostLimitCents, alertThresholdPct |
| 11 | `mcp_server_config` | `mcp_server_configs` | presetSlug, transport, command, args, endpointUrl, allowedTools, blockedTools, defaultGateLevel, toolGateOverrides, priority, maxConcurrency, connectionMode, status |
| 12 | `agent_trigger` | `agent_triggers` | event type, eventFilter, cooldownSeconds, isActive, subaccountId, agentId |
| 13 | `connector_config` | `connector_configs` | connectorType, configJson, syncPhase, pollIntervalMinutes, status, webhookSecret |
| 14 | `integration_connection` | `integration_connections` | providerType, authType, label, status, configJson, oauthStatus — **excludes** accessToken, refreshToken, clientIdEnc, clientSecretEnc, encryptionKeyEnc (never snapshot encrypted credentials) |

### 7.4 Service function

A single service function handles all history writes:

```typescript
// server/services/configHistoryService.ts

interface RecordHistoryParams {
  entityType: string;
  entityId: string;
  organisationId: string;
  snapshot: Record<string, unknown>;
  changedBy: string | null;
  changeSource: 'ui' | 'api' | 'config_agent' | 'system_sync' | 'restore';
  sessionId?: string | null;
  changeSummary?: string | null;
}

async function recordConfigHistory(params: RecordHistoryParams): Promise<void> {
  // 1. Compute next version number for this entity
  //    SELECT COALESCE(MAX(version), 0) + 1 FROM config_history
  //    WHERE entity_type = $1 AND entity_id = $2
  //
  // 2. Strip sensitive fields for integration_connection entities
  //
  // 3. INSERT into config_history
}
```

### 7.5 Wiring into service update paths

Each tracked entity's service needs a `recordConfigHistory()` call **before** every UPDATE and DELETE. The call captures the current state (pre-mutation) so the history record represents what the entity looked like before the change.

Example wiring in `agentService.updateAgent()`:

```typescript
async updateAgent(agentId: string, orgId: string, patch: Partial<Agent>, userId?: string) {
  // 1. Fetch current state
  const current = await this.getAgent(agentId, orgId);

  // 2. Record history (pre-mutation snapshot)
  await configHistoryService.recordConfigHistory({
    entityType: 'agent',
    entityId: agentId,
    organisationId: orgId,
    snapshot: current,
    changedBy: userId ?? null,
    changeSource: 'api',  // overridden to 'config_agent' when called from config tools
  });

  // 3. Apply the update
  const updated = await db.update(agents).set(patch).where(...).returning();
  return updated;
}
```

Config agent tools pass `changeSource: 'config_agent'` and `sessionId: context.runId` so config-agent-driven changes are distinguishable from manual UI/API changes.

### 7.6 History on create and delete

- **Create:** The first history record for a new entity is written after the INSERT, with `version: 1` and the initial state as the snapshot. This establishes the baseline.
- **Soft delete:** A history record is written before setting `deletedAt`, capturing the final state. The `change_summary` reads "Entity soft-deleted".
- **Hard delete:** A history record is written before the DELETE, capturing the final state. The `change_summary` reads "Entity deleted".

---

## 8. View History and Restore

### 8.1 API endpoints

| Method | Endpoint | Permission | Purpose |
|---|---|---|---|
| `GET` | `/api/org/config-history/:entityType/:entityId` | `org_admin` or `system_admin` | List all versions of an entity (version, changed_at, changed_by, change_source, change_summary). Ordered by version DESC. Supports `?limit=` and `?offset=` for pagination. |
| `GET` | `/api/org/config-history/:entityType/:entityId/versions/:version` | `org_admin` or `system_admin` | Get the full JSONB snapshot for a specific version |
| `POST` | `/api/org/config-history/:entityType/:entityId/restore/:version` | `org_admin` or `system_admin` | Restore entity to a specific version. Applies the snapshot as an UPDATE, which itself creates a new history entry with `change_source: 'restore'` |
| `GET` | `/api/org/config-history/session/:sessionId` | `org_admin` or `system_admin` | List all history records from a specific config agent session. Used for "show me everything the config agent changed in this session". |

### 8.2 Restore mechanics

Restoring version N does NOT delete versions N+1, N+2, etc. It creates a **new version** with the content of version N. History is always append-only.

```
Version 1: Initial state
Version 2: User changed prompt
Version 3: Config agent changed skills
Version 4: Restore to version 1        ← new record, same content as v1
```

The restore flow:

1. Fetch the snapshot from the target version
2. Validate the snapshot is compatible with the current schema (field names still exist)
3. Record a new history entry for the current state (pre-restore snapshot)
4. Apply the snapshot fields as an UPDATE to the entity
5. Return the restored entity

For `permission_set` restores (entity type 7), the `permissionKeys` array in the snapshot is denormalized. The restore must: update the `permission_sets` row AND reconcile `permission_set_items` (delete removed keys, insert added keys).

### 8.3 Config agent tools

**`config_view_history`:**

```typescript
// Input
{ entityType: string, entityId: string, limit?: number }

// Output
{
  entityType: 'agent',
  entityId: 'uuid',
  entityName: 'SEO Auditor',     // resolved from current entity
  versions: [
    {
      version: 3,
      changedAt: '2026-04-14T10:30:00Z',
      changedBy: 'admin@example.com',
      changeSource: 'config_agent',
      changeSummary: 'Updated skills and schedule',
    },
    // ...
  ]
}
```

**`config_restore_version`:**

```typescript
// Input
{ entityType: string, entityId: string, version: number }

// Output
{ success: true, restoredToVersion: 3, newVersion: 7 }
```

This tool has `defaultGateLevel: 'review'` — the user must approve before the restore executes.

### 8.4 Minimal UI — history tab

Every entity detail page that corresponds to a tracked entity type gets a **History tab** (or expandable section):

- **Agent edit page** → History tab showing prompt/model/skill changes
- **Subaccount agent link edit page** → History tab showing instruction/schedule/skill changes
- **Scheduled task edit page** → History tab showing description/schedule changes

The tab renders:

```
┌─────────────────────────────────────────────────────────┐
│ History                                                  │
│                                                          │
│ v5  Today 10:30am   Config Agent   "Updated skills"     │
│     [View snapshot]  [Restore]                           │
│                                                          │
│ v4  Today 09:15am   Admin UI       "Changed schedule"   │
│     [View snapshot]  [Restore]                           │
│                                                          │
│ v3  Yesterday        Config Agent   "Initial setup"      │
│     [View snapshot]  [Restore]                           │
│                                                          │
│ v2  Apr 12           Admin UI                            │
│     [View snapshot]  [Restore]                           │
│                                                          │
│ v1  Apr 10           System Sync    "Created"            │
│     [View snapshot]  [Restore]                           │
└─────────────────────────────────────────────────────────┘
```

- **[View snapshot]** expands the JSONB snapshot inline as a formatted key-value list
- **[Restore]** shows a confirmation dialog ("Restore this entity to version N? Current configuration will be saved as a new version before restoring.") then calls the restore endpoint

No diff viewer in v1. The version list + snapshot view + restore button covers the primary use case: "something broke, show me what changed, put it back how it was."

### 8.5 Activity feed deep link

When the Configuration Assistant completes a session and posts a summary to the org activity feed (Section 9.3), clicking the activity item navigates to a **session history view**:

`/admin/config-history/session/:sessionId`

This page lists all `config_history` records for that session, grouped by entity, with links to each entity's detail page. It answers: "what exactly did the config agent change in this session?"

---

## 9. Error Handling, Notifications, and Safety

### 9.1 Multi-step failure handling: stop and report

When a plan is executing and a step fails:

1. **Stop execution immediately** — do not attempt remaining steps
2. **Mark the failed step** with the error message in the plan progress UI (red X)
3. **Mark dependent steps** as "Blocked" (they cannot proceed without the failed step's output)
4. **Mark remaining independent steps** as "Skipped"
5. **Report to the user** — the agent explains what succeeded, what failed, and why
6. **Offer options:**
   - "Retry the failed step" (if the error is transient)
   - "Skip this step and continue with the rest" (if the step is optional)
   - "Roll back completed steps" (the agent uses `config_restore_version` to revert each completed mutation using the pre-execution history records)
   - "Abandon the plan" (leave completed steps as-is, stop execution)

The user chooses. The agent does not auto-rollback — that risks cascading failures and removes human agency from the recovery decision.

### 9.2 Mutation rate limiting

A soft cap is encoded in the system prompt:

```
If a configuration plan exceeds 30 mutations, break it into phases
and confirm with the user before proceeding with each phase. Present
the phases with estimated scope (e.g. "Phase 1: Create agents (4 steps),
Phase 2: Link to subaccounts (16 steps), Phase 3: Create tasks (16 steps)").
```

No hard cap in code for v1. The per-plan user approval already gates execution. Mutation count per session is tracked via `config_history` records tagged with the session ID — if a hard cap becomes necessary, it can be enforced by counting records with the current session ID.

### 9.3 Activity feed notification

When the Configuration Assistant completes a plan execution (all steps done or stopped due to failure), it posts a summary to the org activity feed:

```typescript
{
  type: 'config_session_completed',
  organisationId: orgId,
  metadata: {
    sessionId: conversationId,
    summary: 'Configuration Assistant completed 12 changes: created 2 agents, linked to 8 subaccounts, created 2 scheduled tasks',
    totalSteps: 12,
    completedSteps: 12,
    failedSteps: 0,
    userId: requestingUserId,
  }
}
```

This uses the existing activity infrastructure (`activity` table or existing activity service). The activity item links to the session history view (`/admin/config-history/session/:sessionId`), where clicking reveals full detail of every change made.

### 9.4 Self-modification guard

As specified in Section 2, the Configuration Assistant cannot modify its own agent definition. The guard applies to:

- `config_update_agent` — rejects if `targetAgentId` matches the config agent's own ID
- `config_activate_agent` — same check
- `config_update_link` — rejects if the link targets the config agent

This prevents scenarios where the agent rewrites its own prompt or disables itself.

### 9.5 Entity dependency resolution

Multi-step plans often have dependencies: a subaccount created in step 1 is referenced in step 3. The config agent handles this naturally in conversation — it creates the entity, receives the ID in the tool result, and uses it in subsequent calls.

The plan preview must represent dependencies clearly. Each `ConfigPlanStep` has an optional `dependsOn: number[]` field listing the step numbers it depends on. If a depended-on step fails or is skipped, dependent steps are automatically blocked.

### 9.6 Concurrent session protection

If two org admins start config sessions simultaneously and both attempt to modify the same entity:

- The service layer handles this with standard database concurrency (last write wins)
- Each mutation writes a config_history record, so no changes are lost — both versions are captured
- The `config_preview_plan` tool reads current state at plan-creation time. If the state changes between plan creation and execution (another admin modified the entity), the tool should re-read current state before each mutation and warn if it has drifted from what was shown in the plan

For v1, the drift detection is a nice-to-have. The config_history records ensure nothing is lost regardless.

### 9.7 Audit trail

Every mutation made by the Configuration Assistant is triple-tracked:

| Mechanism | What it captures | Purpose |
|---|---|---|
| `config_history` | Full pre-mutation snapshot with `change_source: 'config_agent'` and `session_id` | Record-level history and restore |
| `audit_events` | Action type, entity ID, user ID, correlation ID | Compliance and security audit |
| `agent_runs` / `agent_run_messages` | Full conversation transcript with tool calls and results | Session replay and debugging |

---

## 10. QA Scenarios

These are manual QA scenarios used during development and as regression benchmarks for prompt/tool changes. Each scenario defines a user input, the expected agent behaviour, and the expected configuration outcome.

### Scenario 1: New client full setup

**Input:** "I have a new client, Acme Dental. They're a dental practice in Sydney's CBD. I need weekly SEO monitoring and monthly performance reports."

**Expected behaviour:**
1. Agent confirms it needs to create a subaccount and asks for any additional client details
2. Agent proposes a plan: create subaccount, link SEO agent + Reporting agent, create 2 scheduled tasks
3. After approval, executes the plan

**Expected configuration:**
- New subaccount "Acme Dental" created
- SEO agent linked with skills including `audit_geo`, `geo_schema`, `geo_crawlers`, `web_search`
- Reporting agent linked with relevant reporting skills
- Custom instructions on both links reference dental industry, Sydney CBD location
- Weekly SEO task (Monday 6am AEST) + monthly report task (1st of month 7am AEST)
- Health check passes after completion

### Scenario 2: Replicate existing pattern for new client

**Input:** "I need to set up Client Beta the same way Client Alpha is configured."

**Expected behaviour:**
1. Agent reads Client Alpha's configuration (agents, links, skills, schedules, tasks)
2. Agent proposes replicating the pattern for Client Beta
3. Custom instructions are adapted for Client Beta (not copy-pasted from Alpha)

**Expected configuration:**
- Same agents linked with same skills
- Same scheduled tasks with same cadence
- Custom instructions reference Client Beta's name (agent should ask for Beta-specific context)

### Scenario 3: Add a capability to existing clients

**Input:** "I want to add GEO monitoring to all my clients. Can you set that up?"

**Expected behaviour:**
1. Agent lists subaccounts to determine how many clients exist
2. Agent checks if a GEO-capable agent already exists or needs to be created
3. Agent proposes a plan (potentially 20+ mutations if many clients)
4. If >30 mutations, breaks into phases per the rate limiting guidance

**Expected configuration:**
- GEO agent created (if not existing) with appropriate skills
- Linked to all active subaccounts
- Scheduled tasks created per subaccount with staggered times (not all at the same hour)

### Scenario 4: Modify a single client's schedule

**Input:** "Company ABC's reports should run on Thursdays instead of Mondays."

**Expected behaviour:**
1. Agent looks up Company ABC's subaccount
2. Agent finds the relevant scheduled task or agent link schedule
3. Agent proposes a single change
4. Executes after approval

**Expected configuration:**
- Schedule updated from Monday to Thursday
- No other configuration affected

### Scenario 5: View and restore after a mistake

**Input:** "Something's wrong with the SEO Auditor agent. It was working fine yesterday. Can you check what changed?"

**Expected behaviour:**
1. Agent calls `config_view_history` for the SEO Auditor agent
2. Shows the version history with timestamps and change sources
3. If the user asks to restore, calls `config_restore_version` with approval

**Expected configuration:**
- History displayed accurately with change summaries
- Restore creates a new version (not destructive to existing history)
- Agent runs health check after restore

### Scenario 6: Out-of-scope request handled gracefully

**Input:** "Can you set up our HubSpot integration and create a new user account for my colleague?"

**Expected behaviour:**
1. Agent explains that integrations and user management are outside its scope
2. Directs the user to the admin UI for those features
3. Asks if there's something within its scope it can help with

**Expected configuration:**
- No mutations made
- No hallucinated tool calls

### Scenario 7: Create scheduled task for existing agent

**Input:** "I want the Performance Reporter to generate a weekly flash report for Client X every Friday at 5pm."

**Expected behaviour:**
1. Agent confirms Client X exists and the Performance Reporter agent is linked
2. Agent proposes creating a scheduled task
3. Task description includes clear instructions for what "weekly flash report" means

**Expected configuration:**
- New scheduled task with RRULE for weekly Friday 5pm in the client's timezone
- Assigned to the Performance Reporter agent
- Description field contains actionable instructions, not just "generate a report"

### Scenario 8: Bulk operation across subaccounts

**Input:** "Increase the token budget for all agents across all subaccounts to 50000."

**Expected behaviour:**
1. Agent lists all subaccount agent links
2. Agent proposes updating `tokenBudgetPerRun` on each link
3. Breaks into phases if the total mutations exceed 30
4. Executes in batches after approval per phase

**Expected configuration:**
- All subaccount agent links updated with `tokenBudgetPerRun: 50000`
- Config history records for every modified link

---

## 11. Phasing, Effort, and Deferred Items

### 11.1 Implementation phases

#### Phase 1: Config history foundation

Build the `config_history` table and wire it into all 14 entity types. This has no dependency on the config agent and delivers standalone value (audit trail + restore for manual UI changes).

| Work item | Effort |
|---|---|
| Migration: `config_history` table, indices, RLS policy | 0.5 days |
| Drizzle schema: `server/db/schema/configHistory.ts` | 0.5 days |
| Service: `configHistoryService.ts` (record, list, get, restore) | 1.5 days |
| Wire into 7 "must track" service update paths | 1.5 days |
| Wire into 7 "should track" service update paths | 1 day |
| API routes: `/api/org/config-history/*` | 1 day |
| Minimal UI: History tab on agent/link/task edit pages | 2 days |
| **Phase 1 total** | **~8 days** |

#### Phase 2: Configuration Assistant agent

Build the system agent, tool handlers, system prompt, and execution flow.

| Work item | Effort |
|---|---|
| System agent definition + migration (seed to `systemAgents`) | 0.5 days |
| Module definition + subscription updates migration | 0.5 days |
| Skill `.md` files for 28 tools (parameters + instructions) | 2 days |
| Skill handlers in `skillExecutor.ts` (28 handlers wrapping existing services) | 4 days |
| Action registry entries for 16 mutation/restore tools | 1 day |
| System prompt authoring and iteration | 3 days |
| Org subaccount link guard | 0.5 days |
| Self-modification guard | 0.5 days |
| Orchestrator prompt update for delegation awareness | 0.5 days |
| **Phase 2 total** | **~12.5 days** |

#### Phase 3: Conversation UX

Build the frontend experience — streaming chat, plan preview, execution progress, context indicator.

| Work item | Effort |
|---|---|
| Config Assistant page (new page, reusing chat patterns from `AgentChatPage`) | 2 days |
| Streaming message renderer (subscribe to agent run WebSocket room) | 2 days |
| Plan preview component (interactive checklist with approve/reject per step) | 2 days |
| Execution progress overlay (real-time step status updates) | 1.5 days |
| Context indicator (scope badge in chat header) | 0.5 days |
| Suggested action pills (contextual quick actions) | 0.5 days |
| Sidebar nav entry (gated by module) | 0.5 days |
| Session history page (`/admin/config-history/session/:sessionId`) | 1 day |
| Activity feed integration (post summary on session complete, deep link to session history) | 1 day |
| **Phase 3 total** | **~11.5 days** |

#### Phase 4: Testing and polish

| Work item | Effort |
|---|---|
| QA walkthrough of all 8 scenarios | 2 days |
| Prompt tuning based on QA findings | 2 days |
| Edge case handling (empty orgs, missing subaccounts, invalid slugs) | 1 day |
| **Phase 4 total** | **~5 days** |

### 11.2 Total effort

| Phase | Effort | Can run in parallel? |
|---|---|---|
| Phase 1: Config history | ~8 days | Independent — can start immediately |
| Phase 2: Config agent | ~12.5 days | Depends on Phase 1 (tools write history records) |
| Phase 3: Conversation UX | ~11.5 days | Frontend can start after Phase 2 tool handlers exist; some UI work can parallel Phase 2 |
| Phase 4: Testing | ~5 days | Sequential — needs Phases 1-3 complete |
| **Total** | **~37 days (~7-8 weeks)** | With parallelisation: **~5-6 weeks** |

### 11.3 LLM cost per session

| Phase | Estimated tokens | Model | Approx cost |
|---|---|---|---|
| Discovery (5-8 turns) | ~30K input, ~10K output | Sonnet 4.6 | ~$0.25 |
| Design + plan (3-5 turns with tool calls) | ~50K input, ~15K output | Sonnet 4.6 | ~$0.40 |
| Execution (5-15 tool calls) | ~40K input, ~5K output | Sonnet 4.6 | ~$0.20 |
| **Total per session** | | | **~$0.85** |

For an agency configuring 10-20 clients: ~$10-20 in LLM costs for initial setup. Negligible relative to the value delivered.

### 11.4 Deferred items — explicitly out of scope for this build

| Item | Why deferred | When to revisit |
|---|---|---|
| **System-level config agent** | Different product — different tools, different knowledge, higher blast radius (all orgs affected). Requires a separate system prompt, separate tool set, and elevated permissions. | After org-level is validated in production with real users |
| **Auto-rollback on failure** | Complex, risk of cascading failures during rollback. Stop-and-report with manual rollback via `config_restore_version` is safer. | Phase 2, after stop-and-report proves sufficient in practice |
| **Session-level bulk undo** | Schema supports it (`session_id` field on `config_history`), but the tool ("undo everything from session X") and UI are extra work. | Phase 2 — the foundation is in place |
| **Diff viewer (compare two versions)** | Nice-to-have, ~1 week of UI work for a low-frequency use case. Version list + snapshot view covers 95% of needs. | When users request it |
| **Scope expansion: permissions, connections, playbooks, processes, triggers** | Each domain is a batch of new tools + prompt knowledge + QA scenarios. Adding too much at once dilutes quality. | One domain at a time, based on user demand. Permissions and connections are the likely first expansions. |
| **Configuration templates / recipes library** | The config agent's dynamic knowledge (existing org config + skill descriptions) handles the cold-start problem adequately. A recipes library depends on real usage patterns. | After 50+ real config sessions inform the common patterns |
| **Backup/restore (full account snapshot)** | Foundation exists via `config_history`, but a full account snapshot (all entities at a point in time) + one-click restore is a separate feature. | Phase 3 — build on top of the config_history infrastructure |
| **Granular permission key for config agent access** | v1 uses role-based gating (`org_admin` / `system_admin`). A dedicated permission key (e.g. `org.config_assistant.access`) enables manager-level access. | When there's demand for non-admin access |
| **Conversational onboarding** | The config agent is a natural evolution of the onboarding wizard (`/api/onboarding/*`). This is a deliberate architectural convergence point — new orgs could use the config agent for a conversational first-time setup instead of the rigid step-by-step wizard. The same tools, conversation patterns, and plan-approve-execute flow apply. Design decisions in v1 should not close this path. | After v1 config agent is stable. Design the onboarding flow to reuse the same tools, system prompt patterns, and UX components. |
| **Concurrent session drift detection** | Re-reading current state before each mutation to detect changes by other admins since plan creation. | Phase 2, if concurrent editing becomes a real problem |

---

## Appendix: Key Files Reference

Files that will be created or modified during implementation:

### New files

| File | Purpose |
|---|---|
| `migrations/0114_config_history.sql` | Config history table |
| `migrations/0115_configuration_assistant.sql` | System agent seed + module + subscription updates |
| `server/db/schema/configHistory.ts` | Drizzle schema for `config_history` |
| `server/services/configHistoryService.ts` | History CRUD + restore logic |
| `server/routes/configHistory.ts` | API endpoints for history/restore |
| `server/skills/config_*.md` | 28 skill definition files |
| `client/src/pages/ConfigAssistantPage.tsx` | Configuration Assistant chat page |
| `client/src/pages/ConfigSessionHistoryPage.tsx` | Session history detail page |
| `client/src/components/ConfigPlanPreview.tsx` | Interactive plan checklist |
| `client/src/components/ConfigHistoryTab.tsx` | Reusable history tab for entity detail pages |

### Modified files

| File | Change |
|---|---|
| `server/services/skillExecutor.ts` | Add 28 entries to `SKILL_HANDLERS` |
| `server/config/actionRegistry.ts` | Add 16 action entries for mutation tools |
| `server/config/topicRegistry.ts` | Add `configuration` topic |
| `server/services/agentService.ts` | Wire `recordConfigHistory()` for agent entity type |
| `server/services/subaccountAgentService.ts` | Wire `recordConfigHistory()` for subaccount_agent entity type |
| `server/services/scheduledTaskService.ts` | Wire `recordConfigHistory()` for scheduled_task entity type |
| `server/services/agentDataSourceService.ts` | Wire `recordConfigHistory()` for agent_data_source entity type |
| `server/services/skillService.ts` | Wire `recordConfigHistory()` for skill entity type |
| `server/services/policyEngineService.ts` | Wire `recordConfigHistory()` for policy_rule entity type |
| `server/routes/permissionSets.ts` | Wire `recordConfigHistory()` for permission_set entity type (logic is in route) |
| `server/routes/subaccounts.ts` | Wire `recordConfigHistory()` for subaccount entity type (CRUD is in route) |
| `server/routes/workspaceMemory.ts` or relevant limits route | Wire `recordConfigHistory()` for workspace_limits entity type |
| `server/services/budgetService.ts` | Wire `recordConfigHistory()` for org_budget entity type |
| `server/services/mcpServerConfigService.ts` | Wire `recordConfigHistory()` for mcp_server_config entity type |
| `server/services/triggerService.ts` | Wire `recordConfigHistory()` for agent_trigger entity type |
| `server/services/connectorConfigService.ts` | Wire `recordConfigHistory()` for connector_config entity type |
| `server/services/integrationConnectionService.ts` | Wire `recordConfigHistory()` for integration_connection entity type |
| `server/routes/subaccountAgents.ts` | Add org-subaccount-only link guard |
| `server/index.ts` | Mount config history routes |
| `client/src/App.tsx` | Add config assistant and session history routes |
| `docs/capabilities.md` | Add Configuration Assistant to capabilities |
| `architecture.md` | Add config history and config agent sections |
