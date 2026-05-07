# Agent Cloud Compute — Development Brief

> **Status:** Rev 5 — LOCKED. Strategy phase complete. Next moves are validation interviews, UX exploration, and the §10.2 session-persistence spec.
> **Date:** 2026-05-07
> **Branch:** `claude/add-agent-cloud-compute-Kb4ii`
> **Audience:** Internal engineering, plus LLM and external reviewers without prior context.
> **Posture:** Strategic recommendation. Recommendation is in §8 with full reasoning; §16 is the explicit "where this could be wrong" challenge surface. Conceptual iteration is closed; further revisions should arise only from new evidence, not from re-framing the existing argument.
> **What's new in Rev 5 (final):** Adds Phase 0 (Validation before commitment) to §15 with concrete activities — customer interviews, positioning A/B tests, workspace mockup reaction sessions, organic VM-language emergence test. Adds the UX expectation-ceiling risk to §12.2 cons (the ambient presence surface raises autonomy expectations; if agent behaviour underneath is shallow, the illusion breaks hard). Adds §14.9 explicit prohibition: this is NOT a "workspace UI project" — it is a positioning, platform-abstraction, and identity-layer project; the UI is the embodiment mechanism. Closing reviewer note updated to mark the brief as locked.
> **Strategic spine (carried from Rev 4):** §6 establishes that Synthetos is building a persistent operational identity layer for AI workers, not a compute platform. Compute is interchangeable underneath. §10.1 Workspace UI is the embodiment layer for that identity, with an ambient presence surface to keep the workspace feeling alive. §11.7 frames ephemeral compute as a more evolved architecture, not a cheap alternative.

---

## Contents

1. What this brief is and the question it answers
2. The market signal we're reacting to
3. Competitor landscape
4. The customer outcome being promised — functional and psychological
5. The strategic insight — psychology and architecture are different problems
6. The abstraction layer we are actually building
7. The two purist paths (and why neither is right on its own)
8. The recommended path — Path C: architecture from B, presentation from A
9. Where we are today
10. Path C in detail
    - 10.1 Persistent Agent Workspace UI — the embodiment layer
    - 10.2 Session-scoped runtime persistence
    - 10.3 Workspace artifact store
    - 10.4 Capabilities and positioning rewrite
    - 10.5 Future option — Dedicated Agent Runtime tier
11. Strategic assets we have that competitors do not
12. Pros and cons of Path C — honestly
13. Three-path side-by-side comparison
14. What we explicitly will NOT do
15. Implementation order
16. Open questions and where this analysis could be wrong
17. Out of scope
18. Success criteria for v1

---

## 1. What this brief is and the question it answers

In May 2026, Manus shipped "Cloud Computers" — a one-click feature that gives every Manus agent its own persistent virtual machine. OpenClaw has been doing the same thing for months via VPS deployment, configured manually by power users. A widely-shared LinkedIn post on the day of Manus's launch framed this as the moment *"AI got its own desk"* and claimed *"every platform is racing to give AI agents persistent compute."*

The naive question is: *should Synthetos build per-agent persistent VMs?*

The right question, after one round of stress-testing, is:

> **How do Synthetos satisfy the customer's "AI employee with a computer" mental model while preserving the unit economics, multi-tenant fit, and architectural separation that already make us the right choice for the agency market?**

This brief proposes a strategy that does both. It lays out the market signal, the competitive landscape, the underlying customer psychology, the strategic insight that separates the architecture decision from the presentation decision, and the recommended path with a stress-testable implementation plan. Section 15 enumerates where the analysis could be wrong, intended to invite challenge from the next reviewer.

This is a brief, not a spec. If the recommendation is accepted, a spec follows for the components in §10.

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

This insight is the foundation of §6 and Path C in §8.

## 6. The abstraction layer we are actually building

The recommendation in §8 follows from a deeper question that the brief should name explicitly: **what abstraction layer is Synthetos actually building?**

The competitive market is making it look like the answer is *"a compute platform with persistent VMs."* That is the wrong answer for our customer profile, but more importantly, it is the wrong **type** of answer. It describes infrastructure, not product.

### 6.1 What Synthetos is NOT building

Synthetos is not building:

- a VM platform
- a container platform
- a scheduler platform
- a runtime platform
- a sandbox platform

These are infrastructure layers. Some of them sit underneath what we ship; none of them is what the customer is buying.

### 6.2 What Synthetos IS building

Synthetos is building **a persistent operational identity layer for AI workers.**

That identity layer is composed of:

- **Workspace** — the persistent surface every agent has from the moment it exists.
- **Memory** — what the agent knows, has learned, has been told, has decided.
- **Files / Artifacts** — what the agent has produced, downloaded, accumulated.
- **Tools / Capabilities** — what the agent can do, what's been installed, what's been granted.
- **Credentials / Connections** — how the agent reaches the outside world.
- **History** — what the agent has done, organised chronologically and queryably.
- **Continuity** — the agent picks up where it left off, across runs, across days, across re-deployments.
- **Orchestration** — how the agent fits into a hierarchy, who delegates to it, who it reports to.

**Compute is interchangeable underneath.** Today it's IEE containers. Tomorrow it could be warm runtimes, edge execution, customer-owned hardware, model-provider-managed sandboxes, or something we haven't named yet. The compute layer changes; the identity layer persists.

### 6.3 Why this framing is strategically decisive

Once the question is *"what identity layer are we building?"* rather than *"do we need VMs?"*, several things resolve at once:

- **Compute commoditizes; identity compounds.** Every quarter, compute gets cheaper and more abundant. The moat is not in owning compute, it is in owning the persistent state that gives the agent meaning across runs. Path A bets on the commoditising layer. Path C bets on the compounding one.
- **Reversibility becomes obvious.** If compute is interchangeable, swapping IEE containers for a Dedicated Agent Runtime tier later (§10.5) is an *implementation detail*, not a product change. Path A would tie product identity to a specific compute primitive and lose this freedom.
- **The local-execution future fits naturally.** When regulated industries, enterprise buyers, or privacy-sensitive workloads push for execution on customer hardware (§11.3), the identity layer travels with the agent. The compute layer is replaced underneath. Path A cannot do this; the VM and the identity are the same object.
- **The workspace is identity instantiation, not infrastructure provisioning.** Every agent gets a workspace **the moment it is created** — not because we spun up a server, but because the agent now exists as an entity with its own state. There is no "provision compute" step. There is only "the agent now exists, and existing means having a workspace."

### 6.4 The principle in one sentence

> **Compute is something Synthetos uses. Identity is something Synthetos builds.**

Every product decision in this brief — Workspace UI as an embodiment layer (§10.1), session-scoped runtime (§10.2), artifact store (§10.3), positioning rewrite (§10.4), the Dedicated Agent Runtime tier as a future option rather than a foundational primitive (§10.5) — follows from this principle.

This is the strategic spine. Everything else in the brief is application.

## 7. The two purist paths (and why neither is right on its own)

To make the recommendation legible, the brief names two purist alternatives that are explicitly **not** the recommendation. Both are coherent strategies. Both are wrong for Synthetos in their pure form.

### 7.1 Path A — Match the frame literally
Ship a per-agent persistent VM as a first-class primitive. Compete on the same axes as Manus and OpenClaw. Adopt *"your agent has its own computer"* as the central pitch and back it with literal infrastructure.

- **Optimises for:** Marketing parity, customer mental-model match, lock-in via accumulated VM state.
- **Sacrifices:** Unit economics (idle compute), multi-tenant fit (VM-per-agent multiplies poorly across agency / subaccount / agent tiers), operational simplicity, auditability, security blast radius, reversibility.
- **Why it's wrong for Synthetos:** Our customer is an agency operating on behalf of clients, with multi-tier tenancy. A VM-per-agent model is structurally misaligned with that hierarchy. Idle compute cost compounds against gross margin as we scale. Once customers accumulate VM state, retreat is politically and technically painful — strategic optionality is destroyed.

### 7.2 Path B — Refuse the frame architecturally
Position our existing primitives (Config Documents, Connections, IEE, Schedulers, Skill Studio) as a coherent "agent workspace." Add session-scoped runtime persistence. Tell customers explicitly *"we do not run a persistent VM per agent — here's why."*

- **Optimises for:** Architectural cleanliness, unit economics, multi-tenant fit, auditability, reversibility.
- **Sacrifices:** Marketing legibility, customer mental-model match, sales-conversation efficiency, the emotional resonance of "AI employee with a desk."
- **Why it's wrong for Synthetos:** The market frame is real and not going away. Telling customers what we *do not* have is the wrong shape for a sales conversation. Buyers will hear *"missing feature"* even when the underlying capability is superior. Architectural rightness loses to mental-model rightness in the field, repeatedly, throughout software history.

### 7.3 The fork in the road
Both purist paths force a trade-off the customer should not be asked to make. The customer wants persistence (functional) **and** wants the agent to feel like a real entity with its own workspace (psychological). Path A gets the latter at the cost of the former. Path B gets the former at the cost of the latter. Both are coherent. Both lose.

The recommended path resolves this by separating the two layers and optimising each on its own terms.

## 8. The recommended path — Path C: architecture from B, presentation from A

> **Path C — Path B's architecture, Path A's presentation.**
> Build the workspace-across-primitives architecture (cheap, multi-tenant-clean, reversible, auditable). Present it to the customer as a Persistent Agent Workspace with files, tools, history, and continuity. Avoid VM semantics in product surface and in marketing copy. Use language that matches the customer's mental model without committing to the infrastructure that produces it.

### 8.1 The principle
**The customer's mental model is delivered by the surface, not by the substrate.** A workspace UI that shows the agent's files, browser sessions, memory, run history, and accumulated tools is *what makes the agent feel persistent* — regardless of whether the underlying compute is a VM, an ephemeral container, or reconstructed at run time from durable state.

This is not deception. It is abstraction. Every successful platform layer in software history sits between a higher-level customer mental model and a lower-level implementation that can change without breaking the metaphor. Path C does the same thing.

### 8.2 What Path C looks like to the customer
- The customer sees their agent has a **workspace**. The workspace has files, tools, browser sessions, credentials, run history, and accumulated capabilities.
- The customer sees the agent **continues from where it left off**. State persists across runs. Long-running tasks resume cleanly.
- The customer sees the agent **works while they sleep** via schedulers and triggers. Always-on without an idle server.
- The customer's pricing is *"you pay for compute when work happens, not when it doesn't"* — a direct competitive advantage versus VM-tier pricing.
- The customer never sees the words *"container,"* *"runtime,"* *"scheduler,"* or *"VM."* They see *"workspace,"* *"files,"* *"tools,"* *"history,"* *"memory."*

### 8.3 What Path C looks like to engineering
- IEE remains the runtime primitive. No new compute class.
- Sessions are added to IEE so multi-step tasks share a container until done. Container torn down at session end.
- An artifact store (object storage) holds workspace files addressable by run id and surfaced through the workspace UI.
- Memory continues to live in the database (Config Documents, Thread Context, Actor history). Credentials continue to live in Connections. Skills continue to live in Skill Studio.
- A new product surface — the **Persistent Agent Workspace UI** — composes those existing primitives into a single coherent view per agent.

### 8.4 What Path C explicitly preserves
- Unit economics: no idle compute, no per-agent infra multiplication.
- Multi-tenant fit: the existing agency / subaccount / agent hierarchy is unchanged.
- Auditability: state lives where operators can inspect it through the app.
- Reversibility: if customer demand later proves a warm-runtime tier is needed, §10.5 ships it as an additive premium offering. Path C does not foreclose Path A; Path A would foreclose Path C.
- Architectural separation: memory, credentials, runtime, skills remain cleanly separated.

### 8.5 The marketing posture
Path C does not say *"we don't have VMs."* Path C says:

> *"Every Synthetos agent has a persistent workspace, memory, files, credentials, and execution continuity. Compute spins up on demand, so customers only pay when work is happening."*

This sentence:
- Engages the buyer's mental model on its own terms.
- Names the persistence outcomes the buyer cares about.
- Reframes the "no idle VM" cost advantage as a feature, not a missing feature.
- Avoids any language that invites a head-on comparison with VM-tier products.

The marketing line is offensive, not defensive. That is the difference between Path B and Path C.

## 9. Where we are today

The primitives required to deliver Path C already exist in production. The work is composition and presentation, not net-new infrastructure.

### 9.1 Sandboxed Runtime (IEE)
`server/services/ieeExecutionService.ts`, `server/services/ieeUsageService.ts`, `server/jobs/ieeRunCompletedHandler.ts`. Fully sandboxed Docker containers for browser automation and org-level extensibility. Per-run cost tracking. Budget controls. Connection health validation against stored credentials. Containers are currently **per-run, not per-task** — each step of a multi-step task spins up a fresh container. This is the gap §10.2 closes.

### 9.2 Persistent agent memory
Config Documents (`docs/capabilities.md` § Knowledge Sharing & Reusable Context). Workspace-level reference material that informs every agent run. Persisted in the database, audited, multi-tenant-isolated.

### 9.3 Stable actor identity
`docs/capabilities.md` § Actor / identity model. Every agent is a stable actor with persistent identity across backend migrations. History, audit, and continuity survive even when the underlying compute changes.

### 9.4 Thread context panel
Per-conversation persistent context — task description, preferred approach, key decisions — that the agent reads at the start of every run.

### 9.5 Always-on workloads
Continuous enrichment, always-on health scoring, anomaly detection (`docs/capabilities.md` § Replaces / Consolidates). These are scheduler-driven, not VM-driven. **Research gap:** confirm the scheduler infrastructure is production-grade and load-tested, not aspirational. If the scheduler story is weaker than the doc implies, it becomes a v1 prerequisite for Path C.

### 9.6 Credentials and sessions
Connections + Connection Health Validation. Browser sessions and OAuth tokens are persisted in the credentials layer, not in a VM filesystem.

### 9.7 Spending and compute budgets
Two distinct budget primitives. Compute Budget caps LLM and runtime cost per workspace. Spending Budget governs money the agent moves on the client's behalf. Both already integrate with IEE runtime cost.

### 9.8 What we don't have (and Path C must add)
- A way to keep the same IEE container alive across multiple steps of a single task (§10.2).
- A canonical place for scratch artifacts addressable across runs (§10.3).
- A first-class **Persistent Agent Workspace UI** that composes the above into a single coherent surface per agent (§10.1).
- Public-facing positioning that frames the workspace using buyer-mental-model language rather than infrastructure language (§10.4).

### 9.9 What we should validate before committing
- **Customer demand signal.** Have any actual customers asked us for VMs? Absence of demand is data.
- **Competitive deal loss.** Have we lost named opportunities specifically because of the VM pitch? If yes, urgency rises sharply.
- **Scheduler maturity.** Are the always-on workloads in §9.5 actually load-tested or is the language aspirational?
- **Object storage strategy.** What bucket / provider / region model fits our existing infra? Pick before §10.3 specs are written.

## 10. Path C in detail

Five components. Listed in priority order. The first three are v1. The fourth ships in parallel. The fifth is reserved for future demand and explicitly not built now.

### 10.1 Persistent Agent Workspace UI — the embodiment layer

**This is the highest-leverage component in the brief.** It is what makes the customer mental model legible. Without it, the underlying primitives are invisible to the buyer and Path C collapses back into Path B's marketing problem.

> **The Workspace UI is not an administrative surface. It is the embodiment layer for the agent's persistent identity.**

Every agent gets a workspace **the moment it is created** — not because compute is provisioned, but because the agent now exists as an entity with its own state. There is no "spin up workspace" step. Workspace is identity instantiation, not infrastructure provisioning.

#### State surface — what the agent has
The workspace composes existing primitives into one coherent view:

- **Files / Artifacts** — every file the agent has produced, downloaded, or accumulated, addressable by run and browsable as a tree. Backed by §10.3.
- **Memory** — Config Documents and accumulated context the agent has learned, presented as readable summaries, not raw rows.
- **Tools / Capabilities** — Skills the agent has installed or been granted, with version and last-used timestamp.
- **Connections** — credentials and OAuth links the agent uses, with health status (already in Connections layer).
- **Run history** — chronological list of what the agent has done, with links into each run's detail.
- **Schedule** — when the agent next runs, what triggers it, what it watches.

#### Presence surface — what the agent is doing right now
The state surface alone makes the workspace feel **archival**. To make it feel **alive**, an *ambient presence* surface must run alongside it. This is what gives the customer the felt sense of *"my agent exists and is doing something,"* which is the psychological outcome a VM-tier competitor delivers through the visceral metaphor of a running computer.

Ambient presence components:

- **Active sessions** — what the agent is currently working on, with live step count, current tool call, and time elapsed. Powered by §10.2.
- **Heartbeat** — last-seen timestamp updated continuously when active; *"working,"* *"idle,"* *"scheduled to wake at X"* status pill in the workspace header.
- **Current focus** — one-line summary of what the agent is *thinking about right now*, surfaced from the active step or the most recent decision in the run trace.
- **Recent observations** — the last few notable things the agent learned, decided, or discovered, in plain language. Updated continuously, not only at run-end. Imagine: *"Found 47 new accounts matching the criteria. Two looked unusual; flagged for review."*
- **Active goals** — the open task or schedule the agent is currently advancing toward. Visible even when the agent is idle, so the workspace never feels empty.
- **Last activity feed** — short timeline of *"3 minutes ago started run X"*, *"2 hours ago completed task Y"*, *"yesterday updated memory entry Z."*

Together, the state surface and the presence surface deliver what the VM metaphor delivers in competitor products: *the agent is a thing that exists and is alive, with its own workspace, currently doing things.* The architectural difference (ephemeral compute vs. persistent VM) is invisible to the customer because both surfaces convey continuous existence.

#### Language discipline
The workspace uses the language of *files, tools, history, memory, schedule, working, focused on, recently learned* — never *containers, runtimes, sessions, schedulers, processes, jobs* in the customer view. Engineering surfaces (run logs, IEE diagnostics, cost breakdowns, container heartbeats) sit beneath an "advanced" or "operator" tab.

#### What v1 does not have to nail
The workspace is shipped iteratively. v1 needs the state surface and a minimum-viable ambient presence (active session + heartbeat + recent activity feed). Recent observations and current focus can ship in v1.1. Polishing the felt-aliveness is ongoing.

Sized as a Significant task. UI work, plus thin services to aggregate per-primitive data and stream presence updates. No new infrastructure.

### 10.2 Session-scoped runtime persistence

Today, each step of a multi-step task spins up a fresh IEE container. For a single logical task that runs across multiple steps (a long browser sequence, multi-page scrape, complex form submission with intermediate waits), this is wasteful and breaks any in-container state the agent built up.

Add a **session** primitive to IEE: a logical envelope that holds the same container alive across multiple step invocations within one task, then tears it down at task end and writes summarised state back to the workspace.

- New `iee_sessions` row created when a task begins; references the run, the actor, the budget context.
- IEE execution service checks for an active session before spawning a new container; if present, dispatches into the existing one.
- Idle timeout (default: minutes, not hours) tears the container down to control cost. Heartbeat extends the lease.
- At session end, a structured summary of "what happened in this session" is written to the run record. Durable artifacts are uploaded to the artifact store (§10.3).
- Per-run cost tracking continues to apply; the session is billed under the parent task's compute budget.

Sized as a Significant task. Most of the engineering risk in the brief lives here (container lifecycle, heartbeats, idle timeouts, leaked containers, cleanup races). Needs a real spec before implementation.

### 10.3 Workspace artifact store

Define the canonical answer to *"where do agent files go between runs?"* and build the thin service that backs it.

- Object storage bucket per workspace (per subaccount, in our tenancy model). Provider chosen during spec; likely matches our existing infra.
- Files addressable by `(workspace_id, run_id, path)`. Run records expose `artifact_url`.
- Thin service wrapping put / get / list / delete with multi-tenant isolation enforced at the service layer.
- Surfaced through the Workspace UI (§10.1) as the *Files* tab.
- Lifecycle policy: artifacts persist by default; per-workspace retention policy configurable; explicit delete from the UI.

Sized as a Standard task once the storage convention is picked. The wrapper is small; the harder work is the convention, the lifecycle policy, and the UI integration.

### 10.4 Capabilities and positioning rewrite

The product surface in §10.1 needs the language to match. Update `docs/capabilities.md` and any customer-facing surface that touches it:

- New top-level *Persistent Agent Workspace* capability section that names the workspace as a first-class product. Composes Workspace UI, Memory, Files, Connections, Tools, Schedule, Run History.
- IEE intro rewritten: lead with *"on-demand sandboxed compute that picks up where the last run left off"* rather than *"Docker containers for browser automation."*
- Replaces / Consolidates table updated with a row addressing hosted-VM-per-agent platforms. The pitch is positive: *"Persistent workspace, on-demand compute. Your agent remembers, continues, and only burns compute when work happens."*
- "Always-on" capability reframed as schedule + workspace state, not idle compute. Worded so it competes with the 24/7 VM pitch on the customer's terms (the agent works while you sleep) without conceding the infrastructure framing.
- **No anti-VM language.** The brief explicitly does not say *"we don't have VMs."* The presence of a positive workspace story makes the absence of VM language a non-event.

No code changes. Hours of writing. Highest leverage per hour of effort in the brief.

### 10.5 Future option — Dedicated Agent Runtime tier

Reserved for future demand. Not built in v1. Listed here so the strategic optionality is explicit.

If a future customer segment demonstrates sustained demand for genuinely warm always-on compute (sub-minute pollers, long-running watchers, heavy local tooling), introduce a **Dedicated Agent Runtime** tier. This is Path A's escape hatch, framed correctly:

- Marketed as *"Dedicated Agent Runtime"* or *"Always-On Workspace"* — never as *"VM."* The presentation layer stays consistent with §10.1.
- Priced as a premium tier with explicit budget caps and idle controls.
- Architecturally additive — the existing workspace and session model continue to work for everyone else.
- Triggered by validated demand, not by competitive anxiety. If we ship this prematurely we damage the unit economics that Path C exists to preserve.

The decision criterion for when to build §10.5: *we have lost or are at risk of losing N named deals where the customer has explicitly required warm dedicated compute, and where Path C's Workspace UI plus session persistence have been demonstrated and rejected.* Before that point, building §10.5 is solving a hypothetical.

## 11. Strategic assets we have that competitors do not

Path C is not just a defensible position. It compounds on assets Synthetos already has and that VM-centric competitors structurally cannot match. Naming them explicitly so they appear in marketing, sales conversations, and product roadmap decisions.

### 11.1 Multi-tenant agency fit
Synthetos's hierarchy is *Agency → Subaccounts → Agents → Tasks*. A VM-per-agent model multiplies operational complexity (lifecycle, observability, patching, isolation, abuse prevention, leaked resources, scaling, snapshotting, debugging, billing attribution) combinatorially across that hierarchy. Workspace-across-primitives composes cleanly into the same hierarchy without infrastructure explosion. **This is a structural advantage we should be selling.**

### 11.2 State as moat (not compute)
Compute is being commoditized fast. Memory, accumulated workflow state, artifact lineage, audit history, and organizational intelligence are not. The real long-term moat for an agent platform is the **persistent business context** the agent accumulates over time — *what it knows, what it's done, what worked, what didn't, who it spoke to, what it owns.* That state lives best in our database and our object storage, not in a VM filesystem the customer cannot easily query, audit, or back up. Path C builds the moat directly. Path A buries it inside compute primitives.

### 11.3 Local / edge execution trajectory
Probable medium-term market evolution: regulated industries, enterprise, privacy-sensitive workflows, browser automation against internal systems, and customer-owned compute will all push toward **local or edge execution** — agents running on customer infrastructure, not in vendor cloud. Synthetos's architecture (separated identity, memory, runtime, credentials, orchestration) is **already structured for portable execution.** A VM-centric competitor has tightly coupled their state to their cloud and cannot easily offer this. Path C preserves the option; Path A forecloses it.

### 11.4 Reversibility
Path C does not foreclose Path A. If demand materialises for warm dedicated compute, §10.5 ships it as a premium tier without disrupting the workspace model. Path A *would* foreclose Path C — once customers accumulate VM state, retreat is politically and technically painful. **When two paths are otherwise comparable, prefer the one that preserves optionality.**

### 11.5 Architectural separation as future-proofing
Workspace, memory, runtime, credentials, and skills are already cleanly separated in our architecture. This separation is what enables (a) per-tier billing accuracy, (b) selective upgrade of any one primitive without rewriting the others, (c) clean export/migration of customer state, (d) the local-execution path in §11.3. Path A collapses the separation back into one fuzzy primitive (the VM). Path C keeps the separation and exposes a unified surface above it — best of both.

### 11.6 Cost-of-goods advantage that compounds
No idle compute means our gross margin improves as we scale. A VM-centric competitor's gross margin **deteriorates** as their customer base grows (more idle VMs to fund). At scale, this becomes a structural pricing advantage we can either pass through (cheaper than competitors) or retain (better margins to fund product investment).

### 11.7 Ephemeral compute as a more evolved architecture
Ephemeral execution is not a compromise. It is the next stage of compute architecture for AI agents — and it deserves to be sold as such, not framed as the cheap alternative to VMs.

A persistent VM per agent is the *first* thing the market reached for because it maps cleanly onto the human metaphor of "a computer that runs." It is not the *best* thing. The same evolution has played out in every prior compute generation: dedicated mainframes gave way to virtualised servers, virtualised servers gave way to containers, containers gave way to functions and ephemeral runtimes. Every step was driven by the same realisation: **state and execution are different concerns and should be separated.**

Ephemeral compute, paired with a persistent identity layer, delivers:

- **Elastic scaling** — every agent can use as much or as little compute as the moment demands, without provisioning ceilings or idle cost.
- **Lower security persistence** — a compromised execution leaves no long-lived foothold; per-task containers are torn down at task end.
- **Lower idle cost** — by definition.
- **Stronger tenant isolation** — every execution starts from a known-clean state; no cross-tenant leak surface inside long-lived shared VMs.
- **Future portability** — the identity layer can move across cloud, edge, customer-managed, or model-provider-managed compute without changing the customer's experience of the agent.
- **Cleaner cost attribution** — every dollar of compute is attributable to a specific run, task, and tenant. With idle VMs, attribution becomes a billing fiction.

This is the framing to lean on in product copy and competitive conversations: *"Synthetos uses an ephemeral execution model — the more evolved compute architecture for autonomous agents — so customers get elastic scaling, stronger isolation, and pay only for compute that does work."* The phrase *"more evolved"* is doing real strategic work. It positions ephemeral compute as where the market is going, not as a stopgap for not having VMs.

## 12. Pros and cons of Path C — honestly

Listed without spin. The reviewer pass on Rev 2 specifically called out the absence of an honest cons list. This time it is the heart of the section.

### 12.1 Pros
- **Delivers the customer mental model** without giving up unit economics. Solves the central tension that breaks the two purist paths.
- **Preserves all six strategic assets in §11.** Multi-tenant fit, state moat, local-execution path, reversibility, architectural separation, COGS advantage.
- **Cheap to ship.** Workspace UI is the most expensive component; the rest is composition of existing primitives. Total v1 timeline measured in weeks, not quarters.
- **Marketing posture is offensive, not defensive.** *"Persistent workspace, on-demand compute, you only pay when work happens"* is a positive pitch, not a refusal. Forces competitors to defend their cost structure rather than us defending our architecture.
- **No anti-competitor language required.** We never say *"we don't have VMs."* The Workspace UI makes the question moot.
- **Reversible.** §10.5 escape hatch is real. We can add warm-runtime tier later if demand proves it.

### 12.2 Cons
- **Workspace UI is the highest-leverage but also highest-execution-risk component.** A weak UI undermines the entire strategy. If the Workspace surface is bland, slow, or hides the persistence story poorly, customers will not feel the difference between us and a runtime-only platform — and Path C collapses back into Path B's marketing problem.
- **Marketing copy must be disciplined.** Sales conversations, docs, blog posts, and product copy all have to use workspace-language consistently. The moment any surface (or any salesperson) reverts to *"we don't run VMs"* framing, the offensive posture turns defensive.
- **Engineering risk on §10.2 (session-scoped runtime).** Container lifecycle is hairy. Heartbeats, idle timeouts, leaked containers, cleanup races, orphaned resources. Non-trivial chance of post-launch incidents. Needs careful spec and test coverage.
- **Customer education tax in adjacent buyer segments.** Sophisticated technical buyers may explicitly ask *"do you give the agent its own VM?"* and a workspace-language answer requires a follow-up explanation. We'll need a one-paragraph FAQ for those conversations.
- **Genuine workload gaps remain.** Sub-minute pollers, long-running watchers, heavy local tooling — these are awkward on schedulers + cold containers. Some prospects in those niches will be lost until §10.5 ships.
- **Risk of being psychologically right but visually wrong.** If competitors' workspace UIs are dramatically prettier or more feature-rich than ours, the underlying architecture advantage doesn't show through. UI quality is non-negotiable.
- **State-as-moat is a long-game bet.** It compounds over years, not quarters. In the short term, customers may not perceive its value. We have to be willing to lose some short-term deals to preserve the long-term moat.
- **Local-execution trajectory is a hypothesis, not a proven trend.** §11.3 may not materialise on the timeline assumed. If the market stays cloud-centric, that strategic asset is worth less than we're claiming.
- **Reversibility argument cuts both ways.** Yes, we can add §10.5 later. But adding it later costs sales velocity in the interim if competitors keep accumulating VM-tier customers in segments we'd want to win.
- **Workspace without capability depth.** Path C bets on the abstraction layer (workspace, identity, presence) carrying the strategy. If competitors pair *their* workspace pitch with materially deeper underlying capability — better long-running reasoning, more autonomous planning, deeper tooling, more robust execution, longer-horizon goal pursuit — then a beautiful workspace surface over thinner execution loses on substance. **The workspace abstraction only wins if the underlying execution quality stays competitive.** This is the highest-priority risk to monitor; depth investment in the agent itself (planning, tools, autonomy, reliability) cannot be neglected while the workspace layer ships.
- **UX expectation ceiling.** The ambient presence surface (heartbeat, current focus, recent observations, active goals) makes the agent *feel* autonomous, present, and proactive. That felt-aliveness sets a customer expectation that the agent actually *is* autonomous, present, and proactive — i.e. that it takes initiative, anticipates, persists across context, and acts without prompting. If the agent behaves shallowly under that surface (brittle workflows, weak planning, repetitive behaviour, no real initiative), the illusion breaks hard and the workspace becomes evidence of overpromising rather than of strength. This is adjacent to the capability-depth risk in the previous bullet but specifically a **UX-expectation-management** risk: every step of presence surface we ship implicitly commits the agent to behave in a way that justifies the surface. Ship the presence layer in proportion to the agent's actual capability, not ahead of it.

## 13. Three-path side-by-side comparison

| Axis | Path A — VM-per-agent | Path B — Workspace, no UI | Path C — Workspace + UI (recommended) |
|------|----------------------|---------------------------|----------------------------------------|
| Customer mental-model match | Strong (literal) | Weak (refuses the frame) | Strong (delivers via surface) |
| Marketing legibility | High | Low | High |
| Engineering effort to ship | Quarter-scale | Month-scale | ~Month-and-a-half-scale |
| Idle infra cost | High and scales with agent count | Near zero | Near zero |
| Multi-tenant fit | Strained | Natural | Natural |
| Auditability | Worse | Better | Better |
| Security blast radius | Larger | Smaller | Smaller |
| Long-running workload fit | Excellent | Awkward | Awkward in v1 (covered by §10.5 later) |
| Customer lock-in | Strong (VM state) | Moderate (DB state) | Moderate-to-strong (DB state + workspace surface) |
| Operational load | High | Moderate | Moderate (UI adds some) |
| Reversibility | Low | High | High |
| Differentiation 12 months out | Low (everyone has VMs) | High if cost-and-audit story lands | High (workspace-as-product is sticky) |
| Differentiation 12 months out if customer doesn't care about cost-and-audit | Low | Negative (looks like missing feature) | Neutral-to-positive (workspace surface delivers regardless) |
| Local-execution future fit | Poor (state coupled to VM) | Good (primitives separated) | Good (primitives separated) |
| State-as-moat alignment | Weak (state hidden in VM) | Strong (state visible in app) | Strong + visible to customer |

The bottom three rows are the live argument. **Path C wins on the conditional differentiation row that breaks Path B**, because the Workspace UI delivers the customer outcome regardless of whether the buyer cares about cost or audit. Path B wins only if buyers value architectural cleanliness; Path C wins regardless.

## 14. What we explicitly will NOT do

This section exists to keep the strategy honest and to keep the marketing posture disciplined.

### 14.1 We will not say "we don't have VMs"
This is the single most important discipline in the brief. The moment we frame our position as the absence of a competitor's feature, we have ceded the conversation. Sales conversations, docs, and product copy all describe what we *have* (workspace, memory, files, tools, history, on-demand compute) — never what we lack.

### 14.2 We will not ship per-agent persistent VMs in v1
Path A is rejected. Idle compute cost, multi-tenant strain, operational load, security blast radius, and reversibility loss all argue against it. Re-evaluation in §10.5 only if validated demand surfaces.

### 14.3 We will not expose raw VM, container, or runtime semantics in customer surfaces
The Workspace UI in §10.1 uses *files, tools, memory, history, schedule.* The words *container, runtime, session, scheduler, sandbox, VM* belong in operator surfaces (advanced tabs, run logs, cost breakdowns) — never in the default customer view.

### 14.4 We will not market a "click here to spin up a workspace" button mirroring Manus
The workspace exists by default for every agent. There is nothing to "spin up." A button implies infrastructure provisioning, which contradicts the on-demand-compute story. The workspace appears the moment an agent is created.

### 14.5 We will not introduce idle-compute pricing
Cost is per-run. *"You only pay when work happens"* is part of the pitch. Adding any idle-compute charge undermines the strategic positioning that Path C exists to preserve.

### 14.6 We will not build §10.5 (Dedicated Agent Runtime tier) prematurely
Premium warm-runtime tier is reserved for validated demand. Building it now solves a hypothetical and weakens the unit-economics story that differentiates us. Decision criterion in §10.5.

### 14.7 We will not adopt OpenClaw-style customer-managed VPS deployment
Different product surface, different customer profile, not a fit for our agency-on-behalf-of-clients model. Power users wanting their own VPS are not in our addressable market.

### 14.8 We will not try to deliver Path C purely through documentation
The Workspace UI is non-negotiable. A capabilities-doc rewrite without the product surface is Path B with extra steps. The customer must be able to *see* their agent's workspace in the app.

### 14.9 We will not let this become a "workspace UI project"
Internally, this is the most insidious failure mode and it deserves a named prohibition. The easy reading of this brief — by an engineer scoping a sprint, a PM cutting a roadmap, or a stakeholder skimming for a deliverable — is *"build a Workspace UI."* That reading trivialises the strategic insight and quietly destroys the value of the brief.

This is not a workspace UI project. It is:

- A **product positioning** project — moving the entire conversation about Synthetos from *"agent platform"* to *"persistent operational identity layer for AI workers."*
- A **platform abstraction** project — establishing identity as the thing we own and compute as the thing we use, so future compute primitives (warm runtimes, edge execution, customer-managed hardware, model-provider sandboxes) compose underneath without disrupting product identity.
- An **identity layer** project — defining and surfacing the persistent state, memory, files, tools, history, and continuity that constitute an agent's existence.
- A **market framing** project — refusing the VM frame on its terms while delivering its outcomes through a sharper abstraction.

The Workspace UI is the **embodiment mechanism** for the identity layer. It is the most visible surface but not the deepest commitment. If the work ships as *"Workspace UI v1"* without the positioning rewrite, the abstraction discipline, the language standards, and the cross-team alignment on what Synthetos is actually building, we will have shipped a UI sprint and missed the strategy.

Operational guardrail: every Phase document, spec, sprint summary, and stakeholder update for this work names the strategic frame at the top — *"identity layer project, embodiment surface in flight"* — not *"workspace UI project, screens shipping."* The vocabulary discipline is part of the deliverable.

## 15. Implementation order

Six phases, sequenced for risk reduction and earliest customer value. Phase 0 is validation; Phases 1-4 are build; Phase 5 is reserved. Each step is independently shippable; cumulative effect compounds.

### Phase 0 — Validation before commitment (1-2 weeks)
The brief reasons from competitive signal, not from customer interviews. Before burning engineering on Phases 1-4, validate the thesis with concrete activities. Phase 0 is small, cheap, and non-negotiable — it protects against shipping a strategy customers don't actually want.

**Customer interviews (target N=10).** Existing customers across the agency-tier and individual-operator profile. Open-ended questions on:
- *"Where do you think your agent's stuff lives today?"* — tests whether the workspace mental model is missing or already implicit.
- *"What would change for you if your agent had its own persistent workspace?"* — tests whether persistence outcomes (functional + psychological) resonate.
- *"Do you think your agent should have its own VM?"* — tests whether VM language emerges organically. If customers don't reach for it, the marketing risk in §12.2 is overstated.
- *"How do you want to know what your agent is doing right now?"* — tests appetite for the ambient presence surface.

**Positioning A/B test (3 variants).** Across three sample marketing pages or sales decks, test:
- Variant A — *"Your agent has its own computer"* (Manus-style framing)
- Variant B — *"Persistent agent workspace, on-demand compute"* (Path C framing)
- Variant C — *"Synthetos is the persistent operational identity layer for AI workers"* (Rev 4 spine framing)

Measure click-through, sign-up intent, demo requests. Determine which framing actually converts buyers in our addressable market.

**Workspace mockup reaction sessions.** Click-through prototypes of §10.1 — state surface plus minimum-viable ambient presence. Run 5-7 sessions, observing whether customers describe what they see as *"my agent's workspace,"* *"my agent's computer,"* or something else. Their unprompted vocabulary is the signal.

**"Pay only when work happens" resonance test.** Across the same interviews and any pricing-sensitive sales conversations, listen for whether the cost-attribution story resonates as a feature or registers as a limitation. If buyers consistently shrug, the cost-and-audit differentiation is weaker than the brief assumes and Path C's offensive marketing posture needs adjustment.

**Competitive deal-loss audit.** Internal: review the last 6-12 months of lost deals. Tag any that reference VM-tier compute, dedicated runtimes, or the Manus / OpenClaw pitch as a stated reason. Quantifies whether §10.5 (Dedicated Agent Runtime tier) needs to ship in parallel with v1 or genuinely belongs deferred.

**Decision gate at end of Phase 0.** If validation contradicts the brief — e.g. customers consistently want VMs, refuse workspace framing, or care nothing about cost-and-audit — return to §16 and stress-test the thesis again before committing to Phases 1-4. Do not skip this gate to preserve timeline. The brief's recommendation is conditional on the thesis surviving customer contact.

### Phase 1 — Positioning and persistence model (Week 1)
- §10.4 Capabilities and positioning rewrite. No code changes; high leverage; prepares the language the Workspace UI in Phase 2 will use.
- §10.3 design only: pick the object-storage provider, name the convention, scope the artifact-store wrapper.

### Phase 2 — Workspace surface and artifact store (Weeks 2-4)
- §10.3 build: artifact-store wrapper, lifecycle policy, multi-tenant isolation tests.
- §10.1 build: Workspace UI v1. Files tab (backed by §10.3), Memory tab, Tools tab, Connections tab (read-only view of existing data), Run history tab.

### Phase 3 — Session-scoped runtime (Weeks 4-6)
- §10.2 build: `iee_sessions` table, session-aware execution dispatch, idle timeout, heartbeat, end-of-session summary write-back, artifact upload.
- High engineering risk concentrated here; spec authored before code.
- Workspace UI gains the Active Sessions tab when this lands.

### Phase 4 — Schedule surface and polish (Week 6+)
- Workspace UI gains the Schedule tab (composes existing scheduler primitives).
- End-to-end test of the customer narrative: create agent → workspace appears → agent runs multi-step task → mid-task state preserved → artifacts visible → next run picks up from where it left off.

### Reserved (no schedule)
- §10.5 Dedicated Agent Runtime tier. Built only on validated demand. Decision criterion in §10.5.

### Total
Roughly six weeks for v1 launchable, plus ongoing polish. Compares favourably to Path A's quarter-scale infrastructure build.

## 16. Open questions and where this analysis could be wrong

Designed to be challenged. The next reviewer should push hardest on these.

1. **Is the Workspace UI good enough to carry the strategy?** Path C depends on the surface delivering the customer's mental model. If the UI is bland, slow, or hides the persistence story poorly, the entire strategy collapses. UI quality is non-negotiable. Worth a design-review checkpoint mid-Phase 2.
2. **Can the marketing discipline hold?** *"We never say we don't have VMs"* requires consistent execution across every surface (sales, docs, blog, product copy). One slip and the offensive posture turns defensive. Is there a mechanism to enforce this?
3. **Does session-scoped runtime introduce operational risk we can't absorb?** Container lifecycle is hard. Have we underestimated the post-launch incident rate?
4. **Is the multi-tenant agency argument actually load-bearing for buyers?** This brief leans heavily on agency / subaccount fit as a structural advantage. If buyers are individual operators rather than agencies, the argument weakens.
5. **Are there segments where a workspace UI is insufficient and customers genuinely require warm dedicated compute?** §10.5 reserves the option, but the brief doesn't quantify how large those segments are. If they're large, §10.5 needs to ship sooner than "validated demand."
6. **Is the local-execution trajectory in §11.3 real or wishful?** The brief treats it as a probable medium-term market evolution. If it isn't, that strategic asset is worth less.
7. **Is state-as-moat sellable in the short term?** §11.2 is a long-game bet that compounds over years. Are we willing to lose short-term deals while it accumulates?
8. **Is there a hybrid Path A variant we haven't considered?** E.g. "shared workspace VM per subaccount with per-agent containers inside it." Could be cheaper than per-agent VMs and still support the marketing pitch. Not seriously evaluated; might deserve its own analysis if reviewers push.
9. **Have we lost named deals on the VM pitch already?** If yes, urgency rises sharply and §10.5 may need to ship in parallel with v1. If no, the brief's timeline holds.
10. **Is OpenAI's likely workspace move (referenced in §3.3) going to commoditize this faster than we expect?** If GPT-based agents get a one-click workspace within months, the differentiation window narrows. Path C still wins on cost and multi-tenancy, but the marketing edge shortens.
11. **Is the customer base actually asking for any of this?** This entire brief reasons from competitive signal, not from customer interviews. A handful of *"yes I want this / no I don't"* conversations would beat all of the analysis above.
12. **Does the Workspace UI compete for engineering attention with higher-priority work?** If shipping §10.1 displaces something more important on the roadmap, the opportunity cost may be higher than the strategic gain.
13. **Workspace without capability depth — are we ahead or behind on the underlying agent capability?** Path C bets that the abstraction layer carries the strategy. If competitors pair their workspace pitch with materially deeper underlying capability (better long-running reasoning, autonomous planning, deeper tooling, longer-horizon goal pursuit), the workspace surface alone is not enough. **Where are we on agent capability depth versus Manus, Devin, OpenAI? Honest assessment required.** If we're behind, Path C buys us positioning time but capability investment becomes the urgent track in parallel.
14. **Is the ambient presence surface technically achievable on our current run-trace pipeline?** *Current focus,* *recent observations,* and live activity feeds require the agent's reasoning trace to be summarisable in near-real-time. If our run telemetry is batch-only or too low-fidelity, the presence surface ships shallow and the workspace feels archival. Worth a feasibility check before §10.1 v1 is scoped.

## 17. Out of scope

- **Pricing / billing redesign.** Compute Budget and Spending Budget already cover the cost model. Path C does not require pricing changes.
- **Cross-task container reuse.** A session is bounded by one logical task. Sharing containers across unrelated tasks introduces tenancy and cleanup risks not worth taking on in v1.
- **User-managed VPS deployment** in OpenClaw style. Different product surface, different customer profile, not a fit for our model.
- **Local-execution implementation.** §11.3 names it as a strategic asset. Implementing it is a separate brief.
- **Migration tooling for customers leaving competitor platforms.** Useful sales asset; not in scope here.
- **Integrations between Workspace UI and external file-sync products** (Dropbox, Google Drive, etc.). Worth a follow-up brief if customer demand surfaces.
- **Multi-agent shared workspaces** (a workspace shared by N agents on the same task). Interesting but distinct from the per-agent workspace this brief defines. Future work.

## 18. Success criteria for v1

A non-technical operator can:

- Create an agent and immediately see its **workspace** in the app, with empty Files / Memory / Tools / Connections / History tabs that fill as the agent works.
- Run a multi-step task taking hours, see mid-task state preserved, see end-of-task artifacts in the Files tab, and see the agent pick up cleanly on the next run from where it left off.
- Articulate, in their own words, *what their agent has* — without using infrastructure language. Test phrase: *"my agent has a workspace with files, tools, memory, and history."*
- Compare us against Manus or OpenClaw and pick us on a positive pitch: *"Synthetos agents have a persistent workspace and only burn compute when work happens."*

A reasonable internal observer can:

- Verify that no idle compute cost has been introduced by the v1 work.
- Verify the session-reuse mechanism does not leak containers under normal or adverse conditions.
- Confirm the marketing surface (capabilities doc, sales decks, product copy) uses workspace-language consistently and does not contain anti-VM phrasing.
- Confirm the brief's recommendation has aged well, or recognise when it has not, using §16 as the checklist.

A potential customer can:

- Read the capabilities doc and answer the question *"where does my agent's stuff live?"* without saying *"on a server somewhere."*
- See the workspace in a demo and feel that the agent is *a thing that exists*, not *a function that runs*.
- Hear the cost-and-continuity story and understand the structural advantage without us having to attack the competitor.

---

> **Note for future readers — brief is LOCKED at Rev 5.**
>
> Iteration history: Rev 2 stress-tested Path A (build VMs) against Path B (refuse the frame). Rev 3 introduced Path C (Path B's architecture, Path A's presentation) after a reviewer pointed out both purist paths forced an unnecessary trade-off. Rev 4 added the strategic spine in §6 — Synthetos is building a *persistent operational identity layer for AI workers*, with compute interchangeable underneath — and reframed the Workspace UI in §10.1 as the embodiment layer for that identity, with an ambient presence surface to keep it feeling alive. Rev 5 (this version) closes out the strategy phase: adds Phase 0 validation in §15, the UX expectation-ceiling risk in §12.2, and the §14.9 prohibition against treating this as a "workspace UI project."
>
> The brief is now considered conceptually complete. Further conceptual revisions should arise only from new evidence (Phase 0 validation results, competitive shifts, customer signal) — not from re-framing the existing argument. The next moves are operational, not editorial:
>
> 1. **Phase 0 validation** (§15) — customer interviews, positioning A/B, workspace mockup sessions, deal-loss audit. **Decision gate** at the end of Phase 0; if validation contradicts the thesis, return to §16 and re-stress before committing to Phases 1-4.
> 2. **Workspace UX exploration** — design-level prototyping of the embodiment surface, including the ambient presence components, before locking §10.1 v1 scope.
> 3. **Technical feasibility spike** — confirm the run-trace pipeline can support ambient presence (current focus, recent observations) in near-real-time. Names a concrete go/no-go input for §10.1 scope.
> 4. **Capability roadmap alignment** — explicit pairing with whatever depth investment is happening on agent capability (planning, autonomy, reliability), so §12.2's *workspace-without-capability-depth* risk is tracked rather than assumed away.
> 5. **§10.2 session-persistence spec** — the only piece of v1 that needs a real engineering spec before code; carry the brief's principles into it directly.
>
> If a future reviewer encounters this document, the highest-value thing they can do is push on §16 (Open Questions) with **new evidence**, not new framings. The framings have been worked.
