# Hierarchical Agent Delegation — Development Brief

> **Status:** Rev 5 — final pre-spec pass. Ready for internal spec-reviewer.
> **Date:** 2026-04-22
> **Audience:** Internal engineering, plus LLM reviewers without prior context on this codebase.
> **Related work (out of scope here):** Restructuring the seeded 16-agent company into a multi-tier org chart is being designed on a separate track. This brief assumes multi-tier hierarchies are desired and focuses on the runtime, routing, and observability primitives needed to make them *meaningful*.

---

## Contents

1. What this brief is
2. The Paperclip model — what we're trying to match
3. Where we are today (the good parts)
4. The problems we're solving
5. Recommendations
   - 5.0 Enforcement model — visibility and execution
   - 5.1 Introduce a hierarchy context object
   - 5.2 Visibility layer — scope-aware `config_list_agents`
   - 5.3 Execution layer — parent-scope `spawn_sub_agents` and `reassign_task`
   - 5.4 Derive delegation skills from graph position (don't attach)
   - 5.5 Root-agent contract — exactly one root per subaccount
   - 5.6 Use the triage classifier's `scope` to route Briefs
   - 5.7 Remove the hardcoded orchestrator slug
   - 5.8 Team-template picker in subaccount creation
   - 5.9 Observability — delegation trace graph, violation metrics, hierarchy health
6. Dependencies and suggested ordering
7. Out of scope
8. Success criteria for v1
9. Decisions made (resolving prior open questions)
10. Alternatives considered and rejected

---

## 1. What this brief is

Automation OS is a multi-tenant platform where agencies run AI agents on behalf of their client subaccounts. We want any agency owner to be able to define a structured "firm" of agents — a CEO agent at the top, managers beneath, and workers below them — and have the platform actually *enforce* that structure at runtime.

We've studied how a popular open-source product called Paperclip achieves this, and we have most of the schema and UX primitives needed to match it. What we don't have is the handful of runtime enforcements that turn the org chart from decoration into a real delegation graph. This brief proposes those enforcements.

This is a brief, not a spec. It's deliberately short. Each recommendation is sized as a small, independently-shippable change. An external reviewer is asked to stress-test the proposals, flag gaps, and suggest better alternatives where appropriate.

**What v1 is and isn't.** v1 enforces *tree-based* delegation with controlled escape hatches — not a canonical model of how all agent delegation must work forever. Real agent work is often messier than a tree: temporary lateral collaboration, cross-functional tasks, emergent graph-like patterns. Those patterns are intentionally out of scope here (§7). The decisions in this brief aim to make tree delegation work well, while leaving the door open to relax into mesh or task-based grouping later without redesigning primitives.

**Strategic framing.** The work in this brief quietly moves Automation OS from an *agent execution platform* (runs agents, one at a time, with tools) to an *agent organisation system* (coordinates a team of agents with role, scope, and reporting structure). That shift is what makes the hierarchy become a routing layer, a control surface, and later an optimisation surface (budget rollups per subtree, performance attribution per manager, delegation learning, automatic org-chart optimisation). We're not building those capabilities now — but the decisions in this brief should leave room for them rather than foreclose them.

## 2. The Paperclip model — what we're trying to match

Paperclip lets a user set up a "firm" of AI agents in a hierarchy:

- **One CEO agent** at the top. The human only ever talks to the CEO.
- **A middle-management layer** — e.g. a Sales Manager, an Ops Manager. Each has their own department.
- **Workers** under each manager. They execute.

The user types a request to the CEO. The CEO decomposes the request and delegates to the appropriate manager. That manager decomposes further and delegates to *their* workers. Workers execute. Results bubble back up through the hierarchy. The CEO reports back to the human.

Two properties are essential for this to work:

1. **Each level only delegates downward in its own subtree.** The CEO picks from its direct reports (agents whose `reportsTo` points at the CEO). A Sales Manager picks from *its* direct reports — not from the CEO's whole roster, and certainly not from the Ops Manager's team. This is what makes "manager" a meaningful role; without it, every agent sees every other agent and there's no hierarchy in any real sense.
2. **The same delegation primitives are reused at every level.** The CEO and the Sales Manager use the exact same skills to vet, decompose, and delegate — they just operate on different subtrees. Role emerges from position in the graph, not from a hardcoded list of "special" agents.

Paperclip also ships a "pick a team" flow: a user can choose a 6-agent or 32-agent preset, and the whole firm is materialised into a new workspace in one action. This matters for multi-tenancy — an agency owner should be able to spin up a new client subaccount with a curated team preloaded.

## 3. Where we are today (the good parts)

After a recent merge from main, we've built a lot of the scaffolding:

### 3.1 Three-tier agent model with parent pointers at every tier

- `systemAgents` (platform-shipped templates) — `parentSystemAgentId` column.
- `agents` (org-owned) — `parentAgentId` column.
- `subaccountAgents` (per-client links) — `parentSubaccountAgentId` column.

Cycle detection and depth validation (`MAX_DEPTH = 10`) live in `server/services/hierarchyService.ts`. The seed script walks `reportsTo` strings in a manifest and resolves them into real FKs, so any hierarchy a manifest describes will seed correctly.

### 3.2 The "talk to the CEO" UX is already live

A feature called Universal Brief (merged as PR #176) ships a global "Ask anything" input at the top of the app — `GlobalAskBar` — and a polymorphic `conversations` table with scope types for agent, brief, task, and agent-run-log chats. A user types free text, a Brief is created, and a two-tier triage classifier (`server/services/chatTriageClassifier.ts`) decides whether the Brief is a simple reply, a cheap cached answer, something that needs clarification, or something that needs the Orchestrator. The user never picks an agent — they just ask.

This is already close to Paperclip's "user only talks to the CEO" posture. What's missing is the enforcement *behind* the UX, which is what this brief is about.

### 3.3 Capability-aware routing

The Orchestrator classifies every task it receives into one of four deterministic paths: (A) already configured, (B) configurable via Configuration Assistant, (C) broadly-useful candidate for platform promotion, (D) genuinely unsupported. A machine-readable Integration Reference (`docs/integration-reference.md`) drives this. The pipeline is already proven and is not what this brief is changing.

### 3.4 Delegation primitives exist

Two skills handle agent-to-agent delegation today:

- `spawn_sub_agents` — parallel fan-out to 2–3 sub-tasks, each assigned to a chosen agent in the subaccount.
- `reassign_task` — sequential hand-off of a task to another agent.

Both are defined as plain markdown files under `server/skills/` and are callable by any agent that has them attached. They're not hardwired to the Orchestrator.

### 3.5 Team-template machinery

`hierarchyTemplateService.apply(templateId, orgId, { subaccountId, mode })` can now take a stored template and materialise it into a subaccount. `importToSubaccount()` can import a Paperclip-shaped JSON manifest directly. The endpoints exist at `POST /api/hierarchy-templates/:id/apply` and `POST /api/subaccounts/:subaccountId/agents/import`. We're missing only the UI entry point.

## 4. The problems we're solving

Four gaps stand between the current state and the Paperclip posture. They're independent in concept but related in the fix — they all come down to "the hierarchy exists in the schema but is invisible to the runtime."

**Problem 1 — Delegation ignores the hierarchy.** When an agent calls `spawn_sub_agents` or `reassign_task`, the executor picks a target agent with no regard for who the caller's children are. A Sales Manager could hand work to a Dev team worker, or to the CEO, or to a worker in a completely different department. There is no filter. The consequence: role cannot emerge from position in the graph; "manager" is decorative.

**Problem 2 — Skills have no view of the caller's parent.** The `SkillExecutionContext` struct — the object passed into every skill handler — carries the caller's agent ID, subaccount ID, and org ID, but *not* the caller's parent. So even if we wanted a delegation skill to filter by "my children," it has no way to know who "my parent" is. This is a small plumbing change that unblocks everything else.

**Problem 3 — Listing skills are org-wide only.** The `config_list_agents` skill returns every active agent in the org. A manager needs to be able to ask "who are my direct reports?" or "who is in my subtree?" and today there's no way to get that list without returning everyone. The skill shape is otherwise fine; it just needs a `scope` parameter.

**Problem 4 — Routing is slug-hardcoded and scope-blind.** When a Brief is created, the system looks up an agent with the slug `'orchestrator'` and routes the Brief to it. That slug is a literal string in `server/jobs/orchestratorFromTaskJob.ts:21`. Meanwhile the triage classifier produces a `scope` for every Brief (`subaccount` / `org` / `system`), logs it for later analysis, and then throws it away — nothing downstream branches on it. The result: every Brief in every subaccount goes to one hardcoded agent, and there's no path for a subaccount to have its own top-level CEO agent.

These four problems, taken together, are why we can *describe* a 32-agent hierarchy in our schema but can't *run* one.

## 5. Recommendations

### 5.0 Enforcement model — visibility and execution

**Scope of enforcement — one-line contract.** Hierarchy enforcement is intentionally minimal: it constrains *delegation*, not agent cognition, planning, or capability selection. If a proposed spec item touches prompting, reasoning, planning context, or capability routing, it is outside the scope of this system.

The hierarchy must be enforced at two layers, not one. This framing underpins the rest of §5.

- **Visibility layer.** What an agent can *see* when it lists the roster. A manager's default world view should be "my direct reports," not "every agent in the org." This prevents the agent from even reasoning about invalid delegations in the first place, which saves tokens, reduces noisy failures, and keeps prompt context focused.
- **Execution layer.** What an agent can *do* when it calls a delegation skill. Even if the agent somehow names a target outside its subtree, the executor validates at call time and rejects the call.

**Mental model — advisory for reasoning, authoritative for execution.** The visibility layer *shapes the reasoning space* an agent operates in; it is not itself the enforcement mechanism. The execution layer is where hierarchy becomes hard constraint. Getting this distinction right matters: future contributors must not treat scoped listings as enforcement, and enforcement logic stays centralised in the executor rather than scattered across skill handlers or prompts.

Enforcement at only one layer doesn't work. Visibility without execution enforcement is a suggestion; execution without visibility enforcement produces repeated illegal-move failures as agents see targets they can't actually reach. Both layers are required, and both are small.

**Orthogonal to capability-aware routing.** Hierarchy enforcement is a separate concern from the Path A / B / C / D capability-routing system documented in `architecture.md`. Capability routing answers *which skill or agent can satisfy the capability requirements of this task*; hierarchy enforcement answers *who in the graph is permitted to delegate to whom*. A task still classifies A/B/C/D for capability routing; hierarchy scoping is then applied to whoever ends up handling the run. The two systems compose — don't merge them in the spec phase.

The visibility layer is §5.2. The execution layer is §5.3. They share the same `scope` vocabulary and the same context object from §5.1.

### 5.1 Introduce a hierarchy context object

**Why.** Every downstream recommendation that filters by hierarchy needs the caller's position in the graph visible inside skill handlers. A bare `parentAgentId` field is not enough — delegation decisions usually require knowing direct children, the root of the current subtree, and the agent's depth. Making every skill walk the tree itself duplicates queries and creates inconsistent logic.

**What.** Add a `hierarchy` field to the `SkillExecutionContext` interface in `server/services/skillExecutor.ts`:

```ts
hierarchy: {
  parentId: string | null    // null iff this agent is a subaccount root
  childIds: string[]         // direct reports only; empty for workers
  depth: number              // 0 at the root
  rootId: string             // the subaccount root's agent id (this agent's own id if root)
}
```

Populate it once at context construction from `subaccountAgents.parentSubaccountAgentId` (for subaccount-scoped runs) or `agents.parentAgentId` (for org-scoped runs). `childIds` comes from the same table, filtered to active links. `depth` and `rootId` are computed by walking upward once at construction — bounded by `MAX_DEPTH = 10`.

**Why this is the right shape.** Four fields cover ~95% of hierarchy-aware skill logic. Skills that need the entire subtree (rare — budget rollups, for instance) can call a separate repository helper rather than paying the lookup cost on every run. The object is small, cacheable, and stable for the lifetime of a run.

**Contract boundary — read-only snapshot, not dynamic source of truth.** The `hierarchy` object is built once at context construction and is immutable for the rest of the run. Skill handlers treat it as a read-only snapshot: they do not mutate it, they do not re-query mid-run, they do not reinterpret it against their own view of the graph. If the graph changes during a run (an agent is re-linked, a manager gains a new subordinate), those changes apply from the *next* run forward, not the current one. This keeps the object a stable contract boundary — future changes to how hierarchy is computed can land in one place without rippling through every skill.

**Footprint.** One field, one populate site, a small repository helper for the upward walk. Zero behaviour change until §5.2 onward consumes it.

---

### 5.2 Visibility layer — scope-aware `config_list_agents`

**Why.** A middle manager should see its team, not the whole org. Today the only way to enumerate agents is "every active agent in the org," which both wastes tokens and invites the agent to reason about delegations it can't legally execute.

**What.** Add an optional parameter `scope: 'children' | 'descendants' | 'subaccount'` to `config_list_agents`. Meaning:

- `'children'` — agents where `parentSubaccountAgentId === context.agentId` (the default for any agent with children; see below).
- `'descendants'` — the caller's full subtree, bounded by `MAX_DEPTH = 10`.
- `'subaccount'` — every agent in the current subaccount (today's behaviour).

Apply the same parameter to `config_list_subaccounts` and `config_list_links` for vocabulary consistency.

**Adaptive default.** The default depends on the caller's position in the graph, not a caller-supplied flag: if `context.hierarchy.childIds.length > 0`, default to `'children'`; otherwise default to `'subaccount'`. Workers (no children) see the subaccount as before — nothing changes for them. Managers (have children) see their team by default. This makes hierarchy the default world view the moment an agent gains a subordinate, without forcing existing prompts to be rewritten.

**Why not just filter client-side.** Two reasons. First, returning a 32-agent roster every time a 5-agent team is enumerated wastes tokens and widens the LLM's attention surface. Second, making the scope explicit in the tool call is a readability win — run traces show "I asked for my direct reports" instead of "I asked for everyone and then picked three."

**Footprint.** Parameter addition, three handlers, adaptive-default logic driven by `context.hierarchy`.

---

### 5.3 Execution layer — parent-scope `spawn_sub_agents` and `reassign_task`

**Why.** Visibility scoping alone isn't enough. An agent could still name a target outside its subtree (via prompt leakage, hallucination, or an older stored agent ID). The executor has to validate. This is the enforcement half of §5.0.

**What.** Add a `delegationScope: 'children' | 'descendants' | 'subaccount'` parameter to both `spawn_sub_agents` and `reassign_task`. Validation runs at call time, inside the executor:

- `'children'` — assert `target.parentSubaccountAgentId === caller.agentId`. Fail with a structured error if not.
- `'descendants'` — assert the target is somewhere in the caller's subtree. Reuse the walk from §5.1's `rootId` computation.
- `'subaccount'` — no subtree restriction, today's behaviour.

**Adaptive default.** Same shape as §5.2. Default to `'children'` when the caller has children, `'subaccount'` when they don't. Managers tighten automatically, workers are unaffected.

**Delegation scope is a runtime constraint, not a planning constraint.** Important distinction for prompt authors: `delegationScope` restricts *who the agent can invoke at call time*, not *what the agent is allowed to reason about, plan, or consider*. Agents should still think broadly — reason across the whole org, consider cross-team implications, draft plans that reference agents they can't directly call. Execution is where the constraint bites. If we narrow the reasoning space (e.g. by pruning planning prompts to the agent's subtree), we lose the broader judgement that makes managers useful. Keep the system cognitively flexible and operationally constrained.

**Who can use the `'subaccount'` escape hatch.** This is important. `'subaccount'` must remain available — real orgs have cross-subtree handoffs, exceptional escalations, and "this landed in the wrong team" cases. But it should only be callable by **root agents** (agents where `parentSubaccountAgentId IS NULL`). A mid-tree agent passing `delegationScope: 'subaccount'` is either a prompt bug or an attempt to bypass the hierarchy; the executor rejects it with the same error as an out-of-subtree target. Position in the graph grants the authority — no new authority enum, no hardcoded roles.

**Escape hatches are for exceptions, not normal operation.** The `'subaccount'` scope exists for exception handling, recovery, and misrouting correction — "this task landed in the wrong team, route it elsewhere." It is not the way normal work gets done. If an agent's prompt starts defaulting to `'subaccount'` scope for routine delegations, the hierarchy has quietly collapsed back into flat mode. The violation metrics in §5.9 track this: a sustained high ratio of `'subaccount'`-scoped calls from a single agent is a prompt-drift signal, not an operational norm. Normal delegation stays within subtree; escape hatches stay exceptional.

**Upward escalation.** A non-root agent reassigning *upward* to its parent is allowed but logged with a distinct marker (`delegation_direction: 'up'`) so it's rare-by-observation. Cross-subtree reassignments happen by escalating to the nearest common ancestor (typically the Orchestrator), which then reassigns downward into the target subtree — the cleanest mental model and the one that keeps every hop legible in the trace.

**Footprint.** New parameter on both skills, validation logic in the executor, two new structured error codes (`delegation_out_of_scope`, `cross_subtree_not_permitted`).

---

### 5.4 Derive delegation skills from graph position (don't attach)

**Why.** Any agent with children needs the same small set of delegation skills — list the team, spawn parallel work, reassign sequential work. The obvious approach is to attach those skills to managers at creation time. That approach quietly breaks: children change over time. An agent promoted to manager by gaining a subordinate would need its skill list updated. An agent demoted by losing all children would have delegation skills it shouldn't use. Sync logic is easy to forget and hard to audit.

**What.** Resolve the delegation skills at runtime, based on `context.hierarchy.childIds.length > 0`, not at skill-attachment time. Concretely: when the skill resolver assembles the tool list for a run, it unions the agent's attached skills with a graph-derived set:

- If the agent has at least one active child, add `config_list_agents`, `spawn_sub_agents`, and `reassign_task` to the available tool list for this run (if not already attached).
- If the agent has no children, the derived set is empty — the agent's own attached skills are unchanged.

**Why this makes role emergent.** With delegation skills derived from position, "manager" stops being a hardcoded role and becomes a property of position in the graph. Add a child to a worker and it becomes a manager on its next run; remove all children and it becomes a worker again. No enum fields, no role table, no sync job, no drift. The FK graph is the single source of truth for who delegates.

**What this avoids.** We deliberately don't introduce a new "skill bundle" first-class concept (with storage, versioning, management UI) just for this case. The derived-resolution path is smaller, drift-free, and enough for v1. If we later find ourselves wanting to version skill kits independently, that's a separate conversation.

**Footprint.** One addition to the skill resolver — roughly "if `hierarchy.childIds.length > 0`, union with the delegation skill set." No schema, no storage, no migration.

---

### 5.5 Root-agent contract — exactly one *primary entry point* per subaccount

**Why.** Routing in §5.6 depends on "find the entry-point agent for this subaccount." If that lookup can return zero, one, or many agents depending on data state, routing becomes non-deterministic and produces hard-to-debug "wrong CEO" bugs. We need a clear contract.

**Framing — primary entry point, not single source of truth.** The root is the conventional front door for Briefs submitted to a subaccount — the agent that the GlobalAskBar routes to by default. It is not the only agent in the subaccount, not the only agent the user can talk to (§5.8 keeps direct-to-specialist chat available), and not the only path a task can take. Framing it as the *primary entry point* keeps the design honest about what the invariant actually buys us: deterministic default routing, not exclusive authority.

**What.** Enforce exactly one active root per subaccount via a partial unique index:

```sql
CREATE UNIQUE INDEX subaccount_agents_one_root_per_subaccount
  ON subaccount_agents (subaccount_id)
  WHERE parent_subaccount_agent_id IS NULL
    AND is_active = true;
```

**Graceful degradation as first-class behaviour.** Operational reality will occasionally violate the invariant — migrations, partial failures, template re-applies, manual DB edits. The resolver's degradation paths are part of the contract, not a fallback hack:

- **Zero roots at runtime.** The routing resolver (§5.6) falls back to the org-level root (historically the hardcoded Orchestrator slug, §5.7), dispatches the Brief, and emits a `subaccountNoRoot` health finding (§5.9) plus a structured log. The Brief still gets handled — the user does not see a broken product — while ops gets a loud, targeted signal.
- **Multiple roots at runtime.** Impossible during normal operation because of the index, but possible during a migration window before the index is in place. Resolver picks the oldest by `createdAt` for determinism and emits `subaccountMultipleRoots` (critical severity). Same posture: dispatch continues, ops is notified immediately.
- **Template apply window.** `hierarchyTemplateService.apply()` and `importToSubaccount()` deactivate the prior root in the same transaction as activating the new one. This closes the split-brain "two CEOs" window during re-applies without requiring the resolver to reason about it.

**Migration.** Audit existing subaccounts before adding the index. Any subaccount with zero or multiple active roots needs manual resolution first (there shouldn't be many — the hardcoded Orchestrator model has produced one-root-per-org, not one-root-per-subaccount, so most existing subaccounts are likely to have zero subaccount-roots rather than multiple).

**Footprint.** One partial unique index, migration script, one transaction-boundary audit on two existing service methods, two health detectors already covered by §5.9. Enables 5.6 and 5.7.

---

### 5.6 Use the triage classifier's `scope` to route Briefs

**Why.** The Universal Brief feature already classifies every incoming user query into a `scope` of `subaccount` / `org` / `system`. It writes that scope to `fast_path_decisions.decidedScope` for observability. Then it throws it away. Nothing in `briefCreationService` branches on it. This is the single cheapest routing improvement on the table.

**What.** Before enqueueing the Brief for dispatch, look up the appropriate root agent for the scope:

- `scope: 'subaccount'` → find the root agent in the target subaccount (`parentSubaccountAgentId IS NULL`).
- `scope: 'org'` → find the org's designated root (e.g. the agent linked to the org's sentinel subaccount).
- `scope: 'system'` → platform-wide system agent.

If the lookup finds nothing, fall back to current behaviour (hardcoded slug) so existing setups don't break.

**Why this matters beyond tidiness.** This is the change that unlocks per-subaccount CEOs. Today, every subaccount under an org sends every Brief to the same org-level Orchestrator. With scope-aware routing, a client subaccount that wants its own custom top-level agent (a "Trading Firm CEO" for a trading subaccount, a "Marketing Agency CEO" for a marketing subaccount) can have one — and the user in that subaccount's Brief chat automatically talks to the right agent.

**Footprint.** One resolver function (roughly 30–50 lines), one call site in `briefCreationService`. No schema changes.

---

### 5.7 Remove the hardcoded orchestrator slug

**Why.** Recommendation 5.6 makes this cleanup obvious. Once scope-aware routing can find the right root agent from the graph, there's no reason to keep `ORCHESTRATOR_AGENT_SLUG = 'orchestrator'` as a literal string. It's the last place in the codebase where we say "the CEO is this specific slug" instead of "the CEO is whoever sits at the top of this subtree."

**What.** Replace the slug lookup in `server/jobs/orchestratorFromTaskJob.ts:21` with the scope resolver from 5.6. The resolver becomes the single canonical way to find the top agent for a given scope.

**Footprint.** Two-line change if 5.6 is in. Essentially a cleanup pass.

---

### 5.8 Team-template picker in subaccount creation

**Why.** The whole Paperclip moment — "pick a 6-agent preset and spin up the firm" — is one UI pattern away. All the backend verbs exist. We just don't offer the user a choice when creating a subaccount.

**What.** In the subaccount-creation form, add a "Starting team" picker that lists available hierarchy templates (system-shipped plus any the org has saved). On submit, create the subaccount and immediately call `POST /api/hierarchy-templates/:id/apply` with the new subaccount's ID. Include a "None / blank" option so existing workflows still work.

**Why this belongs in this brief.** A fully-functioning recursive delegation graph with no way to create a firm is an engineering demo, not a product. The template picker is the ergonomic payoff that makes the underlying work visible to the end user.

**Footprint.** One form field, one extra API call on submit, template list endpoint already exists.

---

### 5.9 Observability — delegation trace graph, violation metrics, hierarchy health

**Why — required for safe rollout, not a post-feature enhancement.** A hierarchical delegation system is much harder to debug than a flat one. A single Brief can fan out through three or four agents before producing the final artefact, and when something goes wrong "which agent did what, and why" has to be answerable in seconds, not minutes. The first week after enforcement lands, expect a measurable spike in rejection-rate metrics as existing prompts hit scoping they previously ignored — triaging that spike without the trace graph and violation counters is guesswork. The existing Run Trace Viewer handles the single-run case but doesn't stitch cross-agent chains into a visible graph. **This section is not optional for rollout.** If 5.9 isn't ready, 5.1–5.4 aren't ready to ship either.

**What.** Three additions, none of them large:

**1. Delegation trace graph (UI).** Extend the run trace view to render the delegation tree: who called whom, with which `delegationScope`, which `handoffContext`, and the outcome. For a Brief that fans out through three levels, the trace should be one collapsible tree, not three disconnected run pages. The graph reads from existing `agentRuns` fields (`parentRunId`, `isSubAgent`, `handoffDepth`, `handoffSourceRunId`) — no new storage.

**2. Scope violation metrics.** The executor's rejection path (the `delegation_out_of_scope` and `cross_subtree_not_permitted` errors from §5.3) increments structured counters by `callerAgentId` and `attemptedTargetAgentId`. Sustained violations by a single agent indicate a prompt bug — its manifest says "manager of team X" but it's trying to delegate to team Y. A simple dashboard query surfaces the offenders.

**3. Hierarchy health detectors.** Two new detectors in the existing Workspace Health Audit subsystem (`server/services/workspaceHealth/detectors/`):

- `subaccountMultipleRoots` (critical) — fires if §5.5's invariant is violated for any reason (race, bad migration, direct DB edit). Should never fire in normal operation.
- `subaccountNoRoot` (critical) — fires if a subaccount has zero active roots. Blocks Brief dispatch for that subaccount; surfaces to ops.
- `managerWithoutChildren` (warning) — fires if an agent has delegation skills attached directly (not derived) but has no active children. Usually means a previously-managed team was migrated away and the old attachments were never cleaned up.

The existing detector framework is plug-and-play, so each detector is a ~30-line file.

**Footprint.** UI extension for the trace graph, two structured error codes already added in §5.3, three detectors. No new tables.

## 6. Dependencies and suggested ordering

The recommendations split cleanly into four independently-shippable groups, with dependencies flowing in one direction:

- **Group A — runtime enforcement:** 5.1 → 5.2 → 5.3 → 5.4. Must be done in this order — 5.2 and 5.3 depend on 5.1's hierarchy context, and 5.4 depends on all three.
- **Group B — routing:** 5.5 → 5.6 → 5.7. 5.5 is a DB-contract prerequisite for 5.6's resolver; 5.7 is the cleanup that retires the hardcoded slug.
- **Group C — UX:** 5.8. Independent of A and B once the backend verbs exist.
- **Group D — observability:** 5.9. Depends on A and B having landed (the error codes and the root-agent contract are what the detectors and the trace graph check against), but otherwise standalone.

Groups A and B don't depend on each other. You can ship B alone and get per-subaccount CEOs without changing delegation. You can ship A alone and get proper manager-scoped delegation inside the existing single-orchestrator routing. Both are valuable independently.

If we had to pick the single highest-leverage first step, it would be **5.5 + 5.6 together** — the root-agent contract plus scope-aware routing. Small change, unblocks per-subaccount CEOs immediately, and establishes the contract that the rest of the work rests on.

**Rollout friction — plan for it.** Once Group A enforcement lands, expect a short period where delegation rejection rates spike, existing agent prompts need small edits to respect scope, and runs that previously succeeded now fail fast with structured errors. This is the intended outcome — the system is now telling us what was quietly wrong before — but it needs to be planned for, not survived. Two implications:

1. **Group D is not optional for rollout of Group A.** The trace graph, violation metrics, and health detectors in §5.9 are how the team triages the friction. Rolling A without D turns every surprising failure into a one-off investigation. Ship them together, or ship D first.
2. **Expect an "adjustment phase" window of 1–2 weeks after A lands.** Reserve time for prompt tweaks and scope calibration. The failures during this window are intended behaviour, not regressions — label them that way in the review log so the team calibrates expectations.

## 7. Out of scope

**Multi-tier seeded company.** We currently seed a flat 16-agent company (Orchestrator plus 15 direct reports). Restructuring that into a genuine 3-tier org chart (COO → department heads → specialists) is being designed on a separate track and is *not* part of this brief. The recommendations here are what that restructure will rely on to be functionally different from today's flat setup; without them, promoting four agents to "manager" titles would be theatre.

**Changes to the Universal Brief UX itself.** The global input bar, the polymorphic conversations table, the triage classifier — all the front-door infrastructure — is shipped and working. We're augmenting how it routes, not redesigning the surface.

**Permission and RLS changes.** Hierarchy-scoped delegation is enforced at the *skill execution* layer, not at the database row-level-security layer. RLS stays where it is. If a reviewer sees a reason to push enforcement down to RLS instead (or in addition), that's a conversation worth having but isn't assumed here.

**Multi-user threads on Briefs.** A colleague picking up another user's Brief chat is a known future need and schema-compatible, but nothing in this brief depends on or blocks it.

**Mesh, dynamic teams, and task-based grouping.** Real agent work isn't always tree-shaped. Temporary lateral collaboration (two specialists pairing on a problem), task-scoped ad-hoc teams, and graph-like delegation patterns are real needs that will surface as usage grows. They're intentionally out of scope for v1 — a tree with controlled escape hatches is the right starting point because it's simpler to reason about, observe, and enforce. The primitives in §5.1–§5.3 (hierarchy context, scoped visibility, scoped execution) are designed to relax into those patterns later without being redesigned: `'descendants'` is already graph-shaped inside a subtree, the `'subaccount'` escape hatch already supports lateral jumps from the root, and nothing in the enforcement model forbids a future `delegationScope: 'pair'` or task-scoped membership primitive.

## 8. Success criteria for v1

Intent, not metrics — the spec phase will turn these into measurable thresholds. These are how the team knows v1 has worked, not just shipped.

1. **Managers predominantly delegate within their subtree.** Sustained observation (post-adjustment-phase): the overwhelming majority of `spawn_sub_agents` and `reassign_task` calls from any manager agent resolve to targets where `target.parentSubaccountAgentId === caller.agentId`. Frequent subtree violations by a specific agent indicate a prompt bug, not a design bug.

2. **Cross-subtree hops happen via root (or the nearest common ancestor).** When work moves between teams, the trace shows an upward hop to a common ancestor followed by a downward hop into the target subtree — not a direct lateral jump. Direct lateral jumps require the root-only `'subaccount'` escape, and violation metrics flag sustained use of it.

3. **Violation rates trend down after the adjustment period.** The week or two after Group A lands will show elevated `delegation_out_of_scope` and `cross_subtree_not_permitted` counters as existing prompts adjust. After that window, both counters should trend steadily downward and plateau near zero. A rising or stubborn curve indicates prompt debt, not enforcement bugs.

4. **Delegation traces are explainable in one pass.** For any Brief that fans out through multiple agents, an engineer or operator opening the trace graph (§5.9) should be able to answer "why did X delegate to Y" in a single read, without cross-referencing logs, prompts, or DB state. If the trace graph makes multi-agent runs legible at a glance, the observability layer is doing its job.

These criteria are orthogonal to capability-routing success — the Path A/B/C/D system has its own criteria documented in `architecture.md`. Hierarchy enforcement is passing if managers-stay-in-subtree, cross-team-goes-via-ancestor, violations-decay, and traces-are-legible.

---

## 9. Decisions made (resolving prior open questions)

The first draft of this brief left eight questions open. External review plus internal adjudication resolves them as follows. Each is now a design decision — reviewers can still disagree, but the default is to proceed with these answers unless challenged.

1. **Default delegation scope is adaptive.** Default to `'children'` when `context.hierarchy.childIds.length > 0`, otherwise `'subaccount'`. Position in the graph drives the default — no caller flag, no global toggle. Workers are unaffected; managers tighten automatically. Rationale: a global `'subaccount'` default would let the system drift back to flat behaviour indefinitely, even with enforcement available. Adaptive defaults make hierarchy the path of least resistance.

2. **No first-class skill-bundle concept.** Delegation skills are *derived at runtime* from `context.hierarchy.childIds`, not stored as a named bundle. See §5.4. We do not introduce skill bundles as a versioned entity. If a future use case needs versioned kits, that's a separate spec.

3. **Exactly one active root per subaccount.** Enforced by a partial unique index — see §5.5. Zero-roots or multiple-roots at runtime are treated as config errors and surfaced via the `subaccountNoRoot` / `subaccountMultipleRoots` health detectors.

4. **Upward escalation is allowed.** A non-root agent can reassign upward to its parent. The executor records `delegation_direction: 'up'` in the run trace so upward hops are visible and quantifiable. Expected to be rare; the metric exists so we can confirm that assumption.

5. **Cross-subtree delegation goes through the nearest common ancestor.** Typically the Orchestrator (the subaccount root). The executor does not introduce a new "cross-subtree delegate" skill; instead, mid-tree agents escalate upward (via upward reassign) and the ancestor reassigns downward into the target subtree. Two hops, both legitimate under the enforcement rules, and both legible in the trace. The only agent with direct cross-subtree authority is the subaccount root — and that's granted by position (§5.3), not by an enum.

6. **Manager agents run on-demand, not on a heartbeat.** A manager's job is to decompose and delegate when asked; between asks it has no work to do. Scheduled manager runs mostly burn tokens on no-op runs.

7. **Manager token budget is configurable, not a hardcoded ratio.** We set a sensible default (starting point: the same as worker agents — don't optimise before we have data) and let operators tune per-agent via the existing `tokenBudgetPerRun` override. We will revisit with real usage data; choosing a ratio today based on a guess foreclosed flexibility for no benefit.

8. **Hierarchy is collapsed by default in the user chat, expandable via trace.** The user sees a single voice from the subaccount root — they don't need to know that three sub-delegations happened. The full delegation trace graph (§5.9) is one click away for anyone investigating a run. This matches Paperclip's posture and keeps the "talk to one CEO" UX intact.

## 10. Alternatives considered and rejected

Documenting the paths we explored and chose not to take, because "what we're not doing" is often more informative than "what we are."

**A `delegationAuthority: 'strict' | 'cross_subtree' | 'global'` enum on agents.** Rejected. It solves the cross-subtree-authority question but reintroduces hardcoded role fields — the exact pattern this brief is designed to eliminate. Position in the graph already answers the authority question: root agents can use `'subaccount'` scope, non-root agents cannot. No new field, no drift between role and graph.

**Attach delegation skills to manager agents at creation time.** Rejected. See §5.4. Attachment creates drift when children change; derivation doesn't.

**Single-field `parentAgentId` in `SkillExecutionContext`.** Rejected in favour of the four-field `hierarchy` object. See §5.1. Skills commonly need more than "who is my parent" — they need children, depth, and root.

**Default delegation scope of `'subaccount'` for backward compatibility.** Rejected in favour of adaptive. See §9, decision 1.

**Enforcement at only the execution layer (skill validation, no visibility scoping).** Rejected in favour of dual-layer enforcement. See §5.0. Execution-only enforcement produces a pathology where managers repeatedly try illegal delegations (because they can see invalid targets) and fail noisily. Visibility scoping prevents the attempt; execution enforcement catches the rare miss.

**Push hierarchy enforcement down to Postgres row-level security.** Deferred, not rejected. RLS is about data access (can agent A read row B), not workflow control (can agent A delegate to agent B). The two are adjacent but not the same. RLS-layer delegation enforcement might be worth revisiting if we see sustained bypass attempts at the application layer, but it's not the v1 mechanism.
