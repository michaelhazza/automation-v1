# System Agents & Multi-Level Inheritance — Development Spec

## Overview

Introduce a three-tier agent hierarchy: **System > Organisation > Sub-account**, where each level inherits from the one above and can layer on additional prompt content and skills — without exposing the parent level's IP.

```
System Agent (our IP — hidden from org admins)
  ├── masterPrompt (system)
  ├── systemSkills[] (task board skills, hidden from org UI)
  └── modelConfig defaults
        │
        ▼
Org Agent (org admin can customise — hidden from sub-account users)
  ├── additionalPrompt (org-level)
  ├── orgSkills[] (org-created skills)
  └── config overrides (model, temp, tokens)
        │
        ▼
Sub-account Agent (sub-account user experience)
  ├── additionalPrompt (sub-account-level)
  ├── subaccountSkills[] (sub-account-specific)
  └── runtime overrides (schedule, budget, timeout)
```

At execution time, all three layers are **merged** into a single agent context. Each layer's prompt and skills are invisible to layers below.

---

## Current State vs Target State

### What exists today

| Concept | Current implementation |
|---|---|
| `agentTemplates` | System-level library. Org admin "installs" a template, which **copies** it into an `agents` record. No ongoing link. |
| `agents` | Org-level only. Full CRUD by org admins. Contains masterPrompt, skills, model config. |
| `subaccountAgents` | Link table. Copies `defaultSkillSlugs` at link time. Has `customInstructions` field. |
| `skills` | Dual: `organisationId = null` = built-in, else org-custom. Org admins see both. |

### What changes

| Concept | Target implementation |
|---|---|
| `systemAgents` | **New table.** Replaces `agentTemplates` as the authoritative system-level agent definition. Contains system masterPrompt + system skill references. Managed by system admins. |
| `systemSkills` | **New table.** Skills defined at system level (task board interactions, etc). Never exposed in org UI. |
| `agents` | Gains optional `systemAgentId` FK. When linked, inherits system prompt + system skills at runtime. Org admin can add `additionalPrompt` and org-level skills but cannot see/edit the system layer. |
| `subaccountAgents` | Unchanged structurally. `customInstructions` becomes the sub-account additional prompt. Can reference sub-account-level skills. |
| `skills` | Gains `scope` enum: `system` / `organisation` / `subaccount`. System skills hidden from org UI entirely. |

---

## Database Schema Changes

### New: `system_agents` table

```sql
system_agents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(255) NOT NULL,
  slug            VARCHAR(255) NOT NULL UNIQUE,
  description     TEXT,
  icon            VARCHAR(100),
  master_prompt   TEXT NOT NULL,           -- system-level prompt (our IP)
  model_provider  VARCHAR(50) DEFAULT 'anthropic',
  model_id        VARCHAR(100) DEFAULT 'claude-sonnet-4-20250514',
  temperature     DECIMAL(3,2) DEFAULT 0.7,
  max_tokens      INTEGER DEFAULT 4096,
  default_system_skill_slugs  JSONB DEFAULT '[]',  -- references system_skills
  default_org_skill_slugs     JSONB DEFAULT '[]',  -- default org-visible skills
  execution_mode  VARCHAR(20) DEFAULT 'api',        -- api | headless
  is_published    BOOLEAN DEFAULT false,
  version         INTEGER DEFAULT 1,
  status          VARCHAR(20) DEFAULT 'draft',      -- draft | active | inactive
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
)
```

### New: `system_skills` table

```sql
system_skills (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(255) NOT NULL,
  slug            VARCHAR(255) NOT NULL UNIQUE,
  description     TEXT,
  skill_type      VARCHAR(20) DEFAULT 'system',
  definition      JSONB NOT NULL,          -- Anthropic tool schema
  instructions    TEXT,                     -- markdown guidance
  methodology     TEXT,                     -- extended workflow docs
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
)
```

### Modify: `agents` table

```sql
ALTER TABLE agents
  ADD COLUMN system_agent_id    UUID REFERENCES system_agents(id),
  ADD COLUMN additional_prompt  TEXT DEFAULT '',      -- org-layer prompt (appended to system prompt at runtime)
  ADD COLUMN is_system_managed  BOOLEAN DEFAULT false; -- true if created from system agent (limits what org can edit)
```

- When `system_agent_id IS NOT NULL`, the agent inherits from the system agent.
- `master_prompt` on the `agents` table becomes the **org additional prompt** for system-managed agents (rename semantically; or use the new `additional_prompt` column and keep `master_prompt` for org-created-from-scratch agents).
- Org admins **cannot** view or edit the system agent's `master_prompt` or `system_skill_slugs`.

### Modify: `skills` table

```sql
ALTER TABLE skills
  ADD COLUMN scope VARCHAR(20) DEFAULT 'organisation';
  -- Values: 'organisation' (existing behaviour), 'subaccount'
  -- System skills live in system_skills table, not here
```

### Modify: `subaccount_agents` table

No structural changes needed. Existing fields cover the sub-account layer:
- `custom_instructions` → sub-account additional prompt
- `skill_slugs` → sub-account skill selection (org + sub-account scope skills)

Optionally add:
```sql
ALTER TABLE subaccount_agents
  ADD COLUMN subaccount_skill_slugs JSONB DEFAULT '[]'; -- sub-account-only skills
```

---

## Prompt Assembly at Runtime

When an agent executes, the system prompt is assembled by **concatenating all layers**:

```
┌─────────────────────────────────────────┐
│ 1. System Agent masterPrompt            │  ← from system_agents (invisible to org)
│                                         │
│ 2. System Skills instructions           │  ← from system_skills (invisible to org)
│    + methodology                        │
│                                         │
│ 3. Org Agent additionalPrompt           │  ← from agents.additional_prompt (invisible to sub-account)
│                                         │
│ 4. Org Skills instructions              │  ← from skills where scope='organisation'
│    + methodology                        │
│                                         │
│ 5. Sub-account customInstructions       │  ← from subaccount_agents.custom_instructions
│                                         │
│ 6. Sub-account Skills instructions      │  ← from skills where scope='subaccount' or subaccount_skill_slugs
└─────────────────────────────────────────┘
```

Tools array is the **union** of all skill definitions from all three layers.

**Key rule**: Each layer can only see and edit its own prompt/skills. The assembled prompt is only visible in full to system admins (via execution logs).

---

## API Design

### System Admin — System Agents

```
GET    /api/system/agents                      List all system agents
POST   /api/system/agents                      Create system agent
GET    /api/system/agents/:id                  Get system agent (full detail)
PATCH  /api/system/agents/:id                  Update system agent
DELETE /api/system/agents/:id                  Soft delete
POST   /api/system/agents/:id/publish          Publish (makes available to orgs)
POST   /api/system/agents/:id/unpublish        Unpublish
```

### System Admin — System Skills

```
GET    /api/system/skills                      List all system skills
POST   /api/system/skills                      Create system skill
GET    /api/system/skills/:id                  Get system skill
PATCH  /api/system/skills/:id                  Update system skill
DELETE /api/system/skills/:id                  Delete system skill
```

### Org Admin — Agents (modified)

```
GET    /api/agents                             List org agents (includes system-managed agents)
                                               System-managed agents show: name, description, icon,
                                               org additionalPrompt, org skills — NOT system prompt/skills
POST   /api/agents                             Create org-only agent (no system_agent_id)
POST   /api/agents/from-system/:systemAgentId  Create org agent linked to system agent
PATCH  /api/agents/:id                         Update org layer only (additionalPrompt, org skills, model overrides)
                                               Rejects attempts to set masterPrompt on system-managed agents
GET    /api/agents/:id                         Returns agent with system fields redacted if system-managed
```

### Org Admin — Skills (modified)

```
GET    /api/skills                             List org-scope + subaccount-scope skills only
                                               System skills are NEVER returned here
POST   /api/skills                             Create org or subaccount scope skill
```

---

## Frontend Changes

### System Admin — New Pages

**`/system/agents`** — `SystemAgentsPage.tsx`
- Table of all system agents with status, publish toggle
- Create/edit system agent (full masterPrompt editor, system skill selection)

**`/system/skills`** — `SystemSkillsPage.tsx`
- Table of all system skills
- Create/edit system skill (definition, instructions, methodology)

**`/system/agents/:id`** — `SystemAgentEditPage.tsx`
- Full editor: name, description, icon, masterPrompt, model config
- System skill multi-select
- Default org-visible skill selection
- Publish/unpublish toggle
- View which orgs have installed this agent

### Layout.tsx Navigation Update

Add to system admin section:
```
System Admin
  ├── Organisations
  ├── AI Agents        ← NEW
  ├── Agent Skills     ← NEW
  ├── Platform Activity
  ├── Board Templates
  ├── System Admins
  └── Settings
```

### Org Admin — Modified Pages

**`AdminAgentsPage.tsx`** — Add visual indicator for system-managed vs org-created agents:
- System-managed: Show badge, limited edit capabilities
- Org-created: Full edit as today

**`AdminAgentEditPage.tsx`** — Conditional editing:
- If `is_system_managed`:
  - Hide masterPrompt field (or show read-only placeholder: "System prompt managed by platform")
  - Show "Additional Prompt" textarea for org layer
  - Skill selector shows only org-scope skills (system skills hidden)
  - Model config: allow override or lock to system default (configurable per system agent)
- If org-created:
  - Full edit as today (masterPrompt, all skills, model config)

**`AdminSkillsPage.tsx`** — No system skills shown. Only org + subaccount scope.

### Sub-account — No Changes Needed

Sub-account users already see agents via `AgentsPage.tsx` with no edit access to prompt/skills. The `customInstructions` field on `subaccountAgents` already serves as the sub-account additional prompt layer. The three-tier merge happens transparently at execution time.

---

## Migration Strategy

### Phase 1: Schema + System Admin UI

1. Create `system_agents` and `system_skills` tables
2. Migrate existing built-in skills (`organisationId = null`) to `system_skills`
3. Build system admin CRUD pages for system agents and system skills
4. Add nav items to Layout.tsx

### Phase 2: Inheritance Wiring

1. Add `system_agent_id`, `additional_prompt`, `is_system_managed` columns to `agents`
2. Update `agentExecutionService` to assemble prompts from all three layers
3. Update `skillService` to resolve skills from system + org + subaccount layers
4. Build "Install system agent" flow for org admins (replaces template install)

### Phase 3: Org Admin UI Updates

1. Update `AdminAgentEditPage` with conditional editing for system-managed agents
2. Update `AdminAgentsPage` with system-managed badges
3. Filter system skills from org skill listing
4. Add "Browse System Agents" section for org admins to install

### Phase 4: Deprecate `agentTemplates`

1. Migrate any existing `agentTemplates` data to `system_agents`
2. Update `agents.sourceTemplateId` references to `system_agent_id`
3. Remove `agentTemplates` table and related routes/services
4. Clean up frontend template references

---

## IP Protection Model

| Layer | Visible to System Admin | Visible to Org Admin | Visible to Sub-account User |
|---|---|---|---|
| System masterPrompt | Yes | No | No |
| System skills | Yes (full) | No | No (tools available, instructions hidden) |
| Org additionalPrompt | Yes | Yes | No |
| Org skills | Yes | Yes | No |
| Sub-account customInstructions | Yes | Yes | Yes (own sub-account only) |
| Sub-account skills | Yes | Yes | Yes (own sub-account only) |
| Assembled full prompt | Yes (in execution logs) | No | No |

---

## Key Design Decisions

### 1. Separate `system_skills` table vs scope column on `skills`

**Decision: Separate table.**

Rationale: System skills have no `organisationId`, different access patterns, and should never appear in org-scoped queries. A separate table makes it impossible for a query bug to leak system skills to org admins. Clean separation > clever reuse.

### 2. System agent as living link vs one-time copy

**Decision: Living link via `system_agent_id` FK.**

Rationale: When we update a system agent's prompt or skills (bug fixes, improvements), all orgs benefit immediately. The old template model required orgs to manually re-install. Living link = better product, less maintenance. Org admins layer on top; they don't fork.

### 3. What org admins can override on system-managed agents

**Allowed:**
- `additional_prompt` (appended to system prompt)
- Org-level skills (added to tool set)
- Name, description, icon (cosmetic branding)
- Model config (if system agent allows override — controlled by flag on `system_agents`)

**Not allowed:**
- View/edit system `masterPrompt`
- View/edit system skills
- Remove system skills from the agent
- Change `system_agent_id`

### 4. Copy vs inherit for org admins who want full control

Org admins can **copy** a system agent to create an org-only agent (`system_agent_id = null`). This breaks the inheritance link — they get a snapshot of the system prompt (minus system skills) and full edit control. They lose automatic system updates. This is an explicit trade-off the org admin opts into.

The copy flow:
- Creates new `agents` record with `system_agent_id = null`, `is_system_managed = false`
- Copies name, description, icon, model config
- Does NOT copy system `masterPrompt` (that's our IP) — instead provides a generic starter prompt
- Does NOT copy system skills — org admin selects their own

### 5. Execution log visibility

System admins can see the fully assembled prompt in execution logs (for debugging). Org admins see execution logs with the system portion redacted — they see their org prompt, org skills, and the agent's output, but not the system layer content.

---

## Edge Cases

1. **System agent updated after org customisation**: Org's `additional_prompt` and skills remain untouched. System layer updates apply on next execution. No migration needed.

2. **System skill slug conflicts with org skill slug**: System skills live in separate table with separate namespace. At execution time, both are included — no conflict possible since tool names are prefixed or unique by slug.

3. **Org removes a system-managed agent**: Soft delete of the `agents` record. `system_agents` record unaffected. Org can re-install later.

4. **System agent unpublished after org installation**: Existing org agents continue to work (they have the FK). New orgs cannot install. Optionally: system admin can force-deactivate across all orgs.

5. **Sub-account adds skills that overlap with org/system skills**: At execution time, deduplicate by slug. Sub-account skill definition does NOT override system or org skill of same slug — system > org > subaccount precedence.

---

## Estimated Scope

| Phase | Effort | Dependencies |
|---|---|---|
| Phase 1: Schema + System Admin UI | Medium | None |
| Phase 2: Inheritance wiring | Medium-High | Phase 1 |
| Phase 3: Org Admin UI updates | Medium | Phase 2 |
| Phase 4: Template deprecation | Low | Phase 3 |

---

## Files to Create/Modify

### New Files
- `server/db/schema/systemAgents.ts`
- `server/db/schema/systemSkills.ts`
- `server/services/systemAgentService.ts`
- `server/services/systemSkillService.ts`
- `server/routes/systemAgents.ts`
- `server/routes/systemSkills.ts`
- `client/src/pages/SystemAgentsPage.tsx`
- `client/src/pages/SystemAgentEditPage.tsx`
- `client/src/pages/SystemSkillsPage.tsx`
- `client/src/pages/SystemSkillEditPage.tsx`
- `server/db/migrations/XXXX_add_system_agents.ts`

### Modified Files
- `server/db/schema/agents.ts` — add `systemAgentId`, `additionalPrompt`, `isSystemManaged`
- `server/services/agentService.ts` — redact system layer for org queries
- `server/services/agentExecutionService.ts` — three-layer prompt assembly
- `server/services/skillService.ts` — multi-layer skill resolution
- `server/routes/agents.ts` — install-from-system endpoint, redaction logic
- `server/routes/skills.ts` — filter system skills from org responses
- `server/index.ts` — mount new routes
- `client/src/App.tsx` — new system routes
- `client/src/components/Layout.tsx` — new nav items
- `client/src/pages/AdminAgentsPage.tsx` — system-managed badges
- `client/src/pages/AdminAgentEditPage.tsx` — conditional editing
- `client/src/pages/AdminSkillsPage.tsx` — filter system skills
