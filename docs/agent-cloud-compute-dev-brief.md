# Agent Cloud Compute — Development Brief

> **Status:** Rev 3 — incorporates external reviewer feedback. Self-contained. Ready for next stress-test pass.
> **Date:** 2026-05-07
> **Branch:** `claude/add-agent-cloud-compute-Kb4ii`
> **Audience:** Internal engineering, plus LLM and external reviewers without prior context.
> **Posture:** Strategic recommendation with stress-test framing. Recommendation is in §7 with full reasoning; §15 is the explicit "where this could be wrong" challenge surface.
> **What's new in Rev 3:** Pivots from a defensive "we don't need persistent VMs" stance to an offensive "Path C" strategy — Path B's architecture with Path A's presentation. Adds first-class Workspace UI as a product surface. Adds local/edge execution and state-as-moat as strategic assets. Reframes the entire recommendation around customer mental model rather than architectural purity.

---

## Contents

1. What this brief is and the question it answers
2. The market signal we're reacting to
3. Competitor landscape
4. The customer outcome being promised — functional and psychological
5. The strategic insight — psychology and architecture are different problems
6. The two purist paths (and why neither is right on its own)
7. The recommended path — Path C: architecture from B, presentation from A
8. Where we are today
9. Path C in detail
   - 9.1 Persistent Agent Workspace UI (first-class product surface)
   - 9.2 Session-scoped runtime persistence
   - 9.3 Workspace artifact store
   - 9.4 Capabilities and positioning rewrite
   - 9.5 Future option — Dedicated Agent Runtime tier
10. Strategic assets we have that competitors do not
11. Pros and cons of Path C — honestly
12. Three-path side-by-side comparison
13. What we explicitly will NOT do
14. Implementation order
15. Open questions and where this analysis could be wrong
16. Out of scope
17. Success criteria for v1

---

## 1. What this brief is and the question it answers

In May 2026, Manus shipped "Cloud Computers" — a one-click feature that gives every Manus agent its own persistent virtual machine. OpenClaw has been doing the same thing for months via VPS deployment, configured manually by power users. A widely-shared LinkedIn post on the day of Manus's launch framed this as the moment *"AI got its own desk"* and claimed *"every platform is racing to give AI agents persistent compute."*

The naive question is: *should Synthetos build per-agent persistent VMs?*

The right question, after one round of stress-testing, is:

> **How do Synthetos satisfy the customer's "AI employee with a computer" mental model while preserving the unit economics, multi-tenant fit, and architectural separation that already make us the right choice for the agency market?**

This brief proposes a strategy that does both. It lays out the market signal, the competitive landscape, the underlying customer psychology, the strategic insight that separates the architecture decision from the presentation decision, and the recommended path with a stress-testable implementation plan. Section 15 enumerates where the analysis could be wrong, intended to invite challenge from the next reviewer.

This is a brief, not a spec. If the recommendation is accepted, a spec follows for the components in §9.

## 2. The market signal we're reacting to

The post that triggered this brief makes five claims. Taken seriously rather than dismissed:

1. **Convergence claim.** *"The agentic AI space is converging on the same conclusion. AI agents need their own computers."*
2. **Pattern claim.** *"OpenClaw ships a capability for power users who can configure it themselves. Then closed platforms package it for everyone else."* (One-click VMs are becoming table stakes for consumer agent platforms.)
3. **Persistence claim.** *"Your AI doesn't just respond when you talk to it anymore. It has its own workspace. Its own files. Its own environment."*
4. **Independence claim.** *"It works while you sleep."*
5. **Inflection claim.** *"This was when everything changed. Not when AI got smarter. When AI got its own desk."*

Read literally, claims #1 and #3 are the genuinely strategic ones. Claim #2 is plausible but unproven. Claim #4 is a marketing reframe of capabilities most platforms (including Synthetos) already have under different names. Claim #5 is commentary, not data.

Read for the underlying psychology, the post is doing something more important: it is **conditioning the buyer's mental model**. Whether or not VMs are technically the right primitive, the market is rapidly settling on *"my AI has a computer"* as the default frame for reasoning about agent platforms. This frame is sticky, intuitive, and emotionally satisfying. Buyers will benchmark every platform against it, including platforms (like ours) that deliver the same outcomes through different primitives.

The strategic implication: **even if we believe the per-agent VM is the wrong architecture, we cannot ignore the frame, because customers are going to ask us about it.** The interesting question is whether we engage the frame on its terms or refuse it on ours. This brief argues for the former.

## 3. Competitor landscape

Honest about what we know versus what we're guessing. Where independent research is needed before final commitments, the brief flags it.

### 3.1 Manus
- **Pitch:** General-purpose AI agent. As of May 2026, every agent gets a one-click "Cloud Computer" — a dedicated VM that persists files, env, and state.
- **Strengths:** Polished UX, strong consumer-grade marketing, the new VM feature now bundled into the default experience (no configuration required).
- **Weaknesses we suspect but have not confirmed:** Likely high cost-per-customer (idle VMs), unclear multi-tenancy story, unclear how the VM model composes with team or agency use cases.
- **Customer profile:** Mass-market individual users and small teams running general agent tasks.
- **Research gap:** Pricing tiers, scale, real customer base size, retention. Worth a 30-minute research pass before the final recommendation is committed externally.

### 3.2 OpenClaw
- **Pitch:** Open-source agent platform. Power users configure their own VPS deployments per agent. The post's author claims to manage *"dozens of VPS running OpenClaw agents for clients."*
- **Strengths:** Customer-owned infrastructure, full control, persistent compute, scriptable.
- **Weaknesses:** Configuration burden falls on the operator. Not turnkey. The post itself frames this as a deliberate trade-off (*"for power users who can configure it themselves"*).
- **Customer profile:** Technical power users and agencies running multi-agent fleets on customer-owned infrastructure.
- **Research gap:** Whether OpenClaw is a real well-known project or a niche one. The post's framing suggests it's known in agency circles but not mass-market. Worth verifying before we cite it externally.

### 3.3 Adjacent players that shape the frame
- **Devin (Cognition Labs):** Code-focused agent that runs in its own sandboxed dev environment. Established the *"AI gets a workspace"* frame for engineering tasks specifically.
- **Replit Agent:** Coding agent inside a Replit workspace. Similar framing, narrower domain.
- **Claude Computer Use (Anthropic):** API-level capability for an agent to operate a computer interface. Does not bundle hosting; the customer brings their own compute. Closer to our IEE model.
- **AutoGPT and earlier OSS agent loops:** Run-on-your-laptop. Persistence comes from the user's local machine. Different tier; not a comparator.
- **OpenAI (eventually):** Strong probability that GPT-based agents will get a similar "persistent workspace" affordance within 12 months, given the trajectory of competitor pressure. This raises rather than lowers the urgency to engage the frame now.

### 3.4 What the landscape tells us
- The **pitch** is converging on *"your agent gets its own computer."*
- The **implementations** are not. Manus and OpenClaw bundle compute. Anthropic's Computer Use does not. Devin runs agents in an isolated dev environment, not a general-purpose VM.
- The framing layer is therefore **decoupled from the architecture layer** in practice. This is the gap Path C exploits.

## 4. The customer outcome being promised — functional and psychological

The competitive pitch is promising the customer two distinct categories of outcome. The brief's earlier revisions treated these as a single bundle. They are not.

### 4.1 Functional outcomes
1. **Persistent files.** Files the agent created or downloaded in one run are still there in the next run.
2. **Persistent env.** Packages, browser sessions, custom scripts, accumulated state survive between runs.
3. **Always-on availability.** The agent can be triggered or scheduled at any time without cold-start setup.
4. **Independence.** The agent does not need the user's laptop open; it works while the user sleeps.

These are measurable, deliverable outcomes. They can be satisfied by multiple architectures. Synthetos already partially delivers all four through different primitives (memory in DB, credentials layer, schedulers, sandboxed runtime).

### 4.2 Psychological outcomes
5. **Identity continuity.** The agent feels like *a thing that exists* rather than *a function that executes*.
6. **Ownership.** The agent has *its own* files, *its own* tools, *its own* workspace. The possessive matters emotionally.
7. **Mental-model legibility.** *"My agent has a computer"* is intuitive. The customer can picture where their stuff lives.
8. **Anthropomorphic resonance.** A digital employee with a desk feels like a colleague. A workflow with persistent state does not.

These outcomes are **not measurable, not deliverable through pure architecture, and not optional for competitive positioning.** They are the actual product the customer is buying. Earlier revisions of this brief treated them as a secondary concern. That was wrong. They are arguably the **primary** concern, and the architectural elegance of any alternative does not matter if the customer cannot feel it.

### 4.3 Why this distinction matters
A platform can deliver superior functional outcomes (#1-#4) and still lose to a competitor with sharper psychological outcomes (#5-#8). This has happened repeatedly in software history (Slack vs IRC, Notion vs wiki, Figma vs Sketch). The frame, the metaphor, and the surface that makes the underlying capability *feel real* are not aesthetic choices — they are the product.

The strategic implication: **the architecture decision and the presentation decision are separate decisions. They can have different right answers.** This is the insight the rest of the brief is built on.

## 5. The strategic insight — psychology and architecture are different problems

The natural assumption is that *"how the agent persists state"* and *"how the customer perceives the agent's persistence"* are the same problem with one answer. They are not.

| Layer | Question being answered | Optimised for |
|-------|------------------------|----------------|
| Architecture | How does state actually persist? | Cost, security, multi-tenancy, auditability, reversibility |
| Presentation | How does the customer perceive persistence? | Mental-model legibility, ownership feeling, identity continuity |

When these layers are conflated, the platform is forced to pick one of two losing positions:

- **Optimise architecture, ignore presentation.** Build the right primitives, lose deals to competitors with sharper marketing. (Earlier revisions of this brief defaulted toward this position.)
- **Optimise presentation, ignore architecture.** Match the marketing pitch with literal VMs, eat the unit-economics damage, lose long-term scalability and the multi-tenant fit that makes us the right product for the agency market.

The right move is to **separate the two decisions and optimise each independently**. The architecture problem has a clear right answer for our customer profile (workspace across primitives, not per-agent VMs). The presentation problem has a clear right answer for the market we're selling into (the agent has a workspace, files, tools, persistent identity — language matched to the buyer's mental model, not the implementation's mechanics).

Customers do not care whether persistence comes from:
- a literal VM
- object storage
- snapshots
- resumable containers
- a database
- state reconstruction at run time

They care whether:
- the agent remembers
- the agent continues from where it left off
- the agent has its own tools, files, and identity
- the agent feels persistent

The architecture-vs-presentation separation is what allows Synthetos to deliver the second list (which is the actual product) without committing to the wrong answer to the first list (which is the cost structure).

This insight is the foundation of Path C in §7.

## 6. The two purist paths (and why neither is right on its own)

To make the recommendation legible, the brief names two purist alternatives that are explicitly **not** the recommendation. Both are coherent strategies. Both are wrong for Synthetos in their pure form.

### 6.1 Path A — Match the frame literally
Ship a per-agent persistent VM as a first-class primitive. Compete on the same axes as Manus and OpenClaw. Adopt *"your agent has its own computer"* as the central pitch and back it with literal infrastructure.

- **Optimises for:** Marketing parity, customer mental-model match, lock-in via accumulated VM state.
- **Sacrifices:** Unit economics (idle compute), multi-tenant fit (VM-per-agent multiplies poorly across agency / subaccount / agent tiers), operational simplicity, auditability, security blast radius, reversibility.
- **Why it's wrong for Synthetos:** Our customer is an agency operating on behalf of clients, with multi-tier tenancy. A VM-per-agent model is structurally misaligned with that hierarchy. Idle compute cost compounds against gross margin as we scale. Once customers accumulate VM state, retreat is politically and technically painful — strategic optionality is destroyed.

### 6.2 Path B — Refuse the frame architecturally
Position our existing primitives (Config Documents, Connections, IEE, Schedulers, Skill Studio) as a coherent "agent workspace." Add session-scoped runtime persistence. Tell customers explicitly *"we do not run a persistent VM per agent — here's why."*

- **Optimises for:** Architectural cleanliness, unit economics, multi-tenant fit, auditability, reversibility.
- **Sacrifices:** Marketing legibility, customer mental-model match, sales-conversation efficiency, the emotional resonance of "AI employee with a desk."
- **Why it's wrong for Synthetos:** The market frame is real and not going away. Telling customers what we *do not* have is the wrong shape for a sales conversation. Buyers will hear *"missing feature"* even when the underlying capability is superior. Architectural rightness loses to mental-model rightness in the field, repeatedly, throughout software history.

### 6.3 The fork in the road
Both purist paths force a trade-off the customer should not be asked to make. The customer wants persistence (functional) **and** wants the agent to feel like a real entity with its own workspace (psychological). Path A gets the latter at the cost of the former. Path B gets the former at the cost of the latter. Both are coherent. Both lose.

The recommended path resolves this by separating the two layers and optimising each on its own terms.

## 7. The recommended path — Path C: architecture from B, presentation from A

> **Path C — Path B's architecture, Path A's presentation.**
> Build the workspace-across-primitives architecture (cheap, multi-tenant-clean, reversible, auditable). Present it to the customer as a Persistent Agent Workspace with files, tools, history, and continuity. Avoid VM semantics in product surface and in marketing copy. Use language that matches the customer's mental model without committing to the infrastructure that produces it.

### 7.1 The principle
**The customer's mental model is delivered by the surface, not by the substrate.** A workspace UI that shows the agent's files, browser sessions, memory, run history, and accumulated tools is *what makes the agent feel persistent* — regardless of whether the underlying compute is a VM, an ephemeral container, or reconstructed at run time from durable state.

This is not deception. It is abstraction. Every successful platform layer in software history sits between a higher-level customer mental model and a lower-level implementation that can change without breaking the metaphor. Path C does the same thing.

### 7.2 What Path C looks like to the customer
- The customer sees their agent has a **workspace**. The workspace has files, tools, browser sessions, credentials, run history, and accumulated capabilities.
- The customer sees the agent **continues from where it left off**. State persists across runs. Long-running tasks resume cleanly.
- The customer sees the agent **works while they sleep** via schedulers and triggers. Always-on without an idle server.
- The customer's pricing is *"you pay for compute when work happens, not when it doesn't"* — a direct competitive advantage versus VM-tier pricing.
- The customer never sees the words *"container,"* *"runtime,"* *"scheduler,"* or *"VM."* They see *"workspace,"* *"files,"* *"tools,"* *"history,"* *"memory."*

### 7.3 What Path C looks like to engineering
- IEE remains the runtime primitive. No new compute class.
- Sessions are added to IEE so multi-step tasks share a container until done. Container torn down at session end.
- An artifact store (object storage) holds workspace files addressable by run id and surfaced through the workspace UI.
- Memory continues to live in the database (Config Documents, Thread Context, Actor history). Credentials continue to live in Connections. Skills continue to live in Skill Studio.
- A new product surface — the **Persistent Agent Workspace UI** — composes those existing primitives into a single coherent view per agent.

### 7.4 What Path C explicitly preserves
- Unit economics: no idle compute, no per-agent infra multiplication.
- Multi-tenant fit: the existing agency / subaccount / agent hierarchy is unchanged.
- Auditability: state lives where operators can inspect it through the app.
- Reversibility: if customer demand later proves a warm-runtime tier is needed, §9.5 ships it as an additive premium offering. Path C does not foreclose Path A; Path A would foreclose Path C.
- Architectural separation: memory, credentials, runtime, skills remain cleanly separated.

### 7.5 The marketing posture
Path C does not say *"we don't have VMs."* Path C says:

> *"Every Synthetos agent has a persistent workspace, memory, files, credentials, and execution continuity. Compute spins up on demand, so customers only pay when work is happening."*

This sentence:
- Engages the buyer's mental model on its own terms.
- Names the persistence outcomes the buyer cares about.
- Reframes the "no idle VM" cost advantage as a feature, not a missing feature.
- Avoids any language that invites a head-on comparison with VM-tier products.

The marketing line is offensive, not defensive. That is the difference between Path B and Path C.

## 8. Where we are today

The primitives required to deliver Path C already exist in production. The work is composition and presentation, not net-new infrastructure.

### 8.1 Sandboxed Runtime (IEE)
`server/services/ieeExecutionService.ts`, `server/services/ieeUsageService.ts`, `server/jobs/ieeRunCompletedHandler.ts`. Fully sandboxed Docker containers for browser automation and org-level extensibility. Per-run cost tracking. Budget controls. Connection health validation against stored credentials. Containers are currently **per-run, not per-task** — each step of a multi-step task spins up a fresh container. This is the gap §9.2 closes.

### 8.2 Persistent agent memory
Config Documents (`docs/capabilities.md` § Knowledge Sharing & Reusable Context). Workspace-level reference material that informs every agent run. Persisted in the database, audited, multi-tenant-isolated.

### 8.3 Stable actor identity
`docs/capabilities.md` § Actor / identity model. Every agent is a stable actor with persistent identity across backend migrations. History, audit, and continuity survive even when the underlying compute changes.

### 8.4 Thread context panel
Per-conversation persistent context — task description, preferred approach, key decisions — that the agent reads at the start of every run.

### 8.5 Always-on workloads
Continuous enrichment, always-on health scoring, anomaly detection (`docs/capabilities.md` § Replaces / Consolidates). These are scheduler-driven, not VM-driven. **Research gap:** confirm the scheduler infrastructure is production-grade and load-tested, not aspirational. If the scheduler story is weaker than the doc implies, it becomes a v1 prerequisite for Path C.

### 8.6 Credentials and sessions
Connections + Connection Health Validation. Browser sessions and OAuth tokens are persisted in the credentials layer, not in a VM filesystem.

### 8.7 Spending and compute budgets
Two distinct budget primitives. Compute Budget caps LLM and runtime cost per workspace. Spending Budget governs money the agent moves on the client's behalf. Both already integrate with IEE runtime cost.

### 8.8 What we don't have (and Path C must add)
- A way to keep the same IEE container alive across multiple steps of a single task (§9.2).
- A canonical place for scratch artifacts addressable across runs (§9.3).
- A first-class **Persistent Agent Workspace UI** that composes the above into a single coherent surface per agent (§9.1).
- Public-facing positioning that frames the workspace using buyer-mental-model language rather than infrastructure language (§9.4).

### 8.9 What we should validate before committing
- **Customer demand signal.** Have any actual customers asked us for VMs? Absence of demand is data.
- **Competitive deal loss.** Have we lost named opportunities specifically because of the VM pitch? If yes, urgency rises sharply.
- **Scheduler maturity.** Are the always-on workloads in §8.5 actually load-tested or is the language aspirational?
- **Object storage strategy.** What bucket / provider / region model fits our existing infra? Pick before §9.3 specs are written.

## 9. Path C in detail

Five components. Listed in priority order. The first three are v1. The fourth ships in parallel. The fifth is reserved for future demand and explicitly not built now.

### 9.1 Persistent Agent Workspace UI (first-class product surface)

**This is the highest-leverage component in the brief.** It is what makes the customer mental model legible. Without it, the underlying primitives are invisible to the buyer and Path C collapses back into Path B's marketing problem.

Every agent gets a workspace surface. The surface composes existing primitives into one coherent view:

- **Files / Artifacts** — every file the agent has produced, downloaded, or accumulated, addressable by run and browsable as a tree. Backed by §9.3.
- **Memory** — Config Documents and accumulated context the agent has learned, presented as readable summaries, not raw rows.
- **Tools / Capabilities** — Skills the agent has installed or been granted, with version and last-used timestamp.
- **Connections** — credentials and OAuth links the agent uses, with health status (already in Connections layer).
- **Run history** — chronological list of what the agent has done, with links into each run's detail.
- **Active sessions** — what the agent is doing right now, if anything (powered by §9.2).
- **Schedule** — when the agent next runs, what triggers it, what it watches.

The surface uses the language of *files, tools, history, memory, schedule* — never *containers, runtimes, sessions, schedulers* in the customer view. Engineering surfaces (run logs, IEE diagnostics, cost breakdowns) sit beneath an "advanced" or "operator" tab.

Sized as a Significant task. UI work, plus thin services to aggregate the per-primitive data into a single workspace view. No new infrastructure.

### 9.2 Session-scoped runtime persistence

Today, each step of a multi-step task spins up a fresh IEE container. For a single logical task that runs across multiple steps (a long browser sequence, multi-page scrape, complex form submission with intermediate waits), this is wasteful and breaks any in-container state the agent built up.

Add a **session** primitive to IEE: a logical envelope that holds the same container alive across multiple step invocations within one task, then tears it down at task end and writes summarised state back to the workspace.

- New `iee_sessions` row created when a task begins; references the run, the actor, the budget context.
- IEE execution service checks for an active session before spawning a new container; if present, dispatches into the existing one.
- Idle timeout (default: minutes, not hours) tears the container down to control cost. Heartbeat extends the lease.
- At session end, a structured summary of "what happened in this session" is written to the run record. Durable artifacts are uploaded to the artifact store (§9.3).
- Per-run cost tracking continues to apply; the session is billed under the parent task's compute budget.

Sized as a Significant task. Most of the engineering risk in the brief lives here (container lifecycle, heartbeats, idle timeouts, leaked containers, cleanup races). Needs a real spec before implementation.

### 9.3 Workspace artifact store

Define the canonical answer to *"where do agent files go between runs?"* and build the thin service that backs it.

- Object storage bucket per workspace (per subaccount, in our tenancy model). Provider chosen during spec; likely matches our existing infra.
- Files addressable by `(workspace_id, run_id, path)`. Run records expose `artifact_url`.
- Thin service wrapping put / get / list / delete with multi-tenant isolation enforced at the service layer.
- Surfaced through the Workspace UI (§9.1) as the *Files* tab.
- Lifecycle policy: artifacts persist by default; per-workspace retention policy configurable; explicit delete from the UI.

Sized as a Standard task once the storage convention is picked. The wrapper is small; the harder work is the convention, the lifecycle policy, and the UI integration.

### 9.4 Capabilities and positioning rewrite

The product surface in §9.1 needs the language to match. Update `docs/capabilities.md` and any customer-facing surface that touches it:

- New top-level *Persistent Agent Workspace* capability section that names the workspace as a first-class product. Composes Workspace UI, Memory, Files, Connections, Tools, Schedule, Run History.
- IEE intro rewritten: lead with *"on-demand sandboxed compute that picks up where the last run left off"* rather than *"Docker containers for browser automation."*
- Replaces / Consolidates table updated with a row addressing hosted-VM-per-agent platforms. The pitch is positive: *"Persistent workspace, on-demand compute. Your agent remembers, continues, and only burns compute when work happens."*
- "Always-on" capability reframed as schedule + workspace state, not idle compute. Worded so it competes with the 24/7 VM pitch on the customer's terms (the agent works while you sleep) without conceding the infrastructure framing.
- **No anti-VM language.** The brief explicitly does not say *"we don't have VMs."* The presence of a positive workspace story makes the absence of VM language a non-event.

No code changes. Hours of writing. Highest leverage per hour of effort in the brief.

### 9.5 Future option — Dedicated Agent Runtime tier

Reserved for future demand. Not built in v1. Listed here so the strategic optionality is explicit.

If a future customer segment demonstrates sustained demand for genuinely warm always-on compute (sub-minute pollers, long-running watchers, heavy local tooling), introduce a **Dedicated Agent Runtime** tier. This is Path A's escape hatch, framed correctly:

- Marketed as *"Dedicated Agent Runtime"* or *"Always-On Workspace"* — never as *"VM."* The presentation layer stays consistent with §9.1.
- Priced as a premium tier with explicit budget caps and idle controls.
- Architecturally additive — the existing workspace and session model continue to work for everyone else.
- Triggered by validated demand, not by competitive anxiety. If we ship this prematurely we damage the unit economics that Path C exists to preserve.

The decision criterion for when to build §9.5: *we have lost or are at risk of losing N named deals where the customer has explicitly required warm dedicated compute, and where Path C's Workspace UI plus session persistence have been demonstrated and rejected.* Before that point, building §9.5 is solving a hypothetical.

## 10. Strategic assets we have that competitors do not

Path C is not just a defensible position. It compounds on assets Synthetos already has and that VM-centric competitors structurally cannot match. Naming them explicitly so they appear in marketing, sales conversations, and product roadmap decisions.

### 10.1 Multi-tenant agency fit
Synthetos's hierarchy is *Agency → Subaccounts → Agents → Tasks*. A VM-per-agent model multiplies operational complexity (lifecycle, observability, patching, isolation, abuse prevention, leaked resources, scaling, snapshotting, debugging, billing attribution) combinatorially across that hierarchy. Workspace-across-primitives composes cleanly into the same hierarchy without infrastructure explosion. **This is a structural advantage we should be selling.**

### 10.2 State as moat (not compute)
Compute is being commoditized fast. Memory, accumulated workflow state, artifact lineage, audit history, and organizational intelligence are not. The real long-term moat for an agent platform is the **persistent business context** the agent accumulates over time — *what it knows, what it's done, what worked, what didn't, who it spoke to, what it owns.* That state lives best in our database and our object storage, not in a VM filesystem the customer cannot easily query, audit, or back up. Path C builds the moat directly. Path A buries it inside compute primitives.

### 10.3 Local / edge execution trajectory
Probable medium-term market evolution: regulated industries, enterprise, privacy-sensitive workflows, browser automation against internal systems, and customer-owned compute will all push toward **local or edge execution** — agents running on customer infrastructure, not in vendor cloud. Synthetos's architecture (separated identity, memory, runtime, credentials, orchestration) is **already structured for portable execution.** A VM-centric competitor has tightly coupled their state to their cloud and cannot easily offer this. Path C preserves the option; Path A forecloses it.

### 10.4 Reversibility
Path C does not foreclose Path A. If demand materialises for warm dedicated compute, §9.5 ships it as a premium tier without disrupting the workspace model. Path A *would* foreclose Path C — once customers accumulate VM state, retreat is politically and technically painful. **When two paths are otherwise comparable, prefer the one that preserves optionality.**

### 10.5 Architectural separation as future-proofing
Workspace, memory, runtime, credentials, and skills are already cleanly separated in our architecture. This separation is what enables (a) per-tier billing accuracy, (b) selective upgrade of any one primitive without rewriting the others, (c) clean export/migration of customer state, (d) the local-execution path in §10.3. Path A collapses the separation back into one fuzzy primitive (the VM). Path C keeps the separation and exposes a unified surface above it — best of both.

### 10.6 Cost-of-goods advantage that compounds
No idle compute means our gross margin improves as we scale. A VM-centric competitor's gross margin **deteriorates** as their customer base grows (more idle VMs to fund). At scale, this becomes a structural pricing advantage we can either pass through (cheaper than competitors) or retain (better margins to fund product investment).

## 11. Pros and cons of Path C — honestly

Listed without spin. The reviewer pass on Rev 2 specifically called out the absence of an honest cons list. This time it is the heart of the section.

### 11.1 Pros
- **Delivers the customer mental model** without giving up unit economics. Solves the central tension that breaks the two purist paths.
- **Preserves all six strategic assets in §10.** Multi-tenant fit, state moat, local-execution path, reversibility, architectural separation, COGS advantage.
- **Cheap to ship.** Workspace UI is the most expensive component; the rest is composition of existing primitives. Total v1 timeline measured in weeks, not quarters.
- **Marketing posture is offensive, not defensive.** *"Persistent workspace, on-demand compute, you only pay when work happens"* is a positive pitch, not a refusal. Forces competitors to defend their cost structure rather than us defending our architecture.
- **No anti-competitor language required.** We never say *"we don't have VMs."* The Workspace UI makes the question moot.
- **Reversible.** §9.5 escape hatch is real. We can add warm-runtime tier later if demand proves it.

### 11.2 Cons
- **Workspace UI is the highest-leverage but also highest-execution-risk component.** A weak UI undermines the entire strategy. If the Workspace surface is bland, slow, or hides the persistence story poorly, customers will not feel the difference between us and a runtime-only platform — and Path C collapses back into Path B's marketing problem.
- **Marketing copy must be disciplined.** Sales conversations, docs, blog posts, and product copy all have to use workspace-language consistently. The moment any surface (or any salesperson) reverts to *"we don't run VMs"* framing, the offensive posture turns defensive.
- **Engineering risk on §9.2 (session-scoped runtime).** Container lifecycle is hairy. Heartbeats, idle timeouts, leaked containers, cleanup races, orphaned resources. Non-trivial chance of post-launch incidents. Needs careful spec and test coverage.
- **Customer education tax in adjacent buyer segments.** Sophisticated technical buyers may explicitly ask *"do you give the agent its own VM?"* and a workspace-language answer requires a follow-up explanation. We'll need a one-paragraph FAQ for those conversations.
- **Genuine workload gaps remain.** Sub-minute pollers, long-running watchers, heavy local tooling — these are awkward on schedulers + cold containers. Some prospects in those niches will be lost until §9.5 ships.
- **Risk of being psychologically right but visually wrong.** If competitors' workspace UIs are dramatically prettier or more feature-rich than ours, the underlying architecture advantage doesn't show through. UI quality is non-negotiable.
- **State-as-moat is a long-game bet.** It compounds over years, not quarters. In the short term, customers may not perceive its value. We have to be willing to lose some short-term deals to preserve the long-term moat.
- **Local-execution trajectory is a hypothesis, not a proven trend.** §10.3 may not materialise on the timeline assumed. If the market stays cloud-centric, that strategic asset is worth less than we're claiming.
- **Reversibility argument cuts both ways.** Yes, we can add §9.5 later. But adding it later costs sales velocity in the interim if competitors keep accumulating VM-tier customers in segments we'd want to win.

## 12. Three-path side-by-side comparison

| Axis | Path A — VM-per-agent | Path B — Workspace, no UI | Path C — Workspace + UI (recommended) |
|------|----------------------|---------------------------|----------------------------------------|
| Customer mental-model match | Strong (literal) | Weak (refuses the frame) | Strong (delivers via surface) |
| Marketing legibility | High | Low | High |
| Engineering effort to ship | Quarter-scale | Month-scale | ~Month-and-a-half-scale |
| Idle infra cost | High and scales with agent count | Near zero | Near zero |
| Multi-tenant fit | Strained | Natural | Natural |
| Auditability | Worse | Better | Better |
| Security blast radius | Larger | Smaller | Smaller |
| Long-running workload fit | Excellent | Awkward | Awkward in v1 (covered by §9.5 later) |
| Customer lock-in | Strong (VM state) | Moderate (DB state) | Moderate-to-strong (DB state + workspace surface) |
| Operational load | High | Moderate | Moderate (UI adds some) |
| Reversibility | Low | High | High |
| Differentiation 12 months out | Low (everyone has VMs) | High if cost-and-audit story lands | High (workspace-as-product is sticky) |
| Differentiation 12 months out if customer doesn't care about cost-and-audit | Low | Negative (looks like missing feature) | Neutral-to-positive (workspace surface delivers regardless) |
| Local-execution future fit | Poor (state coupled to VM) | Good (primitives separated) | Good (primitives separated) |
| State-as-moat alignment | Weak (state hidden in VM) | Strong (state visible in app) | Strong + visible to customer |

The bottom three rows are the live argument. **Path C wins on the conditional differentiation row that breaks Path B**, because the Workspace UI delivers the customer outcome regardless of whether the buyer cares about cost or audit. Path B wins only if buyers value architectural cleanliness; Path C wins regardless.

## 13. What we explicitly will NOT do

This section exists to keep the strategy honest and to keep the marketing posture disciplined.

### 13.1 We will not say "we don't have VMs"
This is the single most important discipline in the brief. The moment we frame our position as the absence of a competitor's feature, we have ceded the conversation. Sales conversations, docs, and product copy all describe what we *have* (workspace, memory, files, tools, history, on-demand compute) — never what we lack.

### 13.2 We will not ship per-agent persistent VMs in v1
Path A is rejected. Idle compute cost, multi-tenant strain, operational load, security blast radius, and reversibility loss all argue against it. Re-evaluation in §9.5 only if validated demand surfaces.

### 13.3 We will not expose raw VM, container, or runtime semantics in customer surfaces
The Workspace UI in §9.1 uses *files, tools, memory, history, schedule.* The words *container, runtime, session, scheduler, sandbox, VM* belong in operator surfaces (advanced tabs, run logs, cost breakdowns) — never in the default customer view.

### 13.4 We will not market a "click here to spin up a workspace" button mirroring Manus
The workspace exists by default for every agent. There is nothing to "spin up." A button implies infrastructure provisioning, which contradicts the on-demand-compute story. The workspace appears the moment an agent is created.

### 13.5 We will not introduce idle-compute pricing
Cost is per-run. *"You only pay when work happens"* is part of the pitch. Adding any idle-compute charge undermines the strategic positioning that Path C exists to preserve.

### 13.6 We will not build §9.5 (Dedicated Agent Runtime tier) prematurely
Premium warm-runtime tier is reserved for validated demand. Building it now solves a hypothetical and weakens the unit-economics story that differentiates us. Decision criterion in §9.5.

### 13.7 We will not adopt OpenClaw-style customer-managed VPS deployment
Different product surface, different customer profile, not a fit for our agency-on-behalf-of-clients model. Power users wanting their own VPS are not in our addressable market.

### 13.8 We will not try to deliver Path C purely through documentation
The Workspace UI is non-negotiable. A capabilities-doc rewrite without the product surface is Path B with extra steps. The customer must be able to *see* their agent's workspace in the app.

## 14. Implementation order

Five components, sequenced for risk reduction and earliest customer value. Each step is independently shippable; cumulative effect compounds.

### Phase 1 — Positioning and persistence model (Week 1)
- §9.4 Capabilities and positioning rewrite. No code changes; high leverage; prepares the language the Workspace UI in Phase 2 will use.
- §9.3 design only: pick the object-storage provider, name the convention, scope the artifact-store wrapper.

### Phase 2 — Workspace surface and artifact store (Weeks 2-4)
- §9.3 build: artifact-store wrapper, lifecycle policy, multi-tenant isolation tests.
- §9.1 build: Workspace UI v1. Files tab (backed by §9.3), Memory tab, Tools tab, Connections tab (read-only view of existing data), Run history tab.

### Phase 3 — Session-scoped runtime (Weeks 4-6)
- §9.2 build: `iee_sessions` table, session-aware execution dispatch, idle timeout, heartbeat, end-of-session summary write-back, artifact upload.
- High engineering risk concentrated here; spec authored before code.
- Workspace UI gains the Active Sessions tab when this lands.

### Phase 4 — Schedule surface and polish (Week 6+)
- Workspace UI gains the Schedule tab (composes existing scheduler primitives).
- End-to-end test of the customer narrative: create agent → workspace appears → agent runs multi-step task → mid-task state preserved → artifacts visible → next run picks up from where it left off.

### Reserved (no schedule)
- §9.5 Dedicated Agent Runtime tier. Built only on validated demand. Decision criterion in §9.5.

### Total
Roughly six weeks for v1 launchable, plus ongoing polish. Compares favourably to Path A's quarter-scale infrastructure build.

## 15. Open questions and where this analysis could be wrong

Designed to be challenged. The next reviewer should push hardest on these.

1. **Is the Workspace UI good enough to carry the strategy?** Path C depends on the surface delivering the customer's mental model. If the UI is bland, slow, or hides the persistence story poorly, the entire strategy collapses. UI quality is non-negotiable. Worth a design-review checkpoint mid-Phase 2.
2. **Can the marketing discipline hold?** *"We never say we don't have VMs"* requires consistent execution across every surface (sales, docs, blog, product copy). One slip and the offensive posture turns defensive. Is there a mechanism to enforce this?
3. **Does session-scoped runtime introduce operational risk we can't absorb?** Container lifecycle is hard. Have we underestimated the post-launch incident rate?
4. **Is the multi-tenant agency argument actually load-bearing for buyers?** This brief leans heavily on agency / subaccount fit as a structural advantage. If buyers are individual operators rather than agencies, the argument weakens.
5. **Are there segments where a workspace UI is insufficient and customers genuinely require warm dedicated compute?** §9.5 reserves the option, but the brief doesn't quantify how large those segments are. If they're large, §9.5 needs to ship sooner than "validated demand."
6. **Is the local-execution trajectory in §10.3 real or wishful?** The brief treats it as a probable medium-term market evolution. If it isn't, that strategic asset is worth less.
7. **Is state-as-moat sellable in the short term?** §10.2 is a long-game bet that compounds over years. Are we willing to lose short-term deals while it accumulates?
8. **Is there a hybrid Path A variant we haven't considered?** E.g. "shared workspace VM per subaccount with per-agent containers inside it." Could be cheaper than per-agent VMs and still support the marketing pitch. Not seriously evaluated; might deserve its own analysis if reviewers push.
9. **Have we lost named deals on the VM pitch already?** If yes, urgency rises sharply and §9.5 may need to ship in parallel with v1. If no, the brief's timeline holds.
10. **Is OpenAI's likely workspace move (referenced in §3.3) going to commoditize this faster than we expect?** If GPT-based agents get a one-click workspace within months, the differentiation window narrows. Path C still wins on cost and multi-tenancy, but the marketing edge shortens.
11. **Is the customer base actually asking for any of this?** This entire brief reasons from competitive signal, not from customer interviews. A handful of *"yes I want this / no I don't"* conversations would beat all of the analysis above.
12. **Does the Workspace UI compete for engineering attention with higher-priority work?** If shipping §9.1 displaces something more important on the roadmap, the opportunity cost may be higher than the strategic gain.

## 16. Out of scope

- **Pricing / billing redesign.** Compute Budget and Spending Budget already cover the cost model. Path C does not require pricing changes.
- **Cross-task container reuse.** A session is bounded by one logical task. Sharing containers across unrelated tasks introduces tenancy and cleanup risks not worth taking on in v1.
- **User-managed VPS deployment** in OpenClaw style. Different product surface, different customer profile, not a fit for our model.
- **Local-execution implementation.** §10.3 names it as a strategic asset. Implementing it is a separate brief.
- **Migration tooling for customers leaving competitor platforms.** Useful sales asset; not in scope here.
- **Integrations between Workspace UI and external file-sync products** (Dropbox, Google Drive, etc.). Worth a follow-up brief if customer demand surfaces.
- **Multi-agent shared workspaces** (a workspace shared by N agents on the same task). Interesting but distinct from the per-agent workspace this brief defines. Future work.

## 17. Success criteria for v1

A non-technical operator can:

- Create an agent and immediately see its **workspace** in the app, with empty Files / Memory / Tools / Connections / History tabs that fill as the agent works.
- Run a multi-step task taking hours, see mid-task state preserved, see end-of-task artifacts in the Files tab, and see the agent pick up cleanly on the next run from where it left off.
- Articulate, in their own words, *what their agent has* — without using infrastructure language. Test phrase: *"my agent has a workspace with files, tools, memory, and history."*
- Compare us against Manus or OpenClaw and pick us on a positive pitch: *"Synthetos agents have a persistent workspace and only burn compute when work happens."*

A reasonable internal observer can:

- Verify that no idle compute cost has been introduced by the v1 work.
- Verify the session-reuse mechanism does not leak containers under normal or adverse conditions.
- Confirm the marketing surface (capabilities doc, sales decks, product copy) uses workspace-language consistently and does not contain anti-VM phrasing.
- Confirm the brief's recommendation has aged well, or recognise when it has not, using §15 as the checklist.

A potential customer can:

- Read the capabilities doc and answer the question *"where does my agent's stuff live?"* without saying *"on a server somewhere."*
- See the workspace in a demo and feel that the agent is *a thing that exists*, not *a function that runs*.
- Hear the cost-and-continuity story and understand the structural advantage without us having to attack the competitor.

---

> **Note for the next reviewer.** This is Rev 3 of the brief. Rev 2 (the previous version) was structured as a stress-test between Path A (build VMs) and Path B (refuse the frame). The reviewer's central feedback on Rev 2 was that both purist paths force an unnecessary trade-off, and that the right move is *"Path B internally, Path A externally"* — architecture from B, presentation from A. Rev 3 incorporates that as Path C, adds the Persistent Agent Workspace UI as a first-class product surface, and restructures the recommendation around customer mental model rather than architectural purity. Section 15 lists where this version could still be wrong; please push hardest on those.
