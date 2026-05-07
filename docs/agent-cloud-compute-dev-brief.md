# Agent Cloud Compute — Development Brief

> **Status:** Rev 2 — stress-test shape. Pre-spec, pre-review.
> **Date:** 2026-05-07
> **Branch:** `claude/add-agent-cloud-compute-Kb4ii`
> **Audience:** Internal engineering, plus LLM and external reviewers without prior context.
> **Posture:** Neutral. Two paths laid out in parallel with pros and cons, recommendation last. Designed to be stress-tested, not defended.

---

## Contents

1. What this brief is
2. The market signal we're reacting to
3. Competitor landscape
4. The customer outcome being promised
5. The two paths — overview
6. Where we are today
7. Path A — per-agent persistent VM
8. Path B — workspace across primitives + session-scoped runtime
9. Side-by-side comparison
10. Recommendation
11. If we choose Path B — what we'd actually build
12. Open questions and where this analysis could be wrong
13. Out of scope
14. Success criteria for v1

---

## 1. What this brief is

In May 2026, Manus shipped "Cloud Computers" — a one-click feature that gives every Manus agent its own persistent virtual machine. OpenClaw has been doing the same thing for months via VPS deployment, configured manually by power users. A widely-shared post on the day of Manus's launch framed this as the moment *"AI got its own desk"* and claimed *"every platform is racing to give AI agents persistent compute."*

This brief asks one question: **does Synthetos need to ship a per-agent persistent VM to remain competitive, or can our existing primitives deliver the same customer outcome more cheaply and with better fit to our architecture?**

The brief is structured for stress-testing. It does not start from the answer. Sections 7 and 8 lay out the two paths in parallel with their pros and cons. The recommendation is in §10. Section 12 is an honest list of where this analysis could be wrong, intended to invite challenge from reviewers.

This is a brief, not a spec. If a path is chosen, the spec follows.

## 2. The market signal we're reacting to

The post that triggered this brief makes five claims worth taking seriously:

1. **Convergence claim.** *"The agentic AI space is converging on the same conclusion. AI agents need their own computers."*
2. **Pattern claim.** *"OpenClaw ships a capability for power users who can configure it themselves. Then closed platforms package it for everyone else."* (i.e. one-click VMs are now table stakes)
3. **Persistence claim.** *"Your AI doesn't just respond when you talk to it anymore. It has its own workspace. Its own files. Its own environment."*
4. **Independence claim.** *"It works while you sleep."*
5. **Inflection claim.** *"This was when everything changed. Not when AI got smarter. When AI got its own desk."*

Some of these are real product trends. Some are LinkedIn-thinkfluencer compression. The brief takes #1 and #3 as genuine signals, treats #2 as plausible but not proven, treats #4 as a marketing reframe of capabilities we already have, and treats #5 as commentary, not data.

What matters strategically: the **language** of "your agent has its own computer" is becoming the default frame for how non-technical buyers reason about agent platforms. Even if we believe the per-agent VM is the wrong primitive, we have to engage the frame, because customers are going to ask us about it.

## 3. Competitor landscape

This section aims to be honest about what we know and what we're guessing. Where research is needed before final decisions, the brief flags it.

### 3.1 Manus
- **Pitch:** General-purpose AI agent. As of May 2026, every agent gets a one-click "Cloud Computer" — a dedicated VM that persists files, env, and state.
- **Strengths:** Polished UX, strong consumer-grade marketing, the new VM feature now bundled into the default experience (no configuration required).
- **Weaknesses we suspect but have not confirmed:** Likely high cost-per-customer (idle VMs), unclear multi-tenancy story, unclear how the VM model composes with team / agency use cases.
- **Customer profile:** Mass-market individual users and small teams running general agent tasks.
- **Research gap:** Pricing tiers, scale, real customer base size, retention. Worth a 30-minute research pass before final decisions.

### 3.2 OpenClaw
- **Pitch:** Open-source agent platform. Power users configure their own VPS deployments per-agent. The post's author, Clarence at VA Staffer, claims to manage *"dozens of VPS running OpenClaw agents for clients."*
- **Strengths:** Customer-owned infrastructure, full control, persistent compute, scriptable.
- **Weaknesses:** Configuration burden falls on the operator. Not turnkey. The post itself frames this as a deliberate trade-off ("for power users who can configure it themselves").
- **Customer profile:** Technical power users and agencies running multi-agent fleets on customer-owned infrastructure.
- **Research gap:** Whether OpenClaw is a real well-known project or a niche one. The post's framing suggests it's known in agency circles but not mass-market. Worth checking before we cite it externally.

### 3.3 Adjacent players (not direct, but shape the frame)
- **Devin (Cognition Labs):** Code-focused agent that runs in its own sandboxed dev environment. Established the "AI gets a workspace" frame for engineering-tasks specifically.
- **Replit Agent:** Coding agent inside a Replit workspace. Similar framing, narrower domain.
- **Claude Computer Use (Anthropic):** API-level capability for an agent to operate a computer interface. Does NOT bundle hosting; the customer brings their own compute. This is closer to our IEE model.
- **AutoGPT / earlier OSS agent loops:** Run-on-your-laptop. Persistence comes from the user's local machine. Different tier; not a comparator.

### 3.4 What the landscape is telling us
- The **pitch** is converging on "your agent gets its own computer."
- The **implementations** are not. Manus and OpenClaw bundle compute. Anthropic's Computer Use does not. Devin runs agents in an isolated dev environment, not a general-purpose VM.
- This means the framing is up for grabs. There's room for *"your agent has a workspace, not a server"* if the message lands well — but there's also risk that customers don't bother distinguishing and we lose deals to the simpler pitch.

## 4. The customer outcome being promised

Stripping away the marketing, the per-agent-VM pitch is promising five concrete things to the customer:

1. **Persistent files.** Files the agent created or downloaded in one run are still there in the next run.
2. **Persistent env.** Packages, browser sessions, custom scripts, accumulated state survive between runs.
3. **Always-on availability.** The agent can be triggered or scheduled at any time without cold-start setup.
4. **Independence.** The agent does not need the user's laptop open. It works while the user sleeps.
5. **Mental-model legibility.** "My agent has a computer" is intuitive. The user knows where their stuff is.

These are five distinct customer needs. The Manus / OpenClaw answer maps all five onto one primitive (a VM). The Synthetos answer would have to address all five too — but not necessarily with the same primitive.

Outcomes #1 through #4 are functional and measurable. Outcome #5 is **psychological and is the hardest one to compete on.** A platform can deliver superior #1-4 and still lose to a competitor with a sharper #5.

## 5. The two paths — overview

There are essentially two product strategies on the table:

**Path A — Match the frame.** Ship a per-agent persistent VM as a first-class primitive. Compete on the same axes as Manus and OpenClaw. Buy into "your agent has its own computer" as the central pitch.

**Path B — Reframe.** Position our existing primitives (sandboxed runtime, persistent memory in the app, credentials layer, schedulers) as a coherent "agent workspace" that delivers outcomes #1-4 without an idle VM. Compete on cost, auditability, and multi-tenant fit. Accept the harder marketing job in exchange for a structurally cheaper product.

A third path — *"do nothing, wait and see"* — is implicitly available but not seriously evaluated here, because the positioning gap exists today and concedes the narrative if left unaddressed.

The next two sections lay out Path A and Path B with pros and cons in parallel. Section 9 compares them side by side. Section 10 makes a recommendation.

## 6. Where we are today

Synthetos already ships, in production, the primitives that bear on this question:

### 6.1 Sandboxed Runtime (IEE)
`server/services/ieeExecutionService.ts`, `server/services/ieeUsageService.ts`, `server/jobs/ieeRunCompletedHandler.ts`. Fully sandboxed Docker containers for browser automation and org-level extensibility. Per-run cost tracking. Budget controls. Connection health validation against stored credentials. Containers are currently **per-run, not per-task** — each step of a multi-step task spins up a fresh container.

### 6.2 Persistent agent memory
Config Documents (`docs/capabilities.md` § Knowledge Sharing & Reusable Context). Workspace-level reference material that informs every agent run. Persisted in our database, audited, multi-tenant-isolated.

### 6.3 Stable actor identity
`docs/capabilities.md` § Actor / identity model. Every agent is a stable actor with persistent identity across backend migrations. History, audit, and continuity survive even when the underlying compute changes.

### 6.4 Thread context panel
Per-conversation persistent context — task description, preferred approach, key decisions — that the agent reads at the start of every run.

### 6.5 Always-on workloads
Continuous enrichment, always-on health scoring, anomaly detection (`docs/capabilities.md` § Replaces / Consolidates). These are scheduler-driven, not VM-driven. **Research gap:** confirm the scheduler infrastructure is real and load-tested, not aspirational.

### 6.6 Credentials and sessions
Connections + Connection Health Validation. Browser sessions and OAuth tokens are persisted in the credentials layer, not in a VM filesystem.

### 6.7 Spending and compute budgets
Two distinct budget primitives. Compute Budget caps LLM and runtime cost per workspace. Spending Budget governs money the agent moves on the client's behalf. Both already integrate with IEE runtime cost.

### 6.8 What we don't have
- A way to keep the same IEE container alive across multiple steps of a single task.
- A canonical place for scratch artifacts (downloaded files, intermediate CSVs) addressable across runs.
- Public-facing positioning that frames the above as a coherent "agent workspace."
- Customer demand signal: have any actual customers asked us for VMs? Worth checking before deciding. Absence of demand is data.

## 7. Path A — per-agent persistent VM

Ship a dedicated VM per agent (or per workspace, scoped tightly), with a one-click "create your agent's computer" UX modelled on Manus. The VM holds files, env, browser state, and accumulated work between runs.

### 7.1 What we'd build
- A VM provisioning service (likely on top of a hosting partner: Fly Machines, GCE, or similar) with per-agent or per-workspace isolation.
- A lifecycle manager: provision on agent creation, suspend on idle, resume on activity, decommission on agent deletion.
- A workspace browser UI: file explorer, env inspection, session history.
- A pricing tier that covers the new infra cost.
- Migration tooling: existing IEE container behaviour either deprecates or composes with the new VM model.

### 7.2 Pros
- **Marketing parity.** The pitch *"your agent has its own computer"* is available to us in the same words competitors use. Easy to sell, easy to explain, no re-education required.
- **Power-user appeal.** Agency operators running 20+ agents (the OpenClaw customer profile in the post) get an obvious upgrade path from self-managed VPS to managed-by-us VM.
- **Genuine answer to long-running processes.** A watcher on a VM that polls every 30 seconds is straightforward; on schedulers + cold containers it's awkward.
- **Customer lock-in via state accumulation.** Once a customer's agent has weeks of accumulated state on a VM, switching costs are high. This is an asset.
- **Future-proofing for niche workloads.** Some workloads (real-time data pipelines, long-running model fine-tuning, heavy local tooling) genuinely need warm compute.

### 7.3 Cons
- **High idle cost.** A VM idling at $X/hour for an agent that runs 30 minutes a day is wasteful. At scale across many tenants, this materially changes our gross margin.
- **Multi-tenancy strain.** Our model is *agency runs N subaccounts, each subaccount has M agents*. A VM-per-agent model multiplies. Aggregating to "VM per subaccount" or "VM per agency" weakens the marketing pitch.
- **Operational surface area increase.** VM lifecycle, snapshotting, backup, security patching, OS upgrades become our problem. Container lifecycle is hard; VM lifecycle is harder.
- **Auditability regression.** State on a VM filesystem is harder to inspect than state in a database. We lose a structural advantage we currently have.
- **Security blast radius.** A persistent VM compromised by an agent action can persist that compromise across runs. A per-run container does not.
- **Cost-of-goods passthrough.** We either eat the infra cost (worse margins) or pass it through (higher prices). Both options are bad for an agency-tier product where the buyer is cost-sensitive.
- **Disagrees with our existing architecture story.** We've built a clean separation of memory (DB), credentials (Connections), runtime (IEE), and skills (Skill Studio). VMs collapse those back into one fuzzy primitive.

### 7.4 Cost model (rough)
- Idle VM (Fly Machines or similar small instance): ~$5-15/month per agent, depending on size. Scales linearly with agent count.
- For an agency with 20 agents across 10 subaccounts: $1k-3k/month in idle infra alone.
- Compare to current IEE: per-run cost only, ~$0 idle. Materially different unit economics.

### 7.5 Engineering effort
- Provisioning + lifecycle: 4-8 weeks for a credible v1.
- UX: 2-4 weeks.
- Pricing/billing wiring: 1-2 weeks.
- Total: roughly a quarter of focused work for a launchable product, plus ongoing operational load.

## 8. Path B — workspace across primitives + session-scoped runtime

Position our existing primitives (Config Documents, Connections, IEE, Schedulers, Skill Studio) as a coherent "agent workspace." Add the smallest extension needed to close the real functional gap: keep the same IEE container alive across multiple steps of a single multi-step task. Define a canonical home for scratch artifacts.

### 8.1 What we'd build
- **No new compute primitive.** Re-use IEE.
- **Session-scoped container reuse.** New `iee_sessions` table; a session lives for the duration of one logical task; idle timeout tears it down. Heartbeat extends. State is summarised back to the workspace at session end.
- **Artifact store.** Object storage bucket per workspace, addressable by run id. Thin service wrapping put/get. Run records expose `artifact_url`.
- **Capabilities rewrite.** New top-level *"Persistent Agent Workspace"* capability section in `docs/capabilities.md` framing the four existing primitives as a workspace. Replaces / Consolidates table updated to address Manus / OpenClaw directly.
- **Non-goal documentation.** Explicit "we do not run a persistent VM per agent — here's why" entry. Forces sales conversations to engage on cost and audit, not on framing.

### 8.2 Pros
- **Cheap to ship.** Positioning rewrite is hours. Session reuse is a Standard task (2-4 files). Artifact store is a thin wrapper. Total: weeks, not quarters.
- **Lower COGS at scale.** No idle compute. Only pay for compute when an agent is actually working. This compounds favourably as we add tenants.
- **Better fit with multi-tenant agency model.** No per-agent infra explosion. Existing budget primitives already handle the cost surface.
- **Auditability advantage.** State lives in our database (memory) and object storage (artifacts). Operators can inspect everything through the app. This is a **real** differentiator we can sell, not just spin.
- **Smaller security surface.** Per-task containers torn down at task end. No long-lived attack persistence.
- **Composes with our existing architecture.** Memory / credentials / runtime / skills stay separated. We get to keep the architectural cleanliness we've built.
- **Reversible.** If we're wrong and customers genuinely want VMs, Path B does not foreclose Path A. We can ship VMs as a premium tier later. Path A does not enjoy the same reversibility — if we ship VMs first and want to retreat, the migration is painful.

### 8.3 Cons
- **Worse marketing legibility.** *"Persistent workspace across our managed primitives"* is a longer sentence than *"your agent has its own computer."* In a noisy market, sharper sentences win.
- **Customer education tax.** Every sales conversation has to address why we don't have VMs. That's a recurring cost in seller time and customer-confusion-handling.
- **Genuine workload gaps.** Sub-minute pollers, long-running watchers, heavy local tooling — these workloads are harder on schedulers + cold containers than on warm VMs. We may turn down deals we could have won.
- **Engineering risk on session reuse.** Docker container lifecycle (heartbeats, idle timeouts, leaked containers, cleanup races, orphaned resources) is operationally hairy. Non-trivial chance of post-launch incidents.
- **Risk of being "right but lonely."** The market may converge on the VM frame to the point where "no VMs" reads as a missing feature regardless of underlying capability. Being architecturally right does not always win.
- **Lock-in disadvantage.** Path A's accumulated VM state creates customer stickiness. Path B's state lives in our app, which is also sticky — but less viscerally so for the customer.

### 8.4 Cost model (rough)
- Object storage: ~$0.02/GB/month. Negligible at expected scales.
- IEE compute: per-run, no idle cost. Already in production.
- Engineering: weeks. No new infra partnership required.

### 8.5 Engineering effort
- Positioning rewrite: 1 week.
- Artifact store: 1 week.
- Session-scoped container reuse: 2-3 weeks (most of the risk lives here).
- Total: roughly a month of focused work.

## 9. Side-by-side comparison

| Axis | Path A — per-agent VM | Path B — workspace + session runtime |
|------|----------------------|--------------------------------------|
| Marketing legibility | Strong (matches the frame customers already hear) | Weaker (requires reframing the conversation) |
| Engineering effort to ship | Quarter-scale | Month-scale |
| Idle infra cost | High and scales with agent count | Near zero |
| Multi-tenant fit | Strained (VM-per-agent multiplies poorly across agency / subaccount / agent tiers) | Natural (existing tenant model unchanged) |
| Auditability | Worse (state behind SSH) | Better (state in DB + object storage) |
| Security blast radius | Larger (long-lived attack persistence) | Smaller (per-task containers torn down) |
| Long-running workload fit | Excellent | Awkward (cold-start latency on schedulers) |
| Customer lock-in | Strong (accumulated VM state) | Moderate (state in our app) |
| Operational load | High (VM lifecycle, patching, backups) | Moderate (container lifecycle only) |
| Reversibility | Low (hard to retreat from VMs once shipped) | High (can add VMs later as premium tier) |
| Differentiation 12 months out | Low (everyone has VMs) | High if the cost-and-audit story lands |
| Differentiation 12 months out if cost-and-audit story does NOT land | Low | Negative (we look like we're missing a feature) |

The last two rows are the live argument. Path B's upside is conditional on customers caring about cost and audit. Path A's upside is unconditional but has worse unit economics.

## 10. Recommendation

**Recommendation: Path B, with a Path-A escape hatch on the roadmap.**

The reasoning, briefly:

1. **Unit economics decide this.** Path A's idle-VM cost is a structural margin drag that gets worse as we scale. We are not a venture-funded growth-at-any-cost play; gross margin matters.
2. **Multi-tenant fit decides it again.** Our customer is an agency running clients running agents. Path A's per-agent VM does not compose cleanly with that hierarchy. Path B does.
3. **Reversibility breaks the tie.** If the market proves us wrong on Path B, we can add a VM tier later. If we ship VMs first and the market proves us wrong, we cannot easily retreat. When in doubt between two paths, prefer the one that preserves optionality.
4. **The cost-and-audit story is sellable.** *"Your agent's workspace lives in your business records, not on a server you can't audit, and you only pay for compute when work happens"* is a real pitch. It is not as sharp as *"your agent has its own computer,"* but it is durable and compounds with time as customers feel the cost difference on their own bills.

**The condition under which this recommendation flips:** if the research gaps in §3 reveal that Manus / OpenClaw are winning enterprise deals on the VM pitch specifically, and we have already lost named opportunities because of it, then Path A becomes a defensive necessity. Recommend running that check before committing.

**The condition under which both paths could be wrong:** if customer demand turns out to be for *"my agent runs my desktop, not a server in the cloud,"* the entire frame shifts to local execution (Anthropic Computer Use direction) and both paths become irrelevant. This is unlikely on a 12-month horizon but worth flagging.

## 11. If we choose Path B — what we'd actually build

In suggested order. Each step is independently shippable.

### 11.1 Positioning rewrite (Week 1)
- New top-level *"Persistent Agent Workspace"* section in `docs/capabilities.md` framing Config Documents + Actor identity + Connections + Sandboxed Runtime as a coherent workspace.
- IEE intro rewritten: lead with *"on-demand sandboxed compute that picks up where the last run left off"* rather than *"Docker containers for browser automation."*
- Replaces / Consolidates table updated with a row directly addressing hosted-VM-per-agent platforms.
- Non-goals entry: *"We do not run a persistent VM per agent — see §X for why."*
- "Always-on" reframed as schedulers + persistent state rather than idle compute.

No code changes. Highest leverage per hour of effort in this brief.

### 11.2 Workspace persistence model (Weeks 2-3)
- Define the canonical answer to *"where do agent files go between runs?"*: memory in DB, scratch in object storage, credentials in Connections, code in Skill versions.
- Build the artifact-store wrapper: per-workspace bucket, addressable by run id, exposed via `artifact_url` on run records.
- Document the convention. Add an operator-facing surface (file browser per workspace) so customers can answer *"where is my agent's stuff?"* without us.

Sized as a Standard task once the storage convention is picked.

### 11.3 Session-scoped container reuse in IEE (Weeks 3-5)
- New `iee_sessions` table referencing run, actor, budget context.
- IEE execution service checks for active session before spawning a new container; dispatches into existing if present.
- Idle timeout (minutes, not hours) tears the container down. Heartbeat extends.
- Session end: structured summary written to run record; durable artifacts uploaded to artifact store.
- Existing per-run cost tracking applied; bill the session under the parent task's compute budget.

Sized as a Standard-to-Significant task. Most of the engineering risk in the brief lives here. Needs a real spec.

### 11.4 Optional follow-on: long-running session tier (TBD)
- If customer demand surfaces for genuine sub-minute pollers or long-running watchers, evaluate a "warm session" tier that keeps a container alive for hours/days within tight cost caps.
- This is the Path-A escape hatch. Not for v1.

## 12. Open questions and where this analysis could be wrong

This section exists to be challenged. Reviewers should push hardest on these.

1. **Is the cost difference real at our scale?** §7.4 estimates idle-VM cost at $5-15/agent/month. If customer demand is small enough that 10x the cost is still rounding error, the cost argument weakens substantially.
2. **Is the multi-tenant argument real?** Path A could be sold as *"per-subaccount workspace VM"* rather than per-agent. That softens the multiplication problem and may match customer mental model better than per-agent. Worth pressure-testing.
3. **Have we lost deals on this already?** If yes, the urgency is higher than this brief assumes. If no, we have time to ship Path B and observe.
4. **Is the auditability story actually a buying criterion?** Operators say they want audit trails. They often buy on other axes. If audit is *"nice to have"* and not *"will pay more for,"* the differentiation argument weakens.
5. **Do we have real schedulers, or are they aspirational in `capabilities.md`?** The "always-on via schedulers" pitch only works if the scheduler infra is production-grade. Confirm before committing.
6. **Is OpenClaw a real comparator?** The post asserts it confidently. Worth 30 minutes of independent research before citing it externally.
7. **Will Manus's VM model prove sticky or expensive-and-abandoned?** If their unit economics blow up in 6 months and they retreat, Path B looks prescient. If they ride it to a much larger customer base before the unit economics matter, Path A looks like the right call we missed.
8. **Could a hybrid be cheaper than either?** E.g. shared "workspace VM" per subaccount with per-agent containers inside it. Not seriously evaluated in this brief; might deserve its own section if reviewers push.
9. **Is the security blast-radius argument overstated?** A compromised long-lived VM is bad, but a compromised set of accumulated database rows (memory) and object-storage artifacts is also bad. The asymmetry is real but not infinite.
10. **What does the customer base actually want?** This brief is reasoning from competitive signal, not from customer interviews. A handful of *"yes I want this / no I don't"* conversations would beat all of this analysis.

## 13. Out of scope

- **Pricing / billing redesign.** Compute Budget and Spending Budget already cover the cost model. Path B does not require pricing changes. Path A would.
- **A "click here to spin up a workspace" UI primitive** mirroring Manus's button. The workspace already exists under Path B; what's shipped is the language naming it. If we go Path A, this comes back into scope.
- **User-managed VPS deployment** in OpenClaw style. Different product surface, different customer profile, not a fit for our agency-on-behalf-of-clients model regardless of which path we pick.
- **Cross-task container reuse.** A session is bounded by one logical task. Sharing containers across unrelated tasks introduces tenancy and cleanup risks not worth taking on in v1.
- **Local execution model** (agent runs on the user's desktop). Genuinely different product. Worth tracking as a market signal but not in scope for this brief.

## 14. Success criteria for v1

These criteria are stated for Path B, since that is the recommendation. If the recommendation flips, criteria for Path A are derivable from §7.

A non-technical operator can:

- Read the capabilities doc and answer *"where does my agent's memory and work persist?"* without saying *"in a VM somewhere."*
- See, in the app, the four workspace layers (memory, credentials, scratch artifacts, skills) and their contents per agent or per run.
- Run a multi-step task that takes hours, confident that mid-task state is not lost between steps and that end-of-task artifacts are recoverable.
- Compare us against Manus or OpenClaw and articulate the differentiator in one sentence: *"Synthetos persists my agent's workspace in my business records, not on a server I can't audit, and I only pay for compute when the agent is actually working."*

A reasonable internal observer can:

- Verify that no idle compute cost has been introduced by the v1 work.
- Verify that the session-reuse mechanism does not leak containers under normal or adverse conditions.
- Confirm that the brief's recommendation has aged well or recognise when it has not, using the open questions in §12 as the checklist.
