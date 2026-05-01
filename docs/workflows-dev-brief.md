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

These three are the only "control flow" primitives in the workflow vocabulary. Each was chosen against a real scenario (lead re-engagement, event-creation, customer onboarding, support ticket triage, six-week campaign) to confirm it covers the actual cases.

### 5.1 Branching — output property of any step

Branching is **not** a step type. It's a property of any step that produces a value. Author specifies: *"on output `X` is `Y`, go to step `Z`"*.

This works the same across all four A's:

| Step type | What you can branch on |
|---|---|
| **Agent** | Any field the agent returned (e.g., classification result `tier = hot`/`cold`) |
| **Action** | Success / failure, returned status code, any field from the response |
| **Ask** | Any form-field value the human entered |
| **Approval** | `approved` / `rejected` (and on reject, optionally route back — see loops) |

Default is linear (continue to the next step). Branching is opt-in. Visualised on the canvas as a small "Branch on `field`" chip below the producing step, with branch labels on each path.

### 5.2 Parallel — fan-out, fan-in only

Real workflows need parallel work. The `event-creation` system template already has it (hero copy + email both depend on positioning, run in parallel). A six-week campaign has multiple parallel workstreams.

Two patterns allowed:

- **Fan-out**: a step has multiple "next" arrows; the engine dispatches the targets in parallel
- **Fan-in**: multiple steps converge into one "next"; the engine waits for all upstream to complete

What's NOT allowed: deeply nested parallel sub-graphs. The shape stays flat enough to read on the canvas.

Any of the four A's can be a parallel leg. An Approval step can fan out to multiple approvers (different from quorum — that's multiple approvers on the same step). Multiple Agent steps can run in parallel after a single Ask.

### 5.3 Loops — only Approval-on-reject

The only place a workflow can go backward. An Approval step's "on reject" can route to a previous step ("reviewer rejects → back to copywriter for revision").

This handles ~95% of the real loop cases (review → revise → re-review). Other "loops" are engine-level, not user-visible:

- **Action retry on failure** — handled by `retryPolicy`, not a workflow shape the user designs
- **Agent re-think mid-step** — handled inside the agent's own logic, not a workflow construct
- **General `while` loops** — explicitly disallowed. Removes a whole class of authoring footguns.

Visualised on the canvas as a dashed orange line going backward from the Approval step to the route-back target, with an arrowhead and an "ON REJECT" label.

## 6. Operator surface — the open task view

This is the most important screen in the product. It's where 95% of operator time is spent. Mockup: [`prototypes/workflows/07-open-task-three-panel.html`](../prototypes/workflows/07-open-task-three-panel.html).

### 6.1 Layout

Full-width, three columns:

| Column | Width | Purpose |
|---|---|---|
| **Chat** | 26% | Narrative — agent updates, user notes, handoff messages, the human-readable story of the task |
| **Activity** (collapsible) | 22% expanded · 36px minimised | Live event log — every event with timestamp + actor + linked-entity chips. Click the chevron to minimise; click the minimised strip to expand |
| **Right panel — tabs** | 52% (when activity expanded) · ~74% (when activity minimised) | Visual context — Live / Flow / Files |

The Activity column is collapsible because for some tasks (long-running, mostly observed) the operator wants the maximum room for the right panel. For others (active multi-agent collaboration, debugging) they want to see chat + activity + visual all at once.

### 6.2 The four right-panel tabs

Sharply distinct purposes — each tab answers one question:

| Tab | Question it answers | Content |
|---|---|---|
| **Live** | *Who is doing what RIGHT NOW?* | Org chart of agents involved in this task with status dots (done / working / waiting). The "snapshot of current state" view. Best for multi-agent tasks. |
| **Flow** | *What's the SHAPE of this work?* | The planned route. For a workflow-fired task: the step DAG with the four A's. For an ad-hoc task: the orchestrator's plan (e.g., "Sales drafts → Research adds pricing → Approval → Send"). Where we are in the sequence and what's coming next. |
| **Activity** | *What HAPPENED?* | Chronological event log (Activity is also the dedicated left-of-right-panel column when expanded; the Activity tab shows the full version). View / Edit chips on every linked entity (CRM records, docs, rules, memory blocks). |
| **Files** | *What was PRODUCED?* | Top thumbnail strip (one card per file with icon, type badge, orientation) + reader pane below. Click any thumbnail to load it in the reader. Document toolbar (download, open in new window) sticky at the top. Portrait files render at A4-like proportions; landscape files render at 16:9-like proportions. |

The Activity column on the left and the Activity tab on the right show the same data. Why both? Because the column is always visible (when expanded) and gives a glanceable feed; the tab gives a fuller, scrollable history if the user wants to dig in. They're not duplicates of *purpose* — they're two density levels of the same source.

### 6.3 What changed from prior brief work

The mockup builds on `prototypes/brief-endtoend.html` (the existing brief surface) and the live `client/src/pages/AgentChatPage.tsx`. The visual language (org chart with status dots, activity feed with View/Edit chips on linked entities, ref-chip styling) is preserved exactly.

Three meaningful changes from the brief mockup:

1. **Three columns instead of two**, with Activity broken out from the right panel into its own collapsible column. Lets the operator see chat + activity + visual context simultaneously.
2. **Tabs in the right panel** with sharply distinct purposes (Live / Flow / Files). Files is new (the brief mockup didn't have a file viewer).
3. **"Brief" retired as a noun.** The breadcrumb is now `Tasks › Acme renewal proposal`, not `Briefs › Acme renewal proposal`. Same data, one user-facing concept.

The 3-panel layout is denser than the brief — the user explicitly named this trade-off ("your UI is a little bit busy"). The collapsible activity column is the release valve when density gets in the way.



## 7. Authoring surface — the Studio

The Studio is where org admins / power users edit the structure of a workflow template. Mockups: [`prototypes/workflows/04-four-as-step-types.html`](../prototypes/workflows/04-four-as-step-types.html) (the four A's per-step inspectors) and [`prototypes/workflows/05-studio-route-editor.html`](../prototypes/workflows/05-studio-route-editor.html) (the canvas + inspector).

### 7.1 Where it lives

**Admin / power-user nav. Not in the operator's primary nav.** Most operators describe what they want in chat, the orchestrator drafts the workflow, they approve, and the workflow runs. They never open the Studio.

The path to Studio is typically:

- From a Task: "edit the workflow template that fired this task"
- From the Workflows library (admin nav): browse templates, click one to edit
- From the orchestrator handoff: "I drafted a workflow for this — review and publish?"

If the Studio becomes the operator's primary entry point, we've drifted. The orchestrator must remain the dominant creator of workflows.

### 7.2 Layout — canvas-first with chat as a docked tool

Hard-learned design lesson from the brainstorm: **chat-first authoring (where the user types instructions and the agent updates the canvas) felt like Zapier with a chat overlay**. We rejected three iterations of that direction. The canvas-first pattern that landed:

| Element | Behaviour |
|---|---|
| **Canvas** | The whole working surface. Vertical step cards, branching shown as forks, parallel as side-by-side. Click a step to edit; hover a connector to insert. Direct manipulation handles 80% of edits — rename, swap a skill, change an approver, delete a step. |
| **Inspector** (slide-out) | Opens on the right when you click a step. Shows fields specific to that step type (see 7.3). Closes when you click empty canvas. One side panel at a time — no permanent multi-pane chrome. |
| **Chat (Studio agent)** | Docked pill bottom-left of the canvas. Click or `⌘K` to expand into a left side-panel. Used for big restructures: *"add an approval before every irreversible step"*, *"split this into hot/cold paths after the classify step"*. The agent proposes a diff card; the user clicks Apply or Discard. No silent edits. |
| **Bottom action bar** | Floating pill, centered on the canvas. Shows validation status (`1 issue` / `All checks pass`), estimated cost per run, and the single primary action (`Publish v4`). |

### 7.3 The four A's inspectors

When a step is selected, the inspector shows fields specific to that step type. From mock 04:

- **Agent** — Name, agent reference (picks from system / org agents), free-form instruction textarea, optional branching on output (e.g., `tier → hot/cold`), side-effect class
- **Action** — Name, type radio (Skill / External automation), the picked skill or automation, input fields (templated from previous step outputs), on-failure routing, side-effect class (defaults to whatever the skill declared)
- **Ask** — Name, prompt to user, form schema (named fields with types and required flags), who can submit (Task requester / anyone in org / specific people / a team), optional auto-fill from last completed run
- **Approval** — Name, what approvers see (which step outputs to render to the reviewer), approver routing (humans-only — see Section 8), quorum (N approvers required), if-approved routing, if-rejected routing (with the loop-back option)

### 7.4 Publishing

Org workflow templates are versioned via `workflow_template_versions`. Publishing creates a new immutable version. Tasks already running on the previous version continue on that version (they were locked to `templateVersionId` at start). The next firing uses the new version.

The bottom-bar primary action says `Publish vN` (e.g., `Publish v4`). The current published version is shown in the page header (`Forked from system / lead-reengagement v3 · saved 14s ago`). No GitHub PR involved for org templates — that's only the system-template authoring flow.

A small open question for the spec: should publishing prompt for a version note / changelog? Schema has room. Could be a one-line input on the publish modal. Worth deciding before build.

## 8. Approvals

Approvals are how a workflow gates a human decision before something irreversible. Currently the engine has the step type (`approval`) and the review-recording table (`workflow_step_reviews`) but **no approver routing**. Anyone with access can decide. We need to add the routing.

### 8.1 Humans-only

Approvals are human-only by design.

The reasoning: the whole point of an Approval step is human oversight before something irreversible. If an agent is signing off, that's just another LLM call — it doesn't add the trust layer that approvals exist for. "Agent reviews before send" is a real pattern, but it's structurally an **Agent step that returns yes/no** with the next step **branching** on its output. Same outcome, cleaner semantics.

This keeps the four A's clean: Approval = human gate. Agent = anything an agent does, including review.

### 8.2 The approver picker

Four options, mapped to existing schema where possible:

| Option | Maps to | Notes |
|---|---|---|
| **Specific people** | `users` table; multi-select | Pick one or more named users. Engine accepts the union — any of them can decide (or all, if quorum > 1). |
| **A team** | `teams` + `team_members` tables (already in schema) | Pick a team; anyone in the team can decide. Requires building the team CRUD page in Org settings (see 8.4). |
| **Task requester** | `tasks.created_by_user_id` | Whoever started the task. The most common case for "I want to review this myself" workflows. |
| **Org admin** | Existing role check | Anyone with the `org_admin` role. Catch-all for compliance-shaped flows. |

Plus a **quorum** field — number of approvers required (default 1). The engine waits until N approvals have come in before continuing. If quorum > approvers-pool-size, the validator rejects at publish time.

### 8.3 Engine changes required

Currently the `approval` step type only has `approvalPrompt` and `approvalSchema`. We need to add:

```ts
approverGroup: {
  kind: 'specific_users' | 'team' | 'task_requester' | 'org_admin';
  userIds?: string[];        // when kind = specific_users
  teamId?: string;           // when kind = team
}
quorum: number;              // default 1
```

Plus engine enforcement: when an approval decision is submitted, check the deciding user is in the allowed pool; reject with 403 otherwise. Currently any authenticated user can decide on any approval — that's a real bug we need to fix as part of this work.

### 8.4 Team management page

Schema for teams exists; UI doesn't. The existing `SubaccountTeamPage` is about subaccount *members with permission sets*, not team groupings. We need a small Org-settings page:

- List teams (name, member count, created date)
- Create team (name, description)
- Add / remove members
- Rename team
- Soft-delete (uses existing `deletedAt` column)

Estimated half a day. Required for the team-based approver picker to be usable.

## 9. Files and conversational editing

Files are the artifacts a task produces — drafted documents, gathered data, fetched references, slide decks. The Files tab in the open task view is where the operator sees and acts on them.

### 9.1 The Files tab

Two parts (mock 07 Files state):

- **Top thumbnail strip** — one card per file with icon (color-coded by type / author), document orientation (portrait or landscape), file extension badge (`DOC` / `CSV` / `XLS` / `PDF` / `PPT`), and the file name. Horizontally scrollable. A subtle vertical divider separates files **produced by the task** (drafts, analyses, annexes) from **fetched references** (external rate cards, regulatory docs, anything the agent pulled in for context).
- **Reader pane below** — full panel width. A4-like proportions for portrait files, 16:9-like for landscape. Document toolbar sticky at the top showing the current file's name + meta (DOC · 2 pages · Head of Sales · 28s ago) and two icon actions: **Download** and **Open in new window**. Click any thumbnail to swap the reader content.

### 9.2 Conversational editing — in scope

The operator can ask the agent to refine a file via the chat panel:

> *"Make the proposal body more concise — cut the section on competitor positioning by half."*

The agent reads the current file, makes the requested change, and commits it as a new version. The version history is preserved (the file is `referenceDocuments` / `executionFiles` — versioned in schema). The reader pane updates to show the latest version. Earlier versions remain accessible via a version dropdown on the document toolbar (small UI add — not heavy).

This is the only editing path for the operator. Rationale:

- **Audit trail preserved.** Every change has a who/what/when (the agent did X because the user asked Y at time Z).
- **No undoing the agent's work.** If the agent made a mistake, the operator describes the fix; the agent does it; the audit log captures both.
- **Same primitive for refining and re-drafting.** "Make this concise", "rewrite this section in a more formal tone", "add a paragraph about Q4 expansion plans" — all the same path.

### 9.3 Inline human editing — out of scope (V1)

The operator cannot click into the reader paper and type directly. Reasoning:

- Inline editing breaks the "produced by agents, audited end-to-end" story unless every keystroke is logged
- The Download action gives the operator an escape hatch if they truly need to edit locally
- Most editing requests are conceptual ("make this shorter", "change the tone") — a single chat message accomplishes more than ten minutes of inline editing
- If demand emerges in production, we can add it later; out of scope is reversible

### 9.4 What this enables

A typical interaction loop on the Files tab:

1. Operator opens the task, clicks Files
2. Sees the proposal draft in the reader pane
3. Reads through, doesn't like one section
4. Switches to the Chat panel: *"the section about pricing is too long — cut it to one paragraph"*
5. Agent updates the file as a new version
6. Reader pane shows the updated draft
7. Operator approves the workflow's next step

Compared to chat-only file refinement (where the operator never sees the file), this loop preserves the *I am reading what was produced and asking for what I want* feel of editing, without the audit risks of direct editing.

## 10. Integration story

The biggest single source of confusion in the brainstorm was where integrations live. Restating the answer cleanly:

### 10.1 Three layers, not two

| Layer | What it is | Built by | Used by |
|---|---|---|---|
| **Skills / Actions** | First-party integration primitives — one external call each. Atomic. | Us, shipped with the platform | Agents (in chat) AND workflow Action steps |
| **Workflows** | Orchestration of skills + agents + approvals + conditionals. | Customer (org), via Studio handoff from orchestrator | Subaccount runs (i.e., Tasks) |
| **Automations** | Customer's existing multi-step external flows. | Customer, in n8n / Make / Zapier / GHL | Workflows, via the `invoke_automation` Action when needed |

### 10.2 Skills are the universal vocabulary

The same `slack.message.send` skill that an agent calls in chat is the same skill a workflow Action step calls. One catalogue, used everywhere. This is what prevents us from becoming n8n — agents and workflows speak the same integration language. No "node library" vs "tool library" split. Adding a skill grows what both can do; it doesn't grow the user's authoring surface.

The skill catalogue can (and should) be hundreds of items deep. Slack, GHL, HubSpot, Mailchimp, Stripe, Salesforce, Gmail, Calendar, Sheets, etc. The number of *step types* the user picks from stays at four; the number of *skills the agent can use* is unbounded.

### 10.3 The line — when to use what

Test for any given integration request:

| Request shape | Answer |
|---|---|
| One external API call (send Slack message, create HubSpot contact, push row to Sheets) | **Skill** — we ship it. Used by agents and Action steps. Never `invoke_automation`. |
| Sequence of API calls with intelligence and humans in it | **Workflow** — composes skills + agents + approvals + Actions |
| Sequence of external API calls the customer already built somewhere else | **Automation** — invoked from a workflow Action step via `invoke_automation`. Reserved for: (a) pre-existing customer flows, (b) long-tail integrations we don't ship a skill for, (c) customers who prefer their own tool for orchestration |

The discipline: we never add a "Slack node", "HubSpot node", "Salesforce node". Those are skills. What we never reimplement is the customer's *existing multi-step orchestration in their tool of choice* — that gets `invoke_automation`.

### 10.4 The two shapes of workflow already in production

The cross-check from the brainstorm: two shapes already exist in the three system templates and they tell us this design is right.

| Template | Shape | Step distribution | What this tells us |
|---|---|---|---|
| `event-creation.workflow.ts` | Org-chart handoff | 4 of 6 steps are agent calls | The "creative" workflow shape is naturally agent-driven. This is the dominant pattern operators will write. |
| `weekly-digest.workflow.ts` | Data pipeline | 0 agent calls; 3 action_calls + 1 prompt | Some flows are genuinely deterministic plumbing. Forcing them through agents adds LLM cost for no value. |
| `intelligence-briefing.workflow.ts` | Mostly data pipeline | 1 agent call (research), 3 action_calls, 1 prompt | Sits between the two — pipeline with one agent leg for judgement. |

Implication: both shapes need to keep working. The Studio supports both. The four A's vocabulary covers both. The data-pipeline shape is mostly a system-template / admin authoring concern (operators rarely need to write these). The org-chart handoff shape is what the orchestrator drafts when an operator says *"set up something to repeat that does X, Y, then Z"*.

## 11. Build punch list

Grouped by surface so it maps cleanly to spec sections later. Effort estimates are rough order-of-magnitude.

### 11.1 Engine / schema

| # | Item | Why | Effort |
|---|---|---|---|
| 1 | Add `approverGroup` (kind + userIds/teamId) and `quorum` fields to the `approval` step type | Currently no approver routing — anyone can decide. Required for the Approval inspector + the operator's "you can't approve this" gate. | ~1-2 days (schema + validator + engine enforcement + tests) |
| 2 | Step-type validator: collapse user-visible vocabulary to the four A's | The eight engine types still exist; the validator + Studio inspector need to accept the four A's as the user-facing names and map to engine internals | ~1 day |
| 3 | Branching as an output property of any step (replaces `conditional` and `agent_decision` step types in the user vocabulary) | Cleans up the vocabulary; engine already supports this conceptually — formalise the validator rule | ~half day |
| 4 | Loop validator: only Approval-on-reject can route backward | Engine constraint enforcement | ~half day |
| 5 | Workflow → workflow nesting check | Already enforced today (max depth 1); confirm the validator catches the cross-workflow case | ~few hours |

### 11.2 New UI

| # | Item | Mockup | Effort |
|---|---|---|---|
| 6 | Open task view (3-panel: chat / activity / tabs) | [`07-open-task-three-panel.html`](../prototypes/workflows/07-open-task-three-panel.html) | ~5-7 days |
| 7 | Studio canvas + inspector (the four A's) | [`05-studio-route-editor.html`](../prototypes/workflows/05-studio-route-editor.html) and [`04-four-as-step-types.html`](../prototypes/workflows/04-four-as-step-types.html) | ~7-10 days |
| 8 | Studio chat panel (docked, agent diffs) | [`03-studio-chat-active.html`](../prototypes/workflows/03-studio-chat-active.html) for the diff-card pattern | ~3-5 days |
| 9 | Files tab — top thumbnail strip + reader pane + document toolbar | Inside [`07-open-task-three-panel.html`](../prototypes/workflows/07-open-task-three-panel.html) (Files tab state) | ~3 days |
| 10 | Approver picker UI (specific people / team / requester / org admin + quorum) | Inside [`04-four-as-step-types.html`](../prototypes/workflows/04-four-as-step-types.html) (Approval state) | ~1-2 days |
| 11 | Team management page in Org settings | Not mocked — small CRUD | ~half day |
| 12 | Workflow library page (admin-only) | [`riley-observations/08-workflows-library.html`](../prototypes/riley-observations/08-workflows-library.html) needs refresh for the four A's | ~2 days |
| 13 | Document toolbar with download + open-in-new-window | Inside the Files tab | included in #9 |

### 11.3 Orchestrator changes

| # | Item | Why | Effort |
|---|---|---|---|
| 14 | Ask Anything → "do once vs set up to repeat" prompt | Replaces auto-detection of workflow-shape. User picks. | ~1-2 days |
| 15 | Studio handoff card (orchestrator drafts → user reviews) | The bridge from intent to authored workflow | ~2-3 days |
| 16 | Workflow-as-tool for agents (`workflow.run.start` skill) | Lets any agent fire a saved workflow when intent matches | ~1 day |

### 11.4 Conversational editing

| # | Item | Why | Effort |
|---|---|---|---|
| 17 | Agent skill: "edit this file" — read current version, apply requested change, commit as new version | Operator → chat → agent updates file → reader pane refreshes | ~2-3 days |
| 18 | Version dropdown on the document toolbar | Surface earlier versions of edited files | ~1 day |

### 11.5 Naming cleanup

| # | Item | Why | Effort |
|---|---|---|---|
| 19 | Retire "Brief" as a UI noun — rename Briefs nav to Tasks | One user-visible primitive. Schema unchanged. | ~half day (mostly find-and-replace + nav update) |
| 20 | NewBriefModal renamed → NewTaskModal | Same rationale | ~few hours |

**Rough total:** ~6-8 weeks of UI build + ~1-2 weeks engine / schema + ~1 week orchestrator + ~half week cleanup = **~9-12 weeks for V1**, parallelisable across UI and engine workstreams.

## 12. Out of scope (V1)

Things we explicitly chose to defer. Each is reversible — we can add later if demand emerges.

| Item | Why deferred | When to revisit |
|---|---|---|
| **Visual node-graph drag-and-drop builder** | Mismatch with our positioning. Operators don't start from blank canvas — they fork system templates. | Never — this is a permanent stance, not a deferral. |
| **Inline human editing of files** | Breaks the audit story; conversational editing covers ~all real cases. Download is the escape hatch. | If customers explicitly ask for offline editing AND demonstrate the audit cost is acceptable. |
| **Webhook triggers** (workflow fires on external event) | Schedule + manual trigger + Ask Anything cover V1. Webhooks add a real surface (registration, secrets, replay, idempotency on inbound). | Phase 2, when we have a concrete customer pull. |
| **Workflow → workflow direct nesting** | Bounded blast radius. Workflow → agent → workflow remains allowed. | Probably never as a direct nesting; the agent-layer indirection is the right shape. |
| **Mid-run output editing in the operator UI** | Engine supports it (output-hash firewall, step invalidation) but exposing it requires conflict-resolution UX. Keep engine capability, hide from operator. | Phase 2 if we hit cases where re-running the whole task is too expensive. |
| **"Promote to workflow" from agent run history** ("you've done this 3 times — want to save it?") | Powerful pattern but speculative. Better to ship the orchestrator-driven creation path first and learn from usage. | Phase 2, informed by real telemetry. |
| **Visual diff between published versions** | Useful but not blocking. Inspector's "View raw" + a future text diff covers the audit need. | Phase 2 when version churn becomes a pain point. |
| **General `while` loops or do-until** | Removes a footgun class. Approval-on-reject + Action retry policy cover the legitimate cases. | Probably never — too much rope. |
| **Multi-agent reviewer-style approval** (agent + human collectively decide) | Conflates "agent review" with "human approval". The cleaner path is Agent step (returns yes/no) → branch → Approval step (human gate). | Probably never — the existing primitives compose to handle this. |
| **Workflow templates with input parameter UI** (the `paramsJson` field on `workflow_templates`) | Schema supports it; UI doesn't. Most V1 workflows can use Ask steps to gather input at runtime instead. | Phase 2 once we have workflows with frequent param variations across runs. |
| **Cost dashboards** (per-workflow, per-template trends) | Per-run cost is on the open task view. Aggregate cost monitoring is a different surface. | Phase 2 when ops-cost surfaces become a customer ask. |
| **Run-history search** (find all runs of workflow X across subaccounts in date range) | Workflow runs library exists per-subaccount. Cross-subaccount search is admin tooling. | Phase 2 / admin-only later. |

## 13. Considered and rejected

These were genuine design directions explored in the brainstorm and then ruled out. Documenting so we don't relitigate.

| Idea | Why rejected |
|---|---|
| **Wrap n8n on the backend, expose our UX on top** | n8n has no native concept of an agent (with persona / skills / memory / budget). HITL approval is webhook hacks, not first-class. Cost is platform-billing-level, not per-tenant-per-run. Side-effect classification, replay, output editing — none of it. Three-tier distribution doesn't map. We'd end up writing a translation layer for our entire data model into n8n's, then maintaining both. Easier to keep the engine we already built. |
| **Visual drag-and-drop authoring (n8n-style)** | Optimises for "build from blank canvas" — the wrong primary verb for our product. Our dominant verb is "review what the orchestrator drafted". Visual canvas commits us to maintaining hundreds of integration nodes in perpetuity. The Studio canvas we landed on (mock 05) is *not* drag-and-drop — it's a vertical-list editor with hover-to-insert and click-to-edit. Different product category. |
| **Chat-driven authoring as the primary surface** (mocks 01-03) | Three iterations rejected as too busy / too verbose / too slow for refinement. Chat is great for "scaffold a workflow from natural language" and "do a big restructure". Chat is bad for "rename this step", "swap the approver", "delete a step" — those are clicks, not sentences. Final design: canvas-first with chat as a docked power tool (mock 05's pattern). |
| **Brief vs Task as separate concepts** | Confirmed via schema check — there is no `briefs` table, just `tasks` with a nullable `brief` text column. The dual naming was historical legacy. One word. |
| **Auto-detection of "workflow-shaped intent"** | Was the original orchestrator design — *"if the user describes something with HITL gates and recurrence, automatically draft a workflow"*. Rejected: high false-positive risk creates confusing handoffs. Replaced with explicit prompt: *"do once, or set up to repeat?"* User picks. Removes a whole class of detection failure modes. |
| **Workflow → workflow direct nesting** | Bounded blast radius. Workflow → agent → workflow remains allowed via the agent layer. The indirection is a feature, not a friction — it's where safety enforcement and composition decisions can live. |
| **Inline file editing by humans** | Breaks the audit story (every keystroke would need logging). Conversational editing covers the real cases. Download is the escape hatch for the rare offline-edit case. |
| **Skills as a separate user-visible concept** | Skills appear ONLY inside Action steps when the author explicitly picks one. They never appear in Agent steps (the agent picks them at runtime). Hiding skills from the broader user surface keeps the cognitive load on the four A's. |
| **Approval that an agent can resolve** | Conflates "agent review" with "human gate". An agent reviewer is an Agent step that returns yes/no with a branch. An Approval step is a human gate. Keeping them distinct keeps the trust semantics clean. |
| **Activity as a tab inside the right panel** (mock 06) | Tested as the alternative to mock 07's three-panel layout. Worked but lost the "see chat + activity + visual context all at once" feel. Mock 07 (3-panel with collapsible activity) ended up the master direction. Mock 06 deleted. |
| **Drawn dashed reject loop arrow on the canvas in mock 05** | Three implementation attempts couldn't reliably draw a connecting line across grid-row boundaries. Final approach uses an SVG with explicit pixel coords inside a `position:relative` wrapper. If still fragile in practice, we drop the visual and rely on the Studio inspector's "If rejected → loop back to step 4" text. The intent is unambiguous in the spec regardless. |
| **A "promote agent run to workflow" feature** | Speculative. Better to ship orchestrator-driven workflow creation first and see whether real usage signals a need for promotion. Deferred to Phase 2 (see Section 12). |
| **Editing existing engine schema for the four A's collapse** | Not needed. The validator + Studio inspector accept the four A's as user-facing names; internally they emit the existing engine step-type strings. Existing system templates and runs keep working. The taxonomy migration is a UI / validator change, not a runtime change. |

## 14. Mockup references

All mockups live in [`prototypes/workflows/`](../prototypes/workflows/index.html). Open the index for the full set with descriptions; the table below is the canonical reference for what each mockup is for.

### 14.1 Master mockups (V1 build)

| # | Mockup | Purpose | Section refs |
|---|---|---|---|
| 04 | [Four A's per-step inspector showcase](../prototypes/workflows/04-four-as-step-types.html) | The visual language. Click each of the four state buttons to see how Agent / Action / Ask / Approval render in a workflow with the inspector showing fields specific to that step type. | §4.2, §7.3 |
| 05 | [Studio — route editor](../prototypes/workflows/05-studio-route-editor.html) | Canvas-first authoring. The four A's, branching as inline chips, parallel rendered as fork, Approval-on-reject as a dashed back-arrow. Inspector slide-out for the selected step. Floating bottom action bar with `Publish vN`. Chat as a docked pill bottom-left. | §7 |
| 07 | [Open task view — 3-panel master](../prototypes/workflows/07-open-task-three-panel.html) | The operator surface. 26% chat / 22% activity (collapsible) / 52% tabs. Tabs: Live (org chart) / Flow (planned route) / Files (top thumbnail strip + reader pane with portrait + landscape support, document toolbar with download + open-in-new-window). | §6, §9 |

### 14.2 Reference mockups (already in the repo, used for context)

| Mockup | Why it's relevant |
|---|---|
| [`prototypes/brief-endtoend.html`](../prototypes/brief-endtoend.html) | The existing brief / task surface. Mock 07's three-panel layout builds on this. Status colours, activity-feed format, and ref-chip styling are preserved. |
| [`prototypes/riley-observations/05-workflow-studio-step-picker.html`](../prototypes/riley-observations/05-workflow-studio-step-picker.html) | Earlier step picker pattern. Will need a refresh for the four A's vocabulary (currently shows the older taxonomy). |
| [`prototypes/riley-observations/06-automation-picker-drawer.html`](../prototypes/riley-observations/06-automation-picker-drawer.html) | The drawer that opens when an Action step picks an external automation (n8n / Make / Zapier / GHL / custom webhook). Reuse for V1 Action step's "External automation" radio path. |
| [`prototypes/riley-observations/07-invoke-automation-run-detail.html`](../prototypes/riley-observations/07-invoke-automation-run-detail.html) | How an external-automation step renders during a live run (in the Activity tab / Flow tab). Reuse for V1. |
| [`prototypes/riley-observations/08-workflows-library.html`](../prototypes/riley-observations/08-workflows-library.html) | Workflows library page. Needs a refresh for the four A's once the spec is locked. |

### 14.3 Earlier exploration (rejected, kept for reference)

| Mockup | Status |
|---|---|
| [01 · Chat-driven Studio with live preview](../prototypes/workflows/01-studio-chat-with-live-preview.html) | Rejected — too busy. Three permanent panes. |
| [02 · Canvas-first, chat collapsed](../prototypes/workflows/02-studio-canvas-first.html) | Superseded by 05 (used the older eight-step-type taxonomy). |
| [03 · Canvas-first, chat activated](../prototypes/workflows/03-studio-chat-active.html) | Superseded by 05. The diff-card pattern in the chat panel still applies. |

(Mock 06 — earlier 2-panel version of the open task view — was deleted after mock 07 became the master.)

## 15. Next steps

1. **One round of stakeholder review on this brief.** Comment, push back, or sign off on the design decisions in §3-§10 and the build punch list in §11. This is the cheap moment to redirect — once we move to spec, the cost of changes climbs.
2. **Write the spec.** A separate document (likely `docs/workflows-dev-spec.md`) covering:
   - Schema deltas (the `approverGroup` + `quorum` fields, any related migrations)
   - Validator rule additions (four A's mapping, branching as output property, loop-only-on-approval-reject, no workflow-to-workflow nesting)
   - Engine enforcement changes (approver pool check, the `workflow.run.start` skill for agents)
   - Detailed UX specs for each of the new UI surfaces (open task view, Studio, team management, document toolbar, conversational editing)
   - Test plan
   - Migration plan for existing system templates (already cleanly mapped — no runtime migration needed)
   - Telemetry / observability additions
3. **Spec review pass** with `spec-reviewer` agent (Codex review loop with Claude adjudication) before any implementation work starts.
4. **Architect breakdown** — `architect` agent decomposes the spec into implementation chunks (likely 4-6 chunks given the punch list scope).
5. **Build via `feature-coordinator`** orchestrating architect → spec-conformance → pr-reviewer per chunk.

Open questions to resolve before spec lock:

- Does publishing prompt for a version note / changelog? (mentioned in §7.4)
- Does the document toolbar surface a version dropdown for files that have been edited multiple times via chat? (mentioned in §11.4)
- For the Studio handoff card from the orchestrator, is there a "preview the workflow" intermediate step before opening Studio, or does the orchestrator just hand the user straight into Studio with the draft loaded?
- How does the operator surface render Files tab content for tasks that produce 50+ files (long-running campaign tasks)? Pagination in the strip? Folder grouping? Defer until we see real usage, or design now?

---

_End of brief. Mockup index: [`prototypes/workflows/index.html`](../prototypes/workflows/index.html)._
