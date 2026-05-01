# Workflows — Development Brief

_Date: 2026-05-01_
_Status: draft for stakeholder review; pre-spec_
_Branch: `claude/workflows-brainstorm-LSdMm`_
_Mockups: [`prototypes/workflows/`](../prototypes/workflows/index.html)_

---

## Contents

1. [Summary](#1-summary)
2. [Why we're building this](#2-why-were-building-this)
3. [Product positioning — what we are and aren't](#3-product-positioning--what-we-are-and-arent)
4. [Concepts and vocabulary](#4-concepts-and-vocabulary)
5. [Branching, parallel, loops](#5-branching-parallel-loops)
6. [Operator surface — the open task view](#6-operator-surface--the-open-task-view)
7. [Authoring surface — the Studio](#7-authoring-surface--the-studio)
8. [Approvals](#8-approvals)
9. [Files and conversational editing](#9-files-and-conversational-editing)
10. [Integration story](#10-integration-story)
11. [Build punch list](#11-build-punch-list)
12. [Out of scope (V1)](#12-out-of-scope-v1)
13. [Considered and rejected](#13-considered-and-rejected)
14. [Mockup references](#14-mockup-references)
15. [Next steps](#15-next-steps)

---

## 1. Summary

This brief captures the design landed during a single brainstorming session for the Workflows feature in Automation OS. The backend (engine, schema, three system templates, routes) is already built. What we're building now is the **operator-facing surface** for tasks in flight, the **authoring surface** for org workflows, the **simplified step-type vocabulary** users see, and a small set of **schema additions** (approver routing, teams) needed to make the operator UX honest.

The thesis: workflows in Automation OS are **org-chart driven** (work flowing between agents and humans), not **node-graph driven** (Zapier / n8n / Make / GoHighLevel). The atomic unit is an agent with judgement, not an integration node. Workflows orchestrate agents + humans + skills + external automations to produce outcomes that are deterministic, auditable, replayable, and gated where they need to be.

The biggest user-visible changes from what's currently in the codebase:

| # | Change | Why | Type |
|---|---|---|---|
| 1 | **Step types collapsed from 8 to 4 (the four A's: Agent / Action / Ask / Approval)** | The eight engine types (`prompt`, `agent_call`, `user_input`, `approval`, `conditional`, `agent_decision`, `action_call`, `invoke_automation`) overlap and confuse authoring. Four covers every case without losing capability. | Validator update + Studio vocabulary |
| 2 | **"Brief" retired as a UI noun — everything is a Task** | The schema already has one `tasks` table with a nullable `brief` column. The dual naming caused real confusion. One word, one user-visible primitive. | UI rename + nav cleanup |
| 3 | **New operator surface — the open task view** | Models on the existing `AgentChatPage` + brief mockup pattern. 3-panel layout: chat, activity, contextual tabs (Live / Flow / Files). Same surface for ad-hoc and workflow-fired tasks. | New UI |
| 4 | **Studio is admin / power-user surface, not in primary nav** | Most operators describe intent in chat and never open Studio. Studio is for editing workflow templates when the orchestrator's draft isn't quite right. | Nav change |
| 5 | **Approver routing on Approval steps (humans-only)** | Engine currently has no `approver` field — anyone can decide. Need explicit routing (Specific people / A team / Task requester / Org admin) with quorum. | Schema add + UI build |
| 6 | **Teams CRUD page in Org settings** | `teams` + `team_members` tables exist but no UI to create / name / populate teams. Required by the approver picker. | Small UI build |
| 7 | **Conversational editing of files via chat** | Operator asks the agent to refine a draft; agent updates the file as a new version. Human inline editing intentionally out of scope. | Wires into existing file/version system |
| 8 | **Branching as an output property of any producing step, not a step type** | Today's `conditional` and `agent_decision` step types collapse into "any step's output can declare branches". | Validator + Studio inspector |
| 9 | **Loops only on Approval-on-reject** | The only place a workflow goes backward. Handles "review → revise → re-review" without opening the door to general loops. | Validator constraint |
| 10 | **Workflow → workflow nesting disallowed** | Bounded blast radius. Workflow → agent → workflow is allowed (the agent layer breaks the depth count). | Validator constraint |

**What this brief is NOT.** It's not a technical spec. Step-by-step engine internals (replay mechanics, idempotency keys, side-effect classifications, cost reservation, bulk-mode parent/child) live in the existing codebase and the future spec. This brief captures the **product surface and the design decisions** behind it. Everything below is reviewable as one round, then we move to spec.

## 2. Why we're building this

There's a real gap in the product today between two things that both already exist:

1. **Agents improvising in chat.** A user types something in Ask Anything; an agent chains a few skills together and produces a result. Cheap. Flexible. Good for one-off, low-stakes work. **Not good** for: anything that repeats, anything that needs an explicit human approval gate, anything where you need to know exactly which steps ran with which inputs, anything that needs to fan out across many subaccounts in a comparable way, anything that needs deterministic branching.
2. **External automation tools** (n8n, Make, Zapier, GoHighLevel native flows). Mature, huge integration libraries, customers already use them. **Not good** for: anything that needs an agent's intelligence inside a step, anything that needs first-class HITL approval gates, anything multi-tenant with org/subaccount governance, anything where cost / replay / output editing is a first-class concern.

The workflow primitive lives in that gap. It's the **deterministic-orchestration layer for agent-and-human work**. It composes skills + agents + humans + external automations into runs that can be paused, approved, rejected, looped back, replayed, costed, and audited.

The engine for this is already built. What's missing:

- The user-facing surface that lets an operator see and act on a task in flight without needing to understand the engine
- The authoring surface for org-level workflow templates with a vocabulary humans can hold in their heads
- A small set of schema additions (approver routing, teams) needed to make the operator UX honest about who can do what
- A naming and conceptual cleanup so the user isn't navigating between "briefs", "tasks", "playbooks", and "workflow runs" all referring to overlapping things

The cost of NOT building this: agents stay in chat, workflows stay in n8n, and nothing connects. We lose the differentiator — that we orchestrate intelligence + integration + humans in one substrate that knows about all three.

## 3. Product positioning — what we are and aren't

This was the hardest decision in the brainstorm because the temptation to drift toward an n8n-clone is real. The line we held:

**Workflows orchestrate. Automations integrate.**

A workflow's atomic unit is an **agent** with judgement (or a human, or a deterministic Action). An automation's atomic unit (in n8n / Make / Zapier) is a **node** — a function call. These produce different products. We are emphatically the first.

Three things we are not:

| Not | Why |
|---|---|
| **A node-graph drag-and-drop builder** | Visual canvases optimise for "build a flow from a blank canvas". Our dominant pattern is forking and tweaking a system template the orchestrator drafted from natural-language intent. The user rarely starts cold. Drag-and-drop is a mismatch for that flow and immediately commits us to maintaining hundreds of integration nodes. |
| **A 300-integration node library** | Skills are our atomic integration unit. Adding a skill (`slack.message.send`, `ghl.email.send`, `hubspot.deal.update`) doesn't grow the user's authoring surface — it just makes the agent and the Action step more capable. We can ship a large skill catalogue without shipping a single visual node. |
| **A replacement for n8n / Make / Zapier / GHL flows** | If a customer has already built a complex multi-system flow in their tool of choice, we just trigger it via the `invoke_automation` Action. We don't try to import it, replicate it, or compete with it. The line: one external API call → skill (we ship it). Multi-step external orchestration the customer already built → automation (they keep it). |

What we **are**:

- The orchestration layer where intelligence (agents), humans (approvers), structured data (skills), and external automation engines compose into one auditable run
- The first-class home for HITL approval gates, replay, side-effect classification, multi-tenant cost control, and bulk fan-out — none of which exist natively in node-graph tools
- The only place where the same `slack.message.send` skill can be called by an agent in chat AND by a workflow step, with one shared catalogue and one mental model
- A surface where the operator never has to think about step types, skills, or workflow internals — they describe what they want, and the orchestrator decides whether to do it once or set it up to repeat

The discipline that keeps us off n8n's turf:

- Step type count stays tight (the four A's). If we ever have 12+, we've drifted.
- The Studio is admin / power-user only. Operators don't open it; they describe intent in chat.
- We don't ship integration "nodes" — we ship skills, which are function calls.
- `invoke_automation` is reserved for genuinely complex customer-built external flows. It is not the default for "send a Slack message".

## 4. Concepts and vocabulary

### 4.1 The four user-visible primitives

The operator's mental model is intentionally small. Four things only:

| Primitive | What it is | Example |
|---|---|---|
| **Task** | A unit of work in flight. Has agents, status, activity log, files. The user-visible thing. | "Acme renewal proposal" |
| **Workflow** | A saved task template — a reusable shape of work. Fired manually, by a schedule, or by an agent. Each firing creates a Task. | "Weekly Lead Re-engagement" |
| **Schedule** | A cron rule. Fires either an agent (one-off task, no template) or a workflow (templated task) on a cadence. | "Every Monday at 9am" |
| **Agent** | An entity with persona, skills, and memory that does work — either inside a task directly or as a step inside a workflow. | "Copywriter" |

Things the operator does **not** see as separate concepts (they're engine vocabulary):

- **Skills** — invisible inside Agent steps (the agent picks them); only surfaced when an author explicitly chooses an Action step type
- **Step runs**, **template versions**, **invalidation**, **side-effect classes**, **idempotency keys**, **bulk run modes** — all engine internals
- **Briefs** — retired as a UI noun. Same row in the `tasks` table

The orchestrator (Ask Anything) is the surface that bridges natural-language intent to these primitives. If the operator says *"do this once"*, it runs an agent. If they say *"set this up to run every Monday"*, it offers to draft a workflow + a schedule, hands them to Studio for review, and publishes. The operator never needs to say the word "workflow" to get one.

### 4.2 The four A's — step types

The engine supports eight step types today (`prompt`, `agent_call`, `user_input`, `approval`, `conditional`, `agent_decision`, `action_call`, `invoke_automation`). They overlap. They confuse authoring. They collapse cleanly to four user-visible categories — **the four A's**:

| Step type | What it is | Maps to engine | Author picks a skill? |
|---|---|---|---|
| **Agent** | Hand the work to an agent with a free-form instruction. The agent picks skills at runtime. | `agent_call` + `prompt` (an inline ad-hoc agent) | No |
| **Action** | Do one specific deterministic thing — call one skill OR fire one external automation. | `action_call` + `invoke_automation` | Yes — that's the point of an Action step |
| **Ask** | Pause and ask a human for input via a form. | `user_input` | No (author writes the form schema) |
| **Approval** | Pause for a human yes/no gate. Optionally route back to a previous step on reject. | `approval` | No (author picks approvers — humans only) |

Branching is **not** a step type. It's an output property of any step that produces a value (Section 5).

The mapping above means **no engine changes are needed for the taxonomy migration** — the validator and the Studio inspector accept the four A's as user-visible names; internally they still emit the existing engine step-type strings. Existing system templates (`event-creation.workflow.ts`, `weekly-digest.workflow.ts`, `intelligence-briefing.workflow.ts`) keep working as-is.

### 4.3 How agents and workflows compose

Agents and workflows are **peers**, not a hierarchy. They compose freely in both directions, with one hard rule.

```
Trigger ──► Agent ──► Skill
Trigger ──► Workflow ──► Skill
Trigger ──► Workflow ──► Agent ──► Skill
Trigger ──► Agent ──► Workflow ──► Skill
                              └──► Agent ──► Skill
Workflow ──► invoke_automation ──► (external n8n / Make / Zapier / GHL flow)
```

- **Workflow → Agent** (`agent_call` step, already in the schema). The workflow is the boss; the agent handles one specific intelligent step.
- **Agent → Workflow** (an agent calls `workflow.run.start` as a skill). The agent is the boss; it fires a workflow because the request matches a saved template. The orchestrator agent in Ask Anything is the dominant case.

The hard rule: **no direct workflow → workflow nesting**. Max depth = 1. If a workflow needs to invoke another workflow, the path is workflow → agent → workflow (the agent layer breaks the depth count). This is a deliberate guardrail against runaway recursion and unbounded blast radius. Already enforced today; we're keeping it.

The corollary that makes the operator surface tractable: **a Task is always one row**, regardless of how it was started. An ad-hoc Ask-Anything task and a workflow-fired task render in the same open-task view. The "shape" of the work (Section 6.2) might differ — a workflow-fired task has a clear step DAG; an ad-hoc task has an agent delegation tree — but the surface is unified.



## 5. Branching, parallel, loops

## 6. Operator surface — the open task view

### 6.1 Layout

### 6.2 The four right-panel tabs

### 6.3 What changed from prior brief work

## 7. Authoring surface — the Studio

## 8. Approvals

## 9. Files and conversational editing

## 10. Integration story

## 11. Build punch list

## 12. Out of scope (V1)

## 13. Considered and rejected

## 14. Mockup references

## 15. Next steps
