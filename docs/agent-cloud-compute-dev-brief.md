# Agent Cloud Compute — Development Brief

> **Status:** Rev 1 — first pass. Pre-spec, pre-review.
> **Date:** 2026-05-07
> **Branch:** `claude/add-agent-cloud-compute-Kb4ii`
> **Audience:** Internal engineering, plus LLM reviewers without prior context.
> **Trigger:** Manus shipped "Cloud Computers" (one-click persistent VM per agent). OpenClaw has done similar via VPS deployment for months. Question: do we need to match this, or does our existing model already deliver the customer outcome more cheaply?

---

## Contents

1. What this brief is
2. The Manus / OpenClaw model — what they're selling
3. Where we are today
4. The strategic decision — what we are NOT building, and why
5. Recommendations
   - 5.1 Positioning rewrite in `capabilities.md`
   - 5.2 Session-scoped container reuse in IEE
   - 5.3 Workspace persistence model — memory in app, scratch in object storage
   - 5.4 "Always-on" framing via schedulers + persistent state
6. Dependencies and suggested ordering
7. Out of scope
8. Success criteria for v1
9. Decisions made
10. Alternatives considered and rejected

---

## 1. What this brief is

The agentic AI category is converging on a single pitch: *"your agent has its own computer, running 24/7."* Manus has now wrapped this into a one-click button. OpenClaw has shipped it via VPS deployment. The customer-perceived outcome is *"my agent works while I sleep, with persistent files, persistent env, and persistent state."*

Synthetos already delivers most of that outcome through different primitives. This brief argues we should **not** ship a per-agent persistent VM, and instead close the perceived gap with (a) a positioning rewrite, (b) a small extension to IEE for multi-step task continuity, and (c) a clearer workspace persistence story that frames our existing primitives as the durable workspace.

This is a brief, not a spec. Each recommendation is sized as a small, independently-shippable change.

## 2. The Manus / OpenClaw model — what they're selling

Both products bundle the same set of properties under the headline "your agent gets its own computer":

- A **dedicated VM** (Manus) or **dedicated VPS** (OpenClaw) per agent.
- **Persistent filesystem** — files written during one run survive into the next.
- **Persistent env** — installed packages, browser sessions, custom scripts persist.
- **Always-on availability** — the agent can be triggered or scheduled at any time without cold-start setup.
- **Independent of the user's machine** — the agent does not need the user's laptop open to work.

Manus's pitch: *"An always-on workspace for your agent to work 24/7. One click. Create."* OpenClaw's pitch: *"Configure your own VPS, run agents across infrastructure you control."*

The framing is sticky because it maps onto a familiar mental model: a VM is a computer, a computer is a desk, your agent has a desk. The framing is also expensive: an idle VM costs money 24 hours a day for an agent that runs 30 minutes a day.

## 3. Where we are today

Synthetos already ships, in production:

### 3.1 Sandboxed Runtime (IEE)
`server/services/ieeExecutionService.ts`, `server/services/ieeUsageService.ts`, `server/jobs/ieeRunCompletedHandler.ts`. Fully sandboxed Docker containers for browser automation and org-level extensibility. Per-run cost tracking. Budget controls. Connection health validation against stored credentials.

### 3.2 Persistent agent memory
Config Documents (`docs/capabilities.md` § Knowledge Sharing & Reusable Context). Workspace-level reference material that informs every agent run. Persisted in our database, audited, multi-tenant-isolated.

### 3.3 Stable actor identity
`docs/capabilities.md` § Actor / identity model. Every agent is a stable actor with persistent identity across backend migrations. History, audit, and continuity survive even when the underlying compute changes.

### 3.4 Thread context panel
Per-conversation persistent context — task description, preferred approach, key decisions — that the agent reads at the start of every run.

### 3.5 Always-on workloads
Continuous enrichment, always-on health scoring, anomaly detection (`docs/capabilities.md` § Replaces / Consolidates). These are scheduler-driven, not VM-driven.

### 3.6 Credentials and sessions
Connections + Connection Health Validation. Browser sessions and OAuth tokens are persisted in the credentials layer, not in a VM filesystem.

### 3.7 Spending and compute budgets
Two distinct budget primitives. Compute Budget caps LLM and runtime cost per workspace. Spending Budget governs money the agent moves on the client's behalf. Both already integrate with IEE runtime cost.

What we **don't** have:

- A way to keep the **same** IEE container alive across multiple steps of a single long task (each step currently spins up a fresh container).
- Public-facing positioning that frames IEE + Config Documents + Actor identity as a coherent "your agent's workspace."
- A canonical place where scratch artifacts from a run (downloaded files, intermediate CSVs) are stored and re-attached on the next run.

## 4. The strategic decision — what we are NOT building, and why

**We are not shipping a per-agent persistent VM.**

The Manus pitch maps four customer needs onto one expensive primitive. We map them onto four cheaper, more auditable primitives:

| What the agent needs to persist | Manus / OpenClaw answer | Synthetos answer |
|---------------------------------|-------------------------|------------------|
| Memory (what it learned, decided) | VM filesystem | Database — Config Documents, Thread Context, Actor history |
| Credentials and sessions | VM filesystem | Connections layer with Connection Health Validation |
| Working files, intermediate state | VM disk | Object storage attached to the run (proposed) |
| Long-running processes | Always-on VM | Scheduler with on-demand IEE container |

The Synthetos column is **better** on every axis a non-technical operator cares about: lower cost (no idle VM), auditable (memory lives in business records the operator can inspect), multi-tenant-isolated (RLS, not file permissions), backend-portable (Actor identity survives migrations).

The Synthetos column is **worse** on one thing: marketing legibility. *"Your agent has its own computer"* is a sharper sentence than *"your agent has its own workspace, persisted across our managed primitives."* That is a positioning problem, not an architecture problem.

The remainder of this brief proposes the smallest set of changes that close the legibility gap without taking on the cost and complexity of per-agent VMs.

## 5. Recommendations

### 5.1 Positioning rewrite in `capabilities.md`

Reframe the Sandboxed Runtime (IEE) section and the surrounding capabilities so that, read together, they describe a **persistent agent workspace**. No code changes — copy and structure only.

Concretely:
- Add a new top-level capability section titled something like *Persistent Agent Workspace*, sitting above the IEE section, that names the four primitives (Config Documents, Actor identity, Connections, Sandboxed Runtime) as the components of "your agent's workspace."
- Rewrite the IEE intro to lead with *"on-demand, sandboxed compute that picks up where the last run left off"* rather than *"Docker containers for browser automation."*
- Update the Replaces / Consolidates table with a row covering hosted-VM-per-agent platforms (Manus, OpenClaw, similar) and our differentiator: workspace lives in the operator's business records, not on a server they cannot audit.
- Add a Non-goals entry: *"We do not run a persistent VM per agent — see [link] for why."*

This is the highest-leverage change in the brief. Cost: a few hours of writing.

### 5.2 Session-scoped container reuse in IEE

Today, each step of a multi-step task spins up a fresh IEE container. For a single logical task that runs across multiple steps (a 4-hour browser sequence, a multi-page scrape, a complex form submission with intermediate waits), this is wasteful and breaks any in-container state the agent built up.

Add a **session** primitive to IEE: a logical envelope that holds the same container alive across multiple step invocations within one task, then tears it down at task end and writes summarised state back to the workspace.

Sketch:
- New `iee_sessions` row created when a task begins; references the run, the actor, the budget context.
- IEE execution service checks for an active session before spawning a new container; if present, dispatches into the existing one.
- Idle timeout (default: minutes, not hours) tears the container down to control cost. Heartbeat extends the lease.
- At session end, a structured "what happened in this session" summary is written to the run record and any durable artifacts are uploaded to object storage (see 5.3).
- Reuse the existing per-run cost tracking; bill the session under the parent task's compute budget.

This is the only meaningful build in the brief. Sized as a Standard task (2-4 files, no new patterns). It does not require a persistent VM, an idle workspace, or any 24/7 compute.

### 5.3 Workspace persistence model — memory in app, scratch in object storage

Define the canonical answer to *"where do agent files go between runs?"*:

- **Memory** (decisions, learnings, key facts) → Config Documents and Thread Context. Already in place; document the convention.
- **Scratch artifacts** (downloaded CSVs, screenshots, intermediate JSON) → object storage bucket per workspace, addressable by run id. Add a thin service that wraps put/get and exposes an `artifact_url` field on run records.
- **Credentials and sessions** → Connections layer. Already in place.
- **Code/scripts** → Skill versions, not container filesystems. Skill Studio already covers this.

The point of this section is that the operator can answer the question *"where is my agent's stuff?"* in plain English and inspect every layer through the app, not by SSHing to a VM.

Sized as a Standard task once the object-storage convention is picked. The artifact-store wrapper is small; the harder work is the convention and the doc.

### 5.4 "Always-on" framing via schedulers + persistent state

Manus's "24/7" pitch is genuinely answered by scheduling, not by an idle VM. We already have schedulers and the always-on enrichment / health-scoring patterns. Make this explicit in the capabilities doc:

- "Always-on" workloads are **schedule + workspace state**, not **idle VM**.
- An agent triggered every 15 minutes on a workspace with persistent memory **is** an always-on agent, at a fraction of the cost of an idle VM.
- The Replaces / Consolidates table should explicitly position this against the 24/7 VM pitch.

No build. Pure positioning. Bundle with 5.1.

## 6. Dependencies and suggested ordering

1. **5.1 + 5.4 first** (positioning rewrite). Independent of any code change. Highest leverage, lowest cost. Ship this week.
2. **5.3 next** (workspace persistence model). The doc convention plus the object-storage wrapper. Unblocks 5.2's "write artifacts back to workspace" step.
3. **5.2 last** (session-scoped container reuse). Builds on 5.3 for end-of-session artifact upload.

Each step is independently shippable. 5.2 is the only one that needs a real spec.

## 7. Out of scope

- **Per-agent persistent VMs.** Explicit non-goal. See §4 for rationale.
- **User-managed VPS deployment** in OpenClaw style. Different product surface, different customer profile, not a fit for our agency-on-behalf-of-clients model.
- **Cross-task container reuse.** A session is bounded by one logical task. Sharing containers across unrelated tasks introduces tenancy and cleanup risks not worth taking on in v1.
- **A "click here to spin up a workspace" UI primitive** mirroring Manus's button. The workspace already exists; what we're shipping is the language that names it, not a new UI flow.
- **Pricing / billing redesign.** Compute Budget and Spending Budget already cover the cost model. No changes needed for v1.

## 8. Success criteria for v1

A non-technical operator can:

- Read the capabilities doc and answer the question *"where does my agent's memory and work persist?"* without saying "in a VM somewhere."
- See, in the app, the four workspace layers (memory, credentials, scratch artifacts, skills) and their contents per agent or per run.
- Run a multi-step task that takes hours, confident that mid-task state is not lost between steps and that end-of-task artifacts are recoverable.
- Compare us against Manus or OpenClaw and articulate the differentiator in one sentence: *"Synthetos persists my agent's workspace in my business records, not on a server I can't audit, and only spins up compute when the agent is actually working."*

## 9. Decisions made

- **No per-agent persistent VM.** Closed; the cost/benefit does not justify it for our customer profile.
- **Session as the unit of container continuity, not workspace.** A session lives for one logical task and is torn down at task end. Workspace continuity is achieved via the four persistent layers (memory, credentials, scratch, skills), not via a long-lived container.
- **Memory lives in the app, not in the runtime.** Config Documents, Thread Context, and Actor history are the canonical persistence surface. The runtime is ephemeral by design.
- **Scratch artifacts live in object storage, not in container disks.** Operator-visible, multi-tenant-isolated, cheap.
- **"Always-on" is delivered by schedulers + persistent state, not by idle compute.** Same outcome, lower cost, more auditable.

## 10. Alternatives considered and rejected

- **Build per-agent persistent VMs to match Manus head-on.** Rejected. High cost (idle compute), poor multi-tenant fit (VM-per-agent does not compose with our agency-of-subaccounts model), worse auditability (state hidden behind SSH), and lower long-term differentiation (the marketing pitch wins six months, the cost structure loses for years).
- **Ship a persistent VM as a premium tier on top of IEE.** Rejected for v1. Re-evaluate only if a real customer asks for it. Even then, prefer extending session lifetime before standing up a separate VM product.
- **Replace IEE with always-on agent runtimes.** Rejected. IEE's per-run sandboxing is a security and isolation feature, not a limitation; trading it away to chase a marketing pitch is the wrong direction.
- **Wait and see.** Rejected. The positioning gap exists today and is cheap to close. Doing nothing concedes the narrative.
