# Autonomous Agent Teams — Implementation Plan

## Context
Building the autonomous agent execution layer on top of the existing Kanban board, agent system, and task infrastructure. Agents work on board items, coordinate through the workspace, and produce deliverables for human review.

## Architecture Decisions
- **Agent linking**: Agents stay at org level, linked to sub-accounts via `subaccount_agents`. Per-subaccount config stored on the link record.
- **Skills (not tools)**: UI/data model calls them "skills". Built-in skills for Phase 1: `web_search`, `read_workspace`, `write_workspace`, `trigger_task`, `create_workspace_item`, `move_workspace_item`, `add_deliverable`. Each skill maps to an Anthropic tool definition at API call time.
- **Web search**: Tavily API via `TAVILY_API_KEY` env var, behind a provider interface.
- **Execution**: API mode only (Phase 1). Service interface ready for future headless mode.
- **Soft stop**: When token budget exhausted, finish current tool call, then one final wrap-up.
- **Kanban integration**: Agents work on board items, log activities, create new items, attach deliverables. Human reviews/approves before final action.
- **Activity page**: Scoped by role (system admin → all, org admin → their org, subaccount → their subaccount).

---

## Build Sequence

### Step 1: Agent Templates (System-Level)
- [ ] Add `agent_templates` table (system-level, no orgId)
  - id, name, slug, description, category, masterPrompt, modelProvider, modelId, temperature, maxTokens
  - defaultScheduleCron, defaultTokenBudget, expectedDataTypes (jsonb)
  - skillSlugs (jsonb array of skill slugs this template needs)
  - executionMode ('api' | 'headless'), isPublished, version
  - createdAt, updatedAt
- [ ] Add `agentTemplateService` — CRUD for templates
- [ ] Add system-admin routes for template management
- [ ] Update agent creation to optionally reference a sourceTemplateId

### Step 2: Subaccount Agent Config
- [ ] Add columns to `subaccount_agents` table:
  - scheduleCron (text, nullable) — e.g. "0 */2 * * *"
  - scheduleEnabled (boolean, default false)
  - tokenBudgetPerRun (integer, default 30000)
  - maxToolCallsPerRun (integer, default 20)
  - timeoutSeconds (integer, default 300)
  - skillSlugs (jsonb array — which skills this agent can use in this subaccount)
  - customInstructions (text — extra subaccount-specific prompt additions)
  - lastRunAt, nextRunAt (timestamps)
- [ ] Update subaccountAgentService with schedule/config methods
- [ ] Add API routes for configuring subaccount agent settings

### Step 3: Skills System
- [ ] Add `skills` table (system-level + org-level)
  - id, organisationId (nullable — null = system/built-in), name, slug, description
  - skillType ('built_in' | 'custom')
  - definition (jsonb — Anthropic tool schema)
  - instructions (text — markdown skill instructions injected into prompt)
  - isActive, createdAt, updatedAt
- [ ] Seed built-in skills: web_search, read_workspace, write_workspace, trigger_task, create_workspace_item, move_workspace_item, add_deliverable
- [ ] Add skill service and routes
- [ ] Wire skill definitions into the LLM tool builder

### Step 4: Agent Runs Table
- [ ] Add `agent_runs` table
  - id, organisationId, subaccountId, agentId, subaccountAgentId
  - runType ('scheduled' | 'manual' | 'triggered')
  - executionMode ('api' | 'headless')
  - status ('pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled')
  - triggerContext (jsonb — what initiated the run: schedule, user, or event)
  - systemPromptSnapshot (text)
  - toolCallsLog (jsonb array — every tool call + result in order)
  - totalToolCalls (integer)
  - inputTokens, outputTokens, totalTokens (integers)
  - tokenBudget (integer — budget for this run)
  - errorMessage, errorDetail (text/jsonb)
  - workspaceItemsCreated, workspaceItemsUpdated (integer counters)
  - deliverablesCreated (integer)
  - startedAt, completedAt (timestamps)
  - durationMs (integer)
  - createdAt, updatedAt

### Step 5: Autonomous Execution Service
- [ ] Create `agentExecutionService` with clean interface:
  ```
  interface AgentRunRequest {
    agentId, subaccountId, subaccountAgentId
    runType: 'scheduled' | 'manual' | 'triggered'
    executionMode: 'api'
    workspaceItemId?: string  // if working on a specific board item
    triggerContext?: object
  }
  ```
- [ ] Implement API execution backend:
  1. Load agent config, training data, subaccount config
  2. Load recent workspace entries for this subaccount
  3. If workspaceItemId: load item details, activities, brief
  4. Build system prompt with all context + skill instructions
  5. Build tool definitions from assigned skills
  6. Call Anthropic API
  7. Handle tool-call loop (execute each tool, return results, continue)
  8. Enforce token budget (soft stop: finish current tool, wrap up)
  9. Enforce max tool calls limit
  10. Log everything to agent_runs
  11. Return structured result

### Step 6: Built-in Skill Implementations
- [ ] `web_search` — Tavily API call, returns structured results
- [ ] `read_workspace` — Read recent workspace items + activities for this subaccount
- [ ] `write_workspace` — Add activity entry to a workspace item
- [ ] `trigger_task` — Already exists, adapt for autonomous context (no userId, use agent context)
- [ ] `create_workspace_item` — Create a new board item (agent creating work)
- [ ] `move_workspace_item` — Move item to a different column (e.g. to "review")
- [ ] `add_deliverable` — Attach a deliverable to a workspace item

### Step 7: Scheduling System
- [ ] Create `agentScheduleService` using pg-boss
  - Register cron jobs from subaccount_agents.scheduleCron
  - On fire: create agent_run record, enqueue execution
  - Handle schedule enable/disable
  - Handle schedule updates (unregister old, register new)
- [ ] Add startup hook to register all active schedules on server boot
- [ ] Add API routes for managing schedules

### Step 8: Kanban Board Integration
- [ ] The skills from Step 6 already integrate with the board
- [ ] Ensure agents can:
  - Pick up items assigned to them (read_workspace returns assigned items)
  - Log progress activities as they work
  - Attach deliverables when work is done
  - Move items to "review" when ready for human approval
  - Create new items (orchestrator assigning work)
- [ ] Add agent run reference to workspace_item_activities (agentRunId column)

### Step 9: Activity Page
- [ ] Add `agentActivityService` — query agent_runs + workspace_item_activities scoped by role
- [ ] Add API routes:
  - GET /api/agent-activity — org-scoped (all subaccounts)
  - GET /api/portal/:subaccountId/agent-activity — subaccount-scoped
  - GET /api/system/agent-activity — system-wide (system admin)
- [ ] Return: recent runs with summaries, tool call counts, token usage, items affected

### Step 10: Wire Up & Routes
- [ ] Add agent run routes:
  - POST /api/subaccounts/:id/agents/:agentId/run — manual trigger
  - GET /api/subaccounts/:id/agents/:agentId/runs — run history
  - GET /api/agent-runs/:id — run detail with full tool call log
- [ ] Wire scheduling into server startup
- [ ] Add TAVILY_API_KEY to env schema
- [ ] Generate migration for all schema changes

---

## Verification Plan
- [ ] Manual trigger an agent run against a subaccount with test data
- [ ] Verify tool calls execute correctly (workspace read/write, task trigger)
- [ ] Verify board items get activities and deliverables from agent runs
- [ ] Verify token budget enforcement (soft stop)
- [ ] Verify scheduling creates runs at correct intervals
- [ ] Verify activity page returns correct scoped data
