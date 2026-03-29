# Agent Orchestration Reference: HITL-First Architecture

**Version:** 2.0 (HITL-aware)  
**Date:** March 2026  
**Purpose:** Adjunct reference to the HITL Platform Dev Brief v3. Maps the Polsia-inspired agent network onto this platform's architecture with the Human-in-the-Loop layer as a first-class design primitive.

---

## Why This Document Exists

The original Polsia reference doc describes a fully autonomous system built by Ben Cera — a solo founder who gave his agents unrestricted execution rights from day one. That model works when you are the only operator and accept full responsibility for every autonomous action.

This platform serves agencies managing client accounts. The stakes are different. A misfired email to a client's customer, a poorly timed ad spend, or an unreviewed code change pushed to production carries real business consequences. The HITL layer is not a limitation on autonomy — it is what makes autonomy safe to offer as a product.

This document reframes the Polsia agent network through that lens: the same nine agent roles, the same coordination architecture, but with every boundary action gated through human review before it reaches the outside world.

---

## The Agent Network

Nine specialised agents, each scoped to a specific business function. The same roles Ben built at Polsia, adapted for a multi-tenant HITL platform.

| Agent | Role | Default Schedule | Gate Model |
|---|---|---|---|
| Orchestrator | Sets daily priorities, morning plan and evening summary | 06:00 and 20:00 | Internal only — writes directives, no external actions |
| Support | Reads inbox, classifies tickets, drafts replies | Every 2 hours | Drafts held for review before send |
| Social Media | Drafts content, schedules posts | Every 6 hours | All posts held for review before publish |
| Email Outreach | Finds prospects, drafts cold email sequences | Every 6 hours | All outbound held for review before send |
| Ads Management | Reads campaign performance, proposes bid and copy changes | Every 6 hours | Budget changes held for review; reads auto |
| Business Planning | Analyses KPIs, writes growth recommendations | Daily | Internal only — writes to board and memory |
| Competitor Research | Web search, competitor profile updates | Daily | Internal only — writes to board and memory |
| Finance | Syncs revenue data, tracks spend, flags anomalies | Every 6 hours | Internal reads auto; spend changes held for review |
| Code Generation | Analyses issues, writes fixes, opens PRs | On demand (Phase 3) | All PRs held for review before merge |

**Phase 1 builds:** Support agent only.  
**Phase 2 adds:** Orchestrator + one additional agent (Social or Ads recommended — both are high-value and low-blast-radius).  
**Phase 3 adds:** Remaining agents + Code Generation (requires Docker/VPS).

---

## How the Agents Coordinate

The architecture mirrors Polsia's: agents do not call each other in real time. They communicate asynchronously through shared state. Four layers hold the team together.

### Layer 1: Shared Database

All agents read from and write to the same PostgreSQL database. The Orchestrator's morning priorities are visible to the Support agent. The Finance agent's anomaly flag is visible to the Business Planning agent. One source of truth across the whole team — no direct agent-to-agent calls, no risk of cascading failures.

Key shared tables:
- `workspace_memories` and `workspace_memory_entries` — accumulated intelligence across all runs
- `orchestrator_directives` — Orchestrator's current priorities injected into every agent's context
- `tasks` — the shared board, updated by any agent, read by all
- `actions` and `review_items` — the HITL layer, visible across all agent types

### Layer 2: The Board as Coordination Surface

The kanban board is not just a UI element — it is an asynchronous message bus between agents. When the Support agent creates a task for a recurring bug, the Code Generation agent reads it on its next run. When the Competitor Research agent writes a task with a new pricing change, the Ads Management agent sees it before adjusting bids.

This is the same mechanism Ben built into Polsia via PostgreSQL. The board is the team's shared memory of what needs doing.

### Layer 3: pg-boss Scheduling

Each agent fires at its configured schedule via pg-boss. Retries are handled automatically. Failed runs notify the workspace owner. This is the equivalent of Polsia's Celery + Redis Beat — different technology, same reliability model.

### Layer 4: The Orchestrator as Director

The Orchestrator runs twice daily, reads everything (memory, board, recent actions, open review items, recent failures), synthesises it into a prioritised plan, and writes that plan as a directive. The directive is injected into every other agent's context on its next run via `workspaceMemoryService.getMemoryForPrompt()`.

This is what turns nine independent agents into a directed team. The Support agent does not need to know that there is a pricing campaign running — the Orchestrator's directive tells it to mention the current offer when relevant.

---

## The HITL Layer: Where Polsia and This Platform Diverge

Polsia runs fully autonomous. Every agent action executes immediately. This is the right model for a founder-operated single-tenant platform. It is the wrong model for an agency platform.

The HITL layer introduces a gate between every external action and the outside world. The gate has three states:

**Auto** — executes immediately, logged but not blocked. Used for read operations and internal board writes. No human review needed.

**Review** — creates a review item and pauses execution. A human approves, edits and approves, or rejects. Only after approval does execution proceed. Used for all outbound communication, external record updates, and spend changes.

**Block** — never executes autonomously regardless of context. Used for actions like billing changes, production deployments, and account deletion.

The critical design principle is that **gate enforcement happens at the backend, not the frontend**. A review item cannot be executed by calling the execution service directly — the backend re-checks the approval state on every execution call. The frontend approve button is convenience, not security.

### What This Looks Like Per Agent

**Support agent:**
```
read_inbox         → Auto (read only)
classify email     → Auto (internal)
draft reply        → Auto (internal)
send_email         → REVIEW (held until human approves)
```

**Social Media agent:**
```
research content   → Auto (web search, read only)
draft post         → Auto (internal)
publish_post       → REVIEW (held until human approves)
```

**Ads Management agent:**
```
read_campaigns     → Auto (read only)
analyse performance → Auto (internal)
update_bid         → REVIEW (held until human approves)
pause_campaign     → BLOCK (requires explicit manual action)
increase_budget    → BLOCK (requires explicit manual action)
```

**Orchestrator:**
```
read all workspace state  → Auto (read only)
write directives          → Auto (internal)
-- no external actions ever --
```

**Code Generation agent (Phase 3):**
```
read codebase      → Auto (read only)
analyse issues     → Auto (internal)
write code changes → Auto (internal, sandboxed)
open_pr            → REVIEW (held until human approves)
merge_pr           → BLOCK (requires explicit manual merge)
deploy             → BLOCK (always manual)
```

---

## The Self-Improvement Loop (HITL Version)

Polsia's self-improvement loop: detect via Support → escalate via Orchestrator → fix via Code → ship via GitHub.

This platform's version of that loop adds HITL gates at the boundary crossings:

```
Support agent detects recurring bug in inbox
→ Writes insight to workspace memory (auto)
→ Creates board task: "Bug: users cannot reset password" (auto)

Orchestrator reads board state at 20:00
→ Sees pattern: 5 support tickets, same issue
→ Writes directive: "Prioritise password reset bug" (auto, internal)

Code agent runs next morning
→ Reads orchestrator directive
→ Analyses codebase for the issue
→ Writes proposed fix
→ Opens PR → REVIEW GATE: human approves before merge

After merge:
Support agent notes in memory: "password reset bug resolved 2026-03-30"
Next inbox run: replies to affected customers with fix notice → REVIEW GATE
```

Every boundary crossing — the PR merge, the customer notification — requires human sign-off. Everything in between runs autonomously.

---

## Data Architecture

This platform uses PostgreSQL with pg-boss rather than Polsia's Python/Celery/ChromaDB stack. The trade-off is deliberate: one database engine, simpler operations, PostgreSQL-native full-text search covering most of what ChromaDB provides for this use case.

For semantic memory search at scale, the path to adding a vector store is clearly defined: add a `vector_store_id` field to memory entries and route semantic queries to the vector layer while keeping all structured data in PostgreSQL. This is not needed for Phase 1 or 2.

### Coordination Tables Summary

| Table | Purpose | Who Writes | Who Reads |
|---|---|---|---|
| `workspace_memories` | Accumulated intelligence | All agents (post-run) | All agents (pre-run) |
| `orchestrator_directives` | Daily priorities and direction | Orchestrator agent | All other agents |
| `tasks` | Board work items | All agents | All agents |
| `actions` | Proposed boundary actions | skillExecutor | ExecutionLayerService, ReviewService |
| `review_items` | Human approval queue | ReviewService | Human reviewer, notification system |
| `processed_resources` | Deduplication log | Each agent post-run | Each agent pre-run |
| `integration_connections` | External service auth | Admin UI (human) | ExecutionLayerService adapters |

---

## Build Sequence for the Full Agent Network

The nine agents are not built simultaneously. Each new agent reuses the same platform primitives — actions, review items, integration connections — and adds only its agent-specific prompt and skill configuration.

**Phase 1 (current):** Support agent. Validates all new platform primitives on a real inbox.

**Phase 2A:** Orchestrator. Add `orchestrator_directives` table and service. The Orchestrator has no external actions — it only reads and writes internal state. This means no new gate work. Low implementation risk, high leverage.

**Phase 2B:** Social Media or Ads Management. Choose based on which the agency most wants to sell. Both use the review gate for outbound actions (posts and bid changes). The action type registry and execution layer already handle these via the `api` adapter.

**Phase 3:** Finance, Email Outreach, Business Planning, Competitor Research. All are either internal-only (Business Planning, Competitor Research) or extend existing patterns (Finance, Email Outreach). No new infrastructure required.

**Phase 4 (requires Docker/VPS):** Code Generation. This is the Ben Cera "headless mode" agent. Requires the `devops` and potentially `browser` adapters, isolated container execution, and the VPS infrastructure described in the main platform spec. The gate model is particularly important here — PRs are reviewed before merge, deploys are always manual.

---

## What Makes This Different From Polsia

| Capability | Polsia | This Platform |
|---|---|---|
| Execution model | Fully autonomous | HITL-gated boundary actions |
| Target operator | Single founder | Agencies managing client accounts |
| Multi-tenancy | Single tenant | Multi-tenant (org → subaccount hierarchy) |
| Approval workflow | None | review_items with approve/edit/reject |
| Audit trail | Run logs | action_events — full state machine history |
| Cost controls | Developer-managed | workspace_limits with daily caps and alerts |
| Agent coordination | Celery + Redis + ChromaDB | pg-boss + PostgreSQL |
| Code execution | Claude Code CLI (headless) | Phase 3 (Docker/VPS, deferred) |
| Distribution model | Direct SaaS | Agency-reseller model (org → subaccount) |

The HITL layer is not a compromise on autonomy. It is what makes autonomy sellable to agencies. A fully autonomous agent that occasionally sends a bad email to a client's customer is not a product an agency can confidently offer. A HITL agent that does the same quality of work but holds every boundary action for human review is.

The vision is to start conservative — everything reviewed — and progressively move actions to auto-gate as the agency builds confidence in each agent's output quality. That progression happens per action type, per workspace, at the operator's discretion. The platform's job is to make that trust-building process safe, observable, and reversible.

---

## Reference Links

| Resource | URL |
|---|---|
| Polsia platform | https://polsia.com |
| Polsia GitHub | https://github.com/PolsiaAI/Polsia |
| Anthropic Claude Code docs | https://docs.anthropic.com/claude-code |
| Ben Cera on X | https://x.com/bencera_ |
| Mixergy interview | https://mixergy.com/interviews/this-ai-generates-689k/ |
| Solo Founders Podcast | https://solofounders.com/blog/80-ai-20-taste-ben-cera-on-the-future-of-solo-founding |

*This document should be read alongside the HITL Platform Dev Brief v3. Architecture decisions and table schemas are defined there. This document covers the agent network design rationale and the HITL framing.*
