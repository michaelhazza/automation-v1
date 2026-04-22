# Hierarchical Agent Delegation — Development Brief

> **Status:** Draft dev brief. Not yet a spec. Intended for external review before we commit to a spec pass.
> **Date:** 2026-04-22
> **Audience:** LLM reviewer without prior context on this codebase, plus internal engineering.
> **Related work (out of scope here):** Restructuring the seeded 16-agent company into a multi-tier org chart is being designed on a separate track. This brief assumes multi-tier hierarchies are desired and focuses on the runtime and routing primitives needed to make them *meaningful*.

---

## Contents

1. What this brief is
2. The Paperclip model — what we're trying to match
3. Where we are today (the good parts)
4. The problems we're solving
5. Recommendations
   - 5.1 Plumb `parentAgentId` through `SkillExecutionContext`
   - 5.2 Add a `scope` parameter to `config_list_agents`
   - 5.3 Parent-scope `spawn_sub_agents` and `reassign_task`
   - 5.4 Bundle delegation skills into a reusable `delegation_kit`
   - 5.5 Use the triage classifier's `scope` to route Briefs
   - 5.6 Remove the hardcoded orchestrator slug
   - 5.7 Team-template picker in subaccount creation
6. Dependencies and suggested ordering
7. Out of scope
8. Open questions for the reviewer

---

## 1. What this brief is

Automation OS is a multi-tenant platform where agencies run AI agents on behalf of their client subaccounts. We want any agency owner to be able to define a structured "firm" of agents — a CEO agent at the top, managers beneath, and workers below them — and have the platform actually *enforce* that structure at runtime.

We've studied how a popular open-source product called Paperclip achieves this, and we have most of the schema and UX primitives needed to match it. What we don't have is the handful of runtime enforcements that turn the org chart from decoration into a real delegation graph. This brief proposes those enforcements.

This is a brief, not a spec. It's deliberately short. Each recommendation is sized as a small, independently-shippable change. An external reviewer is asked to stress-test the proposals, flag gaps, and suggest better alternatives where appropriate.

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

### 5.1 Plumb `parentAgentId` through `SkillExecutionContext`

**Why.** This is the foundational change. Every downstream recommendation that filters by hierarchy depends on the caller's parent ID being visible inside skill handlers. Today it isn't.

**What.** Add `parentAgentId: string | null` to the `SkillExecutionContext` interface in `server/services/skillExecutor.ts`. Populate it when the context is constructed — the caller's parent can be read from `subaccountAgents.parentSubaccountAgentId` (for subaccount-scoped runs) or `agents.parentAgentId` (for org-scoped runs). It should be `null` for the root agent of a subaccount.

**Why this is the right shape.** A single nullable field keeps the context lean. We considered passing the whole ancestor chain but decided against it — most skills only need "am I a root?" and "who is my direct parent?" questions. For the rare case where a skill needs the whole chain, it can walk upward one query at a time.

**Footprint.** One field, one populate-site, zero behaviour change. Enables 5.2 / 5.3 / 5.4.

---

### 5.2 Add a `scope` parameter to `config_list_agents`

**Why.** A middle manager needs to know its team. Today the only way to enumerate agents is "give me every agent in the org," which defeats the purpose.

**What.** Add an optional parameter `scope: 'subaccount' | 'children' | 'descendants'` defaulting to `'subaccount'` (preserving current behaviour). When `'children'`, filter to agents where `parentSubaccountAgentId === context.agentId`. When `'descendants'`, recurse (bounded by `MAX_DEPTH = 10`). Apply the same parameter to `config_list_subaccounts` and `config_list_links` for consistency.

**Why not just filter on the client side.** Two reasons. First, it avoids returning a potentially large list just to filter it down — a 32-agent firm would return 32 rows every time a manager enumerates its 5 direct reports. Second, it makes the skill's intent explicit in the tool call, which is readable in run traces and easier to reason about when debugging delegation chains.

**Footprint.** Parameter addition, three handlers, backward-compatible default.

---

### 5.3 Parent-scope `spawn_sub_agents` and `reassign_task`

**Why.** This is the enforcement half. Without it, a middle manager's "list my children" skill returns a filtered list, but the manager could still hand work to any agent it names — the hierarchy is opt-in by good behaviour rather than enforced.

**What.** Add a `delegationScope: 'children' | 'descendants' | 'subaccount'` parameter to both skills. When the scope is `'children'`, validate at call time that `target.parentSubaccountAgentId === caller.agentId` and fail the call with a clear error if not. When `'descendants'`, allow any agent in the caller's subtree. When `'subaccount'`, preserve today's flat behaviour.

**What the default should be.** Open question. See §8. One view: default to `'children'` for any agent that has children, and `'subaccount'` for leaf agents (preserves current behaviour for agents that aren't managers). Another view: default stays `'subaccount'` for backward compatibility, and managers opt in. The second is safer but relies on prompt discipline.

**Escape hatch.** Keep `'subaccount'` mode available. Real orgs have exceptional cases — a task lands with the wrong team, a cross-functional handoff is needed, the Orchestrator needs to reassign from one department to another. Making the hierarchy a strict cage would fight those cases instead of supporting them. The hierarchy should be a guard rail, not a wall.

**Footprint.** New parameter on both skills, validation logic in the executor, new error code.

---

### 5.4 Bundle delegation skills into a reusable `delegation_kit`

**Why.** Once 5.1–5.3 land, any agent with children needs the same small bundle of skills — list your team, spawn parallel work, reassign sequential work. Attaching them individually everywhere is error-prone; bundling them makes the pattern explicit.

**What.** Define a named skill bundle — either as a new concept in the skill system, or as a convention in agent templates. When a new manager-tier agent is created (via template apply, via manual creation, whenever), automatically attach the kit. When the agent has no children (i.e. it's a worker), don't attach it.

**Why this makes role emergent.** With a `delegation_kit` auto-attached to any agent with children and withheld from agents without, "manager" stops being a hardcoded role and becomes a property of position in the graph. Add a child to a worker and it becomes a manager; remove all children and it becomes a worker again. No enum fields, no role table, no manual configuration — the graph is the source of truth.

**Footprint.** Either a new concept (skill bundles) or a convention in the existing skill-attachment code. The convention path is smaller and probably enough for v1.

---

### 5.5 Use the triage classifier's `scope` to route Briefs

**Why.** The Universal Brief feature already classifies every incoming user query into a `scope` of `subaccount` / `org` / `system`. It writes that scope to `fast_path_decisions.decidedScope` for observability. Then it throws it away. Nothing in `briefCreationService` branches on it. This is the single cheapest routing improvement on the table.

**What.** Before enqueueing the Brief for dispatch, look up the appropriate root agent for the scope:

- `scope: 'subaccount'` → find the root agent in the target subaccount (`parentSubaccountAgentId IS NULL`).
- `scope: 'org'` → find the org's designated root (e.g. the agent linked to the org's sentinel subaccount).
- `scope: 'system'` → platform-wide system agent.

If the lookup finds nothing, fall back to current behaviour (hardcoded slug) so existing setups don't break.

**Why this matters beyond tidiness.** This is the change that unlocks per-subaccount CEOs. Today, every subaccount under an org sends every Brief to the same org-level Orchestrator. With scope-aware routing, a client subaccount that wants its own custom top-level agent (a "Trading Firm CEO" for a trading subaccount, a "Marketing Agency CEO" for a marketing subaccount) can have one — and the user in that subaccount's Brief chat automatically talks to the right agent.

**Footprint.** One resolver function (roughly 30–50 lines), one call site in `briefCreationService`. No schema changes.

---

### 5.6 Remove the hardcoded orchestrator slug

**Why.** Recommendation 5.5 makes this cleanup obvious. Once scope-aware routing can find the right root agent from the graph, there's no reason to keep `ORCHESTRATOR_AGENT_SLUG = 'orchestrator'` as a literal string. It's the last place in the codebase where we say "the CEO is this specific slug" instead of "the CEO is whoever sits at the top of this subtree."

**What.** Replace the slug lookup in `server/jobs/orchestratorFromTaskJob.ts:21` with the scope resolver from 5.5. The resolver becomes the single canonical way to find the top agent for a given scope.

**Footprint.** Two-line change if 5.5 is in. Essentially a cleanup pass.

---

### 5.7 Team-template picker in subaccount creation

**Why.** The whole Paperclip moment — "pick a 6-agent preset and spin up the firm" — is one UI pattern away. All the backend verbs exist. We just don't offer the user a choice when creating a subaccount.

**What.** In the subaccount-creation form, add a "Starting team" picker that lists available hierarchy templates (system-shipped plus any the org has saved). On submit, create the subaccount and immediately call `POST /api/hierarchy-templates/:id/apply` with the new subaccount's ID. Include a "None / blank" option so existing workflows still work.

**Why this belongs in this brief.** A fully-functioning recursive delegation graph with no way to create a firm is an engineering demo, not a product. The template picker is the ergonomic payoff that makes the underlying work visible to the end user.

**Footprint.** One form field, one extra API call on submit, template list endpoint already exists.

## 6. Dependencies and suggested ordering

The recommendations split cleanly into three independently-shippable groups, with dependencies flowing in one direction:

- **Group A — runtime enforcement:** 5.1 → 5.2 → 5.3 → 5.4. Must be done in this order because 5.2 depends on 5.1, 5.3 depends on both, 5.4 depends on all three.
- **Group B — routing:** 5.5 → 5.6. 5.6 is a cleanup of 5.5.
- **Group C — UX:** 5.7. Independent of A and B once the backend verbs exist.

A and B don't depend on each other. You could ship Group B on its own and get per-subaccount CEOs without any changes to delegation. You could ship Group A on its own and get proper manager-scoped delegation inside the existing single-orchestrator routing. Both are valuable independently.

If we had to pick the single highest-leverage first step, it would be **5.5**. It's a small change, it unblocks per-subaccount CEOs immediately, and it creates the pressure that makes the rest of the work feel necessary rather than optional.

## 7. Out of scope

**Multi-tier seeded company.** We currently seed a flat 16-agent company (Orchestrator plus 15 direct reports). Restructuring that into a genuine 3-tier org chart (COO → department heads → specialists) is being designed on a separate track and is *not* part of this brief. The recommendations here are what that restructure will rely on to be functionally different from today's flat setup; without them, promoting four agents to "manager" titles would be theatre.

**Changes to the Universal Brief UX itself.** The global input bar, the polymorphic conversations table, the triage classifier — all the front-door infrastructure — is shipped and working. We're augmenting how it routes, not redesigning the surface.

**Permission and RLS changes.** Hierarchy-scoped delegation is enforced at the *skill execution* layer, not at the database row-level-security layer. RLS stays where it is. If a reviewer sees a reason to push enforcement down to RLS instead (or in addition), that's a conversation worth having but isn't assumed here.

**Multi-user threads on Briefs.** A colleague picking up another user's Brief chat is a known future need and schema-compatible, but nothing in this brief depends on or blocks it.

## 8. Open questions for the reviewer

1. **Default delegation scope.** For `spawn_sub_agents` and `reassign_task`, should the default be `'children'` (safer, tighter, may break existing prompts that assume flat delegation) or `'subaccount'` (backward-compatible, relies on prompt discipline to actually constrain managers to their subtree)? We lean `'subaccount'` for v1 but welcome a second opinion.

2. **Skill bundle as a first-class concept.** Is a named `delegation_kit` worth modelling as a new concept in the skill system — with storage, versioning, and template-style application — or is "auto-attach these three slugs by convention" enough? We lean convention for v1.

3. **Root-agent discovery.** Should there be exactly one root agent per subaccount (enforced by a partial unique index) or zero-or-more with a fallback? A strict "exactly one" rule is cleaner but forces migration of any currently-leafless subaccounts; zero-or-more is softer but opens ambiguity.

4. **Upward escalation.** If a worker receives a task it can't handle, should it be able to reassign *upward* to its parent, or only sideways / downward? Paperclip doesn't appear to formalise this. We'd default to "allowed, but rare, and visible in the run trace."

5. **Cross-subtree delegation.** When the Orchestrator decides a task filed under the Sales team actually belongs to Marketing, it needs to cross subtrees. Is that cleanly handled by reassigning at the Orchestrator level (parent of both), or does it warrant a distinct skill?

6. **Manager schedule.** Should manager agents run on the same heartbeat cadence as workers, or only on-demand when delegated to? (We lean "on-demand" — a manager with a schedule mostly burns tokens.)

7. **Token budget shape for managers.** Manager runs should be short (decompose + delegate). Do we set a default lower `tokenBudgetPerRun` for manager-tier agents, or let operators tune per-agent? Cheap default would be ~30% of a worker's budget.

8. **Hierarchy exposure to the user.** When a user talks to the CEO through the GlobalAskBar, should the chat ever surface intermediate delegations ("I asked the Head of Growth, who asked the Content agent, here's what came back")? Paperclip collapses this into a single CEO voice. We could go either way; we lean "collapsed by default, expandable for debugging."

