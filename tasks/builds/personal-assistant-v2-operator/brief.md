**Status:** DRAFT (2026-05-13) — all decisions ratified; awaiting spec authoring
**Date:** 2026-05-13
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `personal-assistant-v2-operator`
**Locked predecessors:** `tasks/builds/personal-assistant-v1/brief.md` (V1 merged #291), `tasks/builds/user-owned-agents/brief.md` (foundation merged inline with #291), `tasks/builds/operator-backend/brief.md` (Spec D merged #288), `tasks/builds/sandbox-isolation/spec.md` (Spec B merged #287), `tasks/builds/operator-session-identity/brief.md` (Spec C merged), `tasks/builds/execution-backend-adapter-contract/spec.md` (Spec A merged with Spec D)
**Strategic parent:** `docs/synthetos-governed-agentic-os-brief-v1.2.md` §6.3 (Operator Controller), §16.1 (Executive Assistant Phase 3 full delivery)

# Personal Assistant V2 — Operator Mode + Cross-Ownership Delegation — Build Brief

## Contents

- [0. Naming + decision rationale (read first)](#0-naming--decision-rationale-read-first)
- [0.5 Strategic framing](#05-strategic-framing)
- [1. Purpose](#1-purpose)
- [2. What's locked from upstream](#2-whats-locked-from-upstream)
- [3. What this spec must define](#3-what-this-spec-must-define)
  - [3.1 Universal OpenTaskView + run-trace invariant (platform-level note)](#31-universal-opentaskview--run-trace-invariant-platform-level-note)
  - [3.2 EA gains `controllerStyle: 'operator'`](#32-ea-gains-controllerstyle-operator)
  - [3.3 Capability-map gains an `owner_user_id` scope axis](#33-capability-map-gains-an-owner_user_id-scope-axis)
  - [3.4 Orchestrator routing context carries `requester_user_id`](#34-orchestrator-routing-context-carries-requester_user_id)
  - [3.5 `@PA` / `@MyAssistant` / `@<DisplayName>` addressing as soft routing hint](#35-pa--myassistant--displayname-addressing-as-soft-routing-hint)
  - [3.6 Cross-ownership delegation](#36-cross-ownership-delegation)
  - [3.7 Approval-owner routing rule](#37-approval-owner-routing-rule)
  - [3.8 Operator-mode use cases for the EA](#38-operator-mode-use-cases-for-the-ea)
  - [3.9 Live-file event mechanism (extends operator-backend §3.13)](#39-live-file-event-mechanism-extends-operator-backend-313)
  - [3.10 Memory + Voice Profile available to operator-mode runs](#310-memory--voice-profile-available-to-operator-mode-runs)
  - [3.11 Operator-mode duration / concurrency / approval defaults for the EA](#311-operator-mode-duration--concurrency--approval-defaults-for-the-ea)
- [4. Open architectural questions](#4-open-architectural-questions)
- [5. Out of scope (explicit non-goals)](#5-out-of-scope-explicit-non-goals)
- [6. What unblocks when this ships](#6-what-unblocks-when-this-ships)
- [7. Sequencing](#7-sequencing)

## 0. Naming + decision rationale (read first)

V2 is the upgrade pass on the Executive Assistant introduced in V1. It is NOT a new agent. The same EA agent gains two new capabilities:

1. **Operator Mode controller** — the ability to run long-form adaptive multi-turn work for its owner inside the operator-backend runtime, in addition to the V1 native short-burst pattern.
2. **Cross-ownership delegation as a routable capability** — the orchestrator can hand sub-tasks to a user-owned PA whenever a task touches user-specific resources (calendar / inbox / drafts / voice) regardless of who initiated the parent task.

The naming convention follows V1: the build slug is `personal-assistant-v2-operator` (build effort identifier); the agent slug stays `executive-assistant`; the display default stays "Personal Assistant" (renamable per V1 §3.17).

### Decision provenance

Recorded in the chat transcript on branch `claude/personal-assistant-post-merge-audit` (2026-05-13). Material decisions:

1. **V2 scope: include BOTH operator-mode controller AND cross-ownership delegation.** Either alone is insufficient: operator-mode without delegation is a feature in search of a use case (most direct PA work is short-burst native); delegation without operator-mode leaves the PA unable to handle adaptive multi-step work even when explicitly asked. Together they fulfil the master brief §16.1 "standing autonomous operator" framing.
2. **Universal OpenTaskView invariant.** Every agent run in every controller mode surfaces through the same OpenTaskView + run-trace primitives. Operator mode runs longer and may carry chain-link metadata, but the user-facing surface is identical. This rule is platform-level and belongs in `architecture.md` and the master brief — V2 documents it in §3.1 for context but does not own the canonical statement.
3. **Routing must be declarative.** The orchestrator does NOT get hard-coded "if intent mentions calendar → route to PA" logic. Routing emerges from declarative capability declarations plus two identity axes: `requester_user_id` (who initiated) and `target_owner_user_id` (whose resource is needed). The `capability_map` gains one field: `owner_user_id`, matched against `target_owner_user_id` for cross-ownership delegation, or against `requester_user_id` when `target_owner_user_id` is absent (direct self-service).
4. **`@`-addressing is a soft hint, not a bypass.** `@PA` / `@MyAssistant` / `@<DisplayName>` resolve to the requester's user-owned PA via one lookup; the orchestrator still does capability matching to validate the route. UI autocomplete in GlobalAskBar is **deferred** — plain text recognition by the orchestrator's intent parser is sufficient for V2.
5. **Approval routing follows the owner, not the initiator.** When a cross-ownership sub-step writes to user-owned data (Tier 4+), the owner approves — not the parent task's initiator. Same approval mechanism as today; routed to the owner's approval queue.
6. **Zero new mockups.** V2 surfaces reuse OpenTaskView, the existing GlobalAskBar (`client/src/components/global-ask-bar/GlobalAskBar.tsx`), the operator-backend run-trace renderer (extended via event-type variants, no new visual surface), and the operator-backend prototypes `r1-r17`. No new pages authored. This is intentional product discipline ("don't want to be creating any UI").
7. **Live-file event mechanism.** V2 extends operator-backend §3.13 from end-of-session artefact harvest to live `file.created` / `file.modified` events emitted as the operator runtime writes files. Two patterns: tool-call interception (for files the runtime writes via its tool registry) and filesystem watcher (for files the runtime didn't catch, e.g., browser downloads). Layer-3 content streaming (character-by-character text doc rendering) deferred.

Reviewer should read this section first, then §0.5 strategic framing, then the rest of this brief.

## 0.5 Strategic framing

V2 is the second consumer of the `user-owned-agents` foundation primitive that shipped in PR #291. V1 was the first consumer; Dev Agent (master brief §16.3, Phase 3) is the third future consumer. The strategic asset this build sharpens is **governed user-principal automation inside the org boundary** — what SynthetOS does that personal AI assistants (Claude, ChatGPT, Codex, Copilot) do not.

### What V2 is NOT

- **NOT a generic personal AI assistant.** The non-goal locked in V1 §0.5.2 carries forward: V2 does not compete with Claude / ChatGPT / Codex on personal-productivity richness. SynthetOS owns the parts where individual-user automation must be governed, auditable, policy-controlled, connected to SynthetOS-native workflows, and aware of organisation/subaccount context.
- **NOT a new product surface.** Zero new pages. Every user-facing change reuses existing UI (GlobalAskBar, OpenTaskView, run-trace, settings tabs).
- **NOT a redesign of the orchestrator.** The orchestrator already does declarative capability matching via `capabilityMapService.ts`. V2 adds one scope axis; the matcher's other logic is unchanged.

### What V2 IS

- A controller-style upgrade on an existing agent (the EA gets `controllerStyle: 'operator'` as a second allowed style alongside native).
- A capability-routing primitive (`owner_user_id` scope on capabilities → matched against `target_owner_user_id` for cross-ownership delegation, or `requester_user_id` for direct self-service).
- A cross-ownership delegation pattern (parent agent of any owner type can delegate sub-steps to a user-owned PA, with credentials and approval routed to the owner).
- An extension to operator-backend's event emission (live file events, not just step boundaries).

### Reuse acceptance criterion

The user-owned-agents primitive earns its keep when at least two consumers exist that work via the same primitives. V1 is one consumer; V2 must work without EA-specific code branching on the orchestrator side. Specifically:

> The orchestrator's routing logic, capability matcher, and approval-router MUST work identically for any future user-owned agent (Dev Agent in Phase 3, future personal research / financial / writing agents). V2 is allowed to add EA-specific helpers under `server/services/eaDrafts/` and `server/services/voiceProfile/` for things that are genuinely EA-product behaviour, but the routing-and-delegation primitives in §3.3–§3.7 MUST stay agent-template-neutral.

Spec-time acceptance test: a stub Dev Agent configured with `owner_user_id` and an equivalent `capability_map` (same capability slugs as the EA) MUST pass the same routing fixtures as the EA:

1. Direct-owner request ("check my calendar") routes to the stub Dev Agent when the requester is its owner.
2. Cross-ownership delegation request routes to the stub Dev Agent when `target_owner_user_id` matches.
3. Approval-owner rule routes approval to the stub Dev Agent's owner, not the initiator.
4. Ambiguous routing (no explicit owner reference, non-owner requester) fails closed with a clarifying question.

If any of the four fixtures requires an `executive-assistant` slug check in the matcher, approval router, or delegation path, the primitive design is wrong and must be reworked before spec is finalised.

## 1. Purpose

After V1 (PR #291), the Executive Assistant runs short deterministic bursts on schedules / webhooks / events under Native Controller, owned by a specific user. V2 unlocks two things the V1 EA cannot do:

1. **Long-running adaptive work for its owner.** Multi-turn investigations, multi-source synthesis, calendar-aware orchestration that takes minutes rather than seconds. Runs under Operator Controller using the operator-backend runtime (Spec D, merged #288).
2. **Acting as a delegable capability for the rest of the org.** When any task — initiated by any user, executed by any agent — needs to touch the operator's own data (calendar, inbox, drafts, voice), the orchestrator hands that sub-step to the owner's PA. The owner's data, the owner's credentials, the owner's approval.

After V2 lands the platform capability is:

> The Executive Assistant is a standing autonomous operator that runs in two modes: short bursts on triggers for its owner, and long-running adaptive work on demand. It is also callable as a sub-agent by any other agent in the org when the work requires the owner's personal context — and when that sub-step writes to the owner's data, only the owner can approve.

This brief locks scope. The spec is authored next.

## 2. What's locked from upstream

| Capability | Source | Status |
|---|---|---|
| `agents.owner_user_id` + owner-aware credential broker + admin redaction policy | `user-owned-agents` (shipped inline in PR #291) | merged |
| Executive Assistant agent template (slug `executive-assistant`) + voice profile + memory + drafts + first-run wizard | `personal-assistant-v1` (PR #291) | merged |
| `controllerStyle` field on `agent_runs` (`native` / `operator`) | Phase 1 foundation (#279) | merged |
| `subaccount_agents.controllerStyleAllowed` (`'native_only'` / `'native_and_operator'`) | shipped pre-V1 | merged |
| `controllerStyleResolver` — picks native vs operator per run | shipped pre-V1 | merged |
| Operator-backend runtime + `operator_runs` table + dispatcher + chain-resume + cost writer + suspension notifier | Spec D (#288) | merged |
| Sandbox isolation primitive on e2b | Spec B (#287) | merged |
| Operator-session identity (ChatGPT OAuth) + credential broker `auth_type: 'operator_session'` | Spec C | merged |
| ExecutionBackend adapter contract | Spec A (shipped inline with Spec D in PR #288) | merged |
| `OpenTaskView` + ChatPane / Plan / Now / Files / Activity primitives | shipped pre-V1 | merged |
| Operator-backend OpenTaskView prototypes (r1-r17 covering running / completed / failed / cancelled / fallback / chain-link / budget-exceeded / cancellation / settings) | `prototypes/operator-backend/` | shipped |
| Run-trace virtual view + `RunTraceEventRenderer` + chain-link divider pattern (r17) | Phase 1 foundation + operator-backend | merged |
| `capabilityMapService` — declarative capability matching on `subaccount_agents.capability_map` JSONB | shipped pre-V1 | merged |
| Hierarchical agent delegation + `DelegationScope` enum + root-agent contract + `delegation_outcomes` ledger | shipped pre-V1 | merged |
| Approval flow (`actions.status: pending_approval | approved | rejected | expired`) + Slack-approval delivery + stall job | shipped pre-V1 | merged |
| `GlobalAskBar` orchestrator entry (`client/src/components/global-ask-bar/GlobalAskBar.tsx`) | shipped | merged |
| Cross-ownership delegation design note | `user-owned-agents` §3.8 (deferred design) | V2 consumes |

Nothing on the foundation is in flux. V2 is a pure composer of existing primitives plus three additive extensions: the `controllerStyleAllowed` flip on the EA seed, the `capability_map` scope axis, and the live-file event extension on the operator-backend event stream.

## 3. What this spec must define

### 3.1 Universal OpenTaskView + run-trace invariant (platform-level note)

The rule below is platform-level, not V2-specific. V2 documents it here because V2 is the build that surfaces it; the canonical statement lands in `architecture.md` and the master brief during V2's doc-sync sweep.

> Every agent run, regardless of which controller executed it (native, operator, future controllers), regardless of which agent owns it (subaccount, user, org, system), surfaces through the same OpenTaskView (`client/src/pages/OpenTaskView.tsx`) with the same ChatPane / PlanTab / NowTab / FilesTab / ActivityPane primitives and the same run-trace event types. Operator mode runs longer and may emit additional metadata (chain links, budget extensions, sandbox progress), but the user-facing surface is identical. No agent or controller gets a "special" task screen.

Consequence for V2: operator-mode EA runs (per §3.2) render in OpenTaskView via the same WebSocket / SSE event stream native runs use. The user does not learn a new task UI. The only differences between native and operator EA runs that surface to the user are:

- Run-trace event metadata indicates `controllerStyle: 'operator'` (small badge / pill in the existing run-trace header — no new visual chrome)
- Operator-specific events (chain-link boundaries, budget-exceeded, fallback engaged) render via the existing operator-backend event renderers per prototypes r1-r17

Doc-sync edits required when V2 ships:
- `architecture.md` — add a clause under the agent / controller section stating the universal invariant
- `docs/synthetos-governed-agentic-os-brief-v1.2.md` §5.6 (Run Trace) — note that all controllers feed the same surface
- `KNOWLEDGE.md` — already captures the correction entry (2026-05-13 "OpenTaskView + run-trace invariants are platform-level, not per-agent or per-build")

### 3.2 EA gains `controllerStyle: 'operator'`

Single behavioural change to the EA agent's allowed-controllers set. Three small steps:

**Naming note:** the DB column is `controller_style_allowed` (snake_case); the TypeScript / JSONB field is `controllerStyleAllowed` (camelCase). Both refer to the same value. Spec must use both forms correctly — grepping one will miss the other.

1. **Update seed migration default.** The EA seed (`migrations/0332_executive_assistant_seed.sql`) currently sets `controllerStyleAllowed: 'native_only'` (TS/JSON). V2 ships a follow-on migration that flips this to `'native_and_operator'` for the EA system-agent template AND for all existing user-owned EA instances. Idempotent: only flips rows where `system_agent_slug = 'executive-assistant'` and `controller_style_allowed = 'native_only'` (SQL column name).

2. **Operator-mode routing via `controllerStyleResolver`.** The existing resolver (`server/services/controllerStyleResolver.ts`) already handles the four cases (explicit override, subaccount default, mode default, constraint downgrade). V2 verifies that EA runs with `'native_and_operator'` resolve to operator when the orchestrator's routing decision asks for it; no resolver code change expected.

3. **Operator-mode task entry path.** When the orchestrator routes a task to the EA in operator mode, the task is created with `executionMode: 'operator_managed'` and `controllerStyle: 'operator'`. The existing `agentExecutionService` dispatches to the operator-backend dispatcher (Spec D), which spins up an e2b sandbox session, injects credentials via the broker, and the operator runtime takes over. **No new dispatch path** — V2 just unlocks the path the operator-backend already provides.

What V2 does NOT do: change the V1 native-mode trigger behaviour. Cron / Gmail polling / Calendar imminent / Slack mention triggers continue to fire native runs. Operator mode is reserved for direct user requests (§3.4) and cross-ownership delegations (§3.6) that the orchestrator classifies as adaptive multi-step.

### 3.3 Capability-map gains an `owner_user_id` scope axis

The existing `subaccount_agents.capability_map` JSONB shape is:

```ts
{
  computedAt: string,
  referenceLastUpdated?: string,
  integrations: string[],
  read_capabilities: string[],
  write_capabilities: string[],
  skills: string[],
  primitives: string[],
}
```

V2 adds one optional field at the top level:

```ts
{
  ...,
  owner_user_id?: string,  // present when the link's parent agent has owner_user_id set
}
```

**Design decision: scope lives at the AGENT level, not the per-capability level.** All capabilities on a user-owned agent are owner-scoped (the agent acts under the owner's identity); per-capability scope would be unused complexity. The capability slugs (`calendar_read`, `inbox_read`, `send_email`, etc.) stay as string arrays.

`computeCapabilityMapPure(skills, integrationReference, agentRow)` extends to include `owner_user_id` in the output when `agentRow.owner_user_id` is non-null. The implementation is a one-line copy from the agent row to the map. Recompute triggers (skill-link changes, integration-reference refresh) are unchanged.

CI gate: `verify-capability-map-shape.sh` (new) confirms every persisted capability map satisfies all of the following. No drift permitted.

- Subaccount-owned agents: `owner_user_id` is absent or null.
- User-owned agents: `owner_user_id` exactly matches `agents.owner_user_id`.
- Soft-deleted agents: excluded from the gate scan (or explicitly flagged as archived — must not have `owner_user_id` pointing at a live user).
- `owner_user_id` must not reference a deleted or non-member user (join to `users` table; fail if no active row).
- Recompute path: when `agents.owner_user_id` changes, the capability map is updated in the same transaction — gate verifies no stale `owner_user_id` survives a re-seeding run.

### 3.4 Orchestrator routing context carries `requester_user_id`

The orchestrator's Path A capability matcher (`check_capability_gap` skill + downstream routing) takes a routing context that today carries the request's organisation, subaccount, intent, and required capabilities. V2 adds:

```ts
RoutingContext {
  organisationId: string,
  subaccountId: string,
  requester_user_id: string,         // NEW — the human who initiated the request
  target_owner_user_id?: string,     // NEW — whose user-owned resource is being accessed; absent = self-service
  requested_capabilities: string[],
  intent: string,
  ...
}
```

The matcher gains one rule using two axes:

> A capability_map with `owner_user_id` is owner-scoped. It matches when:
> - `target_owner_user_id` is set → `owner_user_id == target_owner_user_id` (cross-ownership delegation to a specific owner's agent)
> - `target_owner_user_id` is absent → `owner_user_id == requester_user_id` (direct self-service: "check my calendar")
>
> For all other cases the owner-scoped agent is filtered out of the candidate set.

**Why two axes?** `requester_user_id` is the human who initiated the parent task; `target_owner_user_id` is whose user-owned resource the sub-task needs. In direct self-service (Sarah asking about her own calendar) they are the same user. In cross-ownership delegation (Sarah's task needing Michael's calendar) they differ — without the second axis the matcher would incorrectly filter Michael's PA out of the candidate set because `requester_user_id` (Sarah) != `owner_user_id` (Michael).

- For direct requests ("check my calendar"): the orchestrator sets `target_owner_user_id = requester_user_id`.
- For cross-ownership delegation ("check Michael's calendar"): `target_owner_user_id` is resolved from the explicit resource-owner reference in the parent task intent or the delegating agent's tool-call parameters. If it cannot be resolved, the delegation fails closed with a clarifying question (§3.6 authorisation invariant).

Subaccount-owned agents (capability_map without `owner_user_id` set) match any requester in the subaccount — current behaviour, unchanged.

Implementation surface: `capabilityMapService.ts` (the matcher logic) plus the orchestrator's request-intake path (where requester_user_id needs to be populated from the authenticated user). Both are small additive changes.

### 3.5 `@PA` / `@MyAssistant` / `@<DisplayName>` addressing as soft routing hint

The orchestrator's intent parser recognises three address forms in the request text:

| Form | Resolves to |
|---|---|
| `@PA` | The requester's owned PA: `agents WHERE owner_user_id = requester_user_id AND system_agent_slug = 'executive-assistant' AND deleted_at IS NULL` |
| `@MyAssistant` | Same as `@PA` (alias) |
| `@<DisplayName>` | Any agent in the org with `name = <DisplayName>` AND scope rules apply (owner-scoped if applicable). Covers the case where the user renamed their EA to "Jarvis" — `@Jarvis` resolves to Michael's renamed PA. |

When an address resolves:

1. The matched agent gets a **score boost** in capability matching — it's tried first, but capability matching still validates the route. If the addressed agent doesn't have the capabilities the task needs, orchestrator surfaces the mismatch ("your Personal Assistant doesn't handle CRM work; Riley does — hand off?") via the existing disambiguation flow.
2. If no agent matches the address (typo, no such agent, deleted), the address is stripped from the intent text and routing proceeds without the hint.
3. Address parsing is text-only — no autocomplete UI in GlobalAskBar in V2. (Autocomplete is a Phase 1.5 / V2.5 UX polish item.)
4. Address parsing preserves original text for audit and debug. `RoutingContext` carries:
   - `raw_intent_text` — the unmodified input string
   - `normalised_intent_text` — after address extraction and stripping
   - `address_parse_result: 'matched' | 'not_found' | 'collision' | 'unsupported_cross_owner'` — 'collision' when two agents share a display name; 'unsupported_cross_owner' when a `@<User>'s PA` form is detected (deferred syntax) so the run trace can surface "why did @Jarvis not route?" diagnostics.

**@\<DisplayName\> collision rule (ratified):** when two agents in the org share the same display name, no score boost is applied and pure capability matching proceeds. The `address_parse_result` is set to `'collision'`. Spec encodes this as a static fixture; no further operator input needed.

Implementation surface: orchestrator intent parser (small parser extension), `RoutingContext` carries `addressed_agent: { id, score_boost } | null`, capability matcher honours the boost.

V2 does NOT support `@<arbitrary user>'s PA` (e.g., Sarah typing `@Michael's PA` to address Michael's PA directly). Routing to another user's PA happens via cross-ownership delegation (§3.6), not direct addressing — and only when the parent task genuinely needs Michael's data, not because Sarah typed his name.

### 3.6 Cross-ownership delegation

The `user-owned-agents` brief §3.8 designed the schema for cross-ownership delegation (parent run carries its owner; delegated sub-step carries the executor's owner) but did NOT implement the runtime routing. V2 implements it.

**Pattern:** any agent — initiated by any user, owned by any principal — can delegate a sub-task to a user-owned agent when the sub-task requires the owner's data. Example: Sarah-the-analyst (subaccount-owned) is compiling a report and needs to find a meeting time for Michael; the orchestrator delegates the "find time in Michael's calendar" sub-step to Michael's PA. Michael's PA executes under Michael's credentials, returns the result, the parent task continues.

**Implementation surface:**

1. **Hierarchical delegation already supports the structural shape.** `DelegationScope` enum + `delegation_outcomes` ledger + parent-run / child-run linkage are all in place from the existing system.
2. **Capability match at delegation time uses the SAME rules as top-level routing (§3.4).** The parent agent's task has a list of required capabilities. For each capability, the matcher considers all agents in the org. When a capability requires an owner-scope match (e.g., "I need calendar_read for Michael specifically"), only Michael's PA matches.
3. **Routing context propagates through delegation.** The original requester_user_id (the human who initiated the parent task) is part of the parent run record AND the routing context for delegated sub-steps. Without this, delegation can't decide "whose calendar am I checking" — the answer comes from the parent task's intent + the orchestrator's resource resolution.
4. **Credentials follow the executor.** When the orchestrator delegates a calendar-check to Michael's PA, the PA uses MICHAEL'S calendar credentials (broker resolution per `user-owned-agents` §3.3 with `ownerUserId: michael`), not the parent task's credentials. The broker invariant ensures Sarah's parent task cannot accidentally read Michael's calendar via Sarah's credentials.
5. **Run-trace shows the chain.** The existing chain-link renderer (operator-backend r17) shows the delegation: "Sarah-the-Analyst → Michael's Personal Assistant → calendar.find_free_slot → result". Owner identity is part of the chain-link label; the existing event renderer extends to display owner principal where applicable.

**Run-trace privacy invariant (cross-owner delegation):**

> Cross-owner run trace may show that a delegated step occurred and its approval/status/result summary, but MUST NOT expose the owner's private source data — raw calendar availability, inbox snippets, draft contents, credential-derived metadata — to the initiating user unless explicitly authorised. The chain-link divider marks the delegation boundary; the owner's private data is visible in the owner's task view only, not in the initiating user's run trace.

Projection rule (spec must encode as a static fixture):

| Viewer | Sees |
|---|---|
| Owner (Michael) | Full delegated sub-run trace, raw source data, approval detail, result |
| Initiator (Sarah) | Delegation status (running / approved / rejected / timed out), typed result summary, no raw owner data |
| Shared parent run trace | Sub-run outcome only — no raw calendar slots, inbox snippets, draft bodies, attachment names, or credential-derived metadata from the target owner |

The spec must include a run-trace projection test or static fixture that asserts the boundary. Violations are security bugs, not UX issues.

**Authorisation invariant (ratified — two-layer rule):**

> Cross-owner delegation requires one of two explicit signals:
> - **Layer 1 (user-facing):** the user intent contains a named-owner or resource reference ("Michael's calendar", "Michael's inbox", possessives that resolve to a known user in the subaccount).
> - **Layer 2 (agent-internal):** a trusted parent-agent tool call explicitly emits an owner-scoped capability request identifying the target owner.
>
> If neither signal is present, delegation fails closed — the orchestrator surfaces a clarifying question instead of guessing. No implicit or fuzzy cross-ownership delegation.

This prevents accidental cross-ownership in ambiguous cases ("schedule a meeting" without specifying whose calendar). Text parsing covers Layer 1; structured capability signals cover Layer 2. Spec encodes both detection paths.

### 3.7 Approval-owner routing rule

When a cross-ownership delegated sub-step requires approval (Tier 4+ writes, send actions, etc.), the approval routes to the **owner** of the executing agent, NOT the initiator of the parent task.

Example: Sarah's task delegates "schedule a meeting in Michael's calendar at the earliest mutually-free time" to Michael's PA. Michael's PA produces a draft calendar event (Tier 4 write, review-gated). The approval request goes to Michael, not Sarah. Sarah's parent task pauses with a typed reason `awaiting_cross_owner_approval` and carries a reference to the pending approval ID.

**Why the owner approves, not the initiator:**

1. Michael's credentials are being used to write to Michael's calendar.
2. Michael's data privacy boundary applies (Sarah cannot see Michael's calendar content; the approval request shows Michael the proposed event, not Sarah).
3. Compliance: every write to user-owned data must be authorised by the owner. Letting initiators authorise cross-owner writes is the privacy-leak path.

**Implementation surface:**

1. The approval row (already in `actions.status` pattern) gains an `approver_user_id` field defaulting to the executor's `owner_user_id` when set, else the task's initiator.
2. The approval queue UI (existing per V1) filters by the current user's approval rows — Michael sees his own approvals, including those that originated from other users' tasks. The cross-owner case displays the requesting context ("Sarah's task is asking your assistant to schedule a meeting; here's the proposed event").
3. The parent task pause / resume mechanism (existing) uses the typed reason `awaiting_cross_owner_approval` so it's distinguishable from same-owner approval waits in observability.
4. Approval timeout: V1 already has the 24-hour stall job (`workflowGateStallNotifyJob.ts`). Cross-owner approvals use the same stall threshold. **Timeout behaviour is deterministic per delegation, governed by a `CrossOwnerApprovalTimeoutPolicy` field on the delegation record:**

   ```
   CrossOwnerApprovalTimeoutPolicy =
     | 'fail_parent'               // default — parent task fails
     | 'continue_without_substep'  // opt-in; only for sub-steps explicitly marked optional
     | 'ask_initiator'             // surface the decision to the parent task's initiator
   ```

   **Default: `fail_parent`.** A sub-step writing to another user's calendar or inbox is not safely skippable without the owner's approval — "proceed without Michael's calendar" could produce low-quality or misleading automation. Optional sub-steps (metadata-only reads, non-blocking lookups) may be declared `continue_without_substep` in the delegation schema; spec confirms which use cases qualify.

### 3.8 Operator-mode use cases for the EA

The spec picks 2–3 operator-mode use cases for the EA that justify the runtime expense and prove the controller-flip works end-to-end. Recommended candidates:

1. **Complex client investigation for the owner.** Example: "Look into why my reply rate has dropped this month — pull my sent mail, segment by recipient type, identify patterns." Multi-source synthesis over the operator's own data. Adaptive: the operator decides what to query, when to escalate to deeper investigation, when to stop.
2. **Multi-source research with synthesis.** Example: "Compile a summary of all client correspondence I've sent this quarter, flag any commitments I made that I haven't followed through on." Long-running, adaptive (filters and re-queries based on intermediate findings).
3. **Calendar-aware multi-person orchestration.** Example: "I need to schedule three back-to-back 30-minute interviews with our top three candidates next Tuesday afternoon. Find slots that work for everyone and propose options." Cross-references multiple calendars, may delegate to other PAs (cross-ownership), runs over minutes to find optimal combinations.

**V2 ships use cases #1 and #2 only (ratified).** Use case #3 is V2.1 — deferred until a second PA-provisioned user exists in the dogfood subaccount so the cross-ownership delegation path can be exercised end-to-end. The core routing, credentials, and privacy primitives must be proven in the simpler single-user operator-mode cases before multi-person scheduling complexity is added.

**What V2 does NOT add as operator-mode use cases:**

- Real-time chat with the EA ("conversational PA") — that's a different product, not in roadmap
- Browsing the web on the operator's behalf for personal research — requires IEE browser worker on e2b (separate spec, `iee-browser-on-e2b`); deferred until that ships
- Cross-day persistent investigations (a multi-day research project the EA owns) — operator-backend's chain-resume model supports it, but the use case isn't yet justified

### 3.9 Live-file event mechanism (extends operator-backend §3.13)

V1 of operator-backend (Spec D §3.13) designed end-of-session artefact harvest. V2 extends to live file events emitted as the operator runtime writes files — this is what makes OpenTaskView's FilesTab feel live during a long-running operator task (per the universal-invariant requirement in §3.1).

**Three-pattern emission:**

1. **Tool-call interception (mandatory).** The operator runtime's tool registry intercepts file-write tool calls. On each write:
   - Upload file content to R2 (key: `runs/{agentRunId}/{relativePath}`)
   - Emit a typed event `file.created` (first write to that path) or `file.modified` (subsequent writes) into the pg-boss `operator-session-progressed` channel
   - Bridge to the existing WebSocket `agent-run` channel that OpenTaskView's FilesTab subscribes to
   - Event payload: `{ storageKey, path, size, mimeType, agentRunId, ownerUserId, version, contentSha256 }`. **Signed-read URLs are NOT included in event payloads** — they expire in 60–300s and would be stale in replayed run traces. The client requests a fresh signed URL from the server when the user opens the file.

2. **Filesystem watcher inside the sandbox (mandatory).** A small process inside the sandbox watches a designated artefacts directory (e.g., `/workspace/artefacts/` and `~/Downloads/`). Catches files written by side effects the tool registry doesn't see (browser downloads, script outputs, generated docs). Emits the same `file.*` event shape.

3. **Layer-3 live content streaming (DEFERRED to V2.5+).** For text files being incrementally appended (long markdown docs, scratch notebooks), a `file.chunk_appended` event delivers delta bytes for inline live-preview rendering. V2 ships the snapshot pattern (file appears + size grows + click reveals current snapshot); character-by-character streaming is a polish add.

**R2 storage architecture (locked):**

- Production: Cloudflare R2 bucket `synthetos-prod-artifacts`
- Staging: Cloudflare R2 bucket `synthetos-staging-artifacts`
- Local development: MinIO in Docker compose (S3-compatible, runs offline) — `FILE_STORAGE_BACKEND='s3'` + `S3_*` env vars pointing at `http://localhost:9000`

The codebase's existing `FILE_STORAGE_BACKEND` switch (`server/lib/env.ts:9`) + `getS3Client()` / `getBucketName()` helpers (`server/lib/storage.ts`) cover both backends with no code change required across environments. Signed-read URLs expire per the existing `deriveSignedUrlExpiry()` convention (60–300s).

**Spec scope for V2:**

1. Pattern (1) — runtime adapter wraps file-write tool calls, uploads to R2, emits events.
2. Pattern (2) — sandbox-side `chokidar` (or equivalent) watcher process; configured per the operator-session sandbox template (`infra/sandbox-templates/operator-session/`).
3. Pattern (3) — design note + interface placeholder; not implemented in V2.
4. FilesTab on OpenTaskView already renders file lists from event-driven state (V1 pattern from `ea_drafts`); confirms that the existing client code subscribes to `file.*` events on the `agent-run` channel and that the rendering matches the live use case.
5. Acceptance criterion (CI/e2e or operator-verified dogfood run): a long-running operator task writes 5 files at different chain-link boundaries; `file.created` / `file.modified` events are observed in the WebSocket stream before the terminal completion event; FilesTab shows the files updating live. Not a local unit test — requires a live operator-backend session or a stub that replays the event stream.

### 3.10 Memory + Voice Profile available to operator-mode runs

The EA's per-agent memory (V1 §3.12 — user context blocks via `update_memory_block`) and Voice Profile (V1 §3.11) need to be available inside operator-mode runs. The operator runtime executes inside an e2b sandbox; how does the sandbox access these?

**Pattern: inject as initial context, not real-time API.** At session start, the orchestrator + credential broker package up:

- The EA's memory blocks (`memory_blocks WHERE agent_id = ea.id`) — included in the initial context the operator runtime receives
- The EA's voice profile JSON (`voice_profiles WHERE owner_user_id = ea.owner_user_id`) — included in the initial context as a `<voice>` block prepended to the operator's system prompt
- The owner's identity context (timezone, working hours, recent activity summaries from the past 24 hours) — included in the initial context

The operator runtime treats these as immutable for the session duration. If memory updates land mid-session (rare — memory writes during a session are unusual for a single-user adaptive task), they're applied at chain-link boundaries, not mid-link.

**Why this pattern, not real-time API:**

- Memory + voice profile are small (KB, not MB) — fitting them in initial context is cheap
- Operator runtime is in a sandbox; calling back to SynthetOS over the network for every memory read is slow + introduces external dependencies the runtime can't recover from gracefully
- Initial context injection is the established pattern (operator-backend §3.4 already injects credentials this way)

**Mid-session updates that operator-mode runs PRODUCE:**

- New memory blocks the operator writes during the session (via `update_memory_block`) — written to DB via the operator runtime's tool-call path; appear in the next session's initial context
- Voice profile is NOT updated by operator runs (voice profile is derived from sent mail by the periodic refresh job; operator runs don't trigger re-derivation)

Spec confirms the exact serialisation format of the initial-context bundle and the size budget.

### 3.11 Operator-mode duration / concurrency / approval defaults for the EA

The operator-backend (Spec D) ships per-subaccount settings for operator-mode duration / concurrency caps. The EA inherits those defaults unless the spec specifies EA-specific overrides.

**Spec D defaults (from operator-backend brief §3.14, v2 lock 2026-05-12):**

- Soft session cap: 120 minutes per chain link, auto-extend grace 30 minutes, hard stop at 150 minutes (configurable 30–240 min)
- Concurrent operator sessions per subaccount: **5** (Spec D v1 was 3; v2 raised to 5 — this is the shipped value)
- Max chain length per task: 50 chain links (configurable 1–500)
- Auto-extend per task: configurable per subaccount, default off

**V2 recommendation: EA inherits Spec D defaults.** No EA-specific overrides in V2. Reasons:

- The Spec D defaults are conservative — 120-min soft cap × N chain links is plenty for the use cases in §3.8
- Per-user EA concurrency caps would require a new schema field; not justified for V2 dogfood (single-user)
- If real-world EA usage shows the defaults are wrong, V2.5 adjusts per-EA defaults via existing per-subaccount-settings extension points

**Approval policy for operator-mode EA runs:**

- Tier 0–3: auto-allowed (same as V1 native)
- Tier 4–5: review-gated (same as V1 native — Calendar writes, etc.)
- Tier 6: **NOT available to the EA.** The EA's risk-tier ceiling is Tier 5 hard (per V1 §4 q3); V2 inherits. Actions requiring Tier 6 authority (send_email with unreviewed content, third-party Slack posts) are outside the EA's authority. Such requests fail closed — the owner is notified and must act manually, or route the action to an agent/template with explicit Tier 6 authority.
- **Operator mode does NOT raise the EA's risk ceiling.** Controller style is orthogonal to risk tier; the Tier 5 ceiling applies regardless of whether the action ran under native or operator controller.

Spec confirms whether any operator-mode-specific approval rules apply (e.g., should adaptive multi-step plans require operator approval at the PLAN level before execution? — open question for the spec author, recommendation: no, plans run under existing per-action approval rules to keep the model simple).

## 4. Spec-time decisions

### 4.A — Ratified constraints (spec must encode; no further operator input needed)

These are resolved. The spec author encodes them as invariants, not as open questions.

1. **Mid-session memory updates (§3.10).** Apply at chain-link boundaries, not mid-link. The operator-runtime's `update_memory_block` tool call waits for the next chain-link boundary before hot-reloading in-context memory.

2. **Initial-context bundle size budget (§3.10).** 4 KB hard cap for memory + voice profile combined. Priority when budget is exceeded: voice profile features > most-recent memory blocks > older memory blocks. Spec defines the exact serialisation and trimming algorithm.

3. **Operator-mode planning approval (§3.11).** Per-action approval only — no plan-level gate before execution begins. Adaptive operators cannot produce a final plan upfront; pre-execution plan approval blocks the use case.

4. **@\<DisplayName\> collision (§3.5).** When two agents share a display name, no score boost is applied and pure capability matching proceeds (`address_parse_result = 'collision'`). Already encoded in §3.5.

5. **CI gate naming (§3.3).** `scripts/verify-capability-map-shape.sh`, integrated with the existing `verify-*` gate convention.

6. **Delegation authorisation signal (§3.6).** Cross-owner delegation requires one of two explicit signals: (a) a named-owner or resource reference in the user intent ("Michael's calendar", "Michael's inbox", possessives that resolve to a known user in the subaccount), OR (b) an explicit owner-scoped capability request emitted by a trusted parent-agent tool call. If neither signal is present, delegation fails closed with a clarifying question — no fuzzy implicit delegation. Text parsing covers user-facing requests; the structured capability signal covers agent-internal delegation. Spec encodes both detection paths and the fail-closed clarifying-question response.

7. **Use case shortlist (§3.8).** V2 ships use cases #1 (complex client investigation) and #2 (multi-source synthesis) only. Use case #3 (calendar-aware multi-person orchestration) is V2.1, deferred until a second PA-provisioned user exists in the dogfood subaccount to exercise cross-ownership delegation end-to-end. Rationale: routing, credentials, and the privacy invariants must be proven with the simpler single-user operator-mode cases before multi-person scheduling complexity is added.

### 4.B — All decisions resolved

No open items remain. Spec authoring may proceed.

## 5. Out of scope (explicit non-goals)

| Out of scope | Belongs in |
|---|---|
| Real-time chat with the EA ("conversational PA") | Different product; not in roadmap |
| Customer productisation of the EA at a multi-customer tier | Not in roadmap; V2 remains internal dogfood |
| Cross-day persistent investigations (multi-day research projects owned by EA) | Operator-backend chain-resume supports it; use case not yet justified — defer until real demand |
| Operator-mode browsing the web for personal research | Requires IEE browser worker on e2b (separate spec `iee-browser-on-e2b`); deferred until that ships |
| `@<arbitrary user>'s PA` direct addressing | Routing to another user's PA happens via cross-ownership delegation (§3.6), not direct addressing |
| Operator-mode-specific approval rules beyond V1's tier-based gates | V2 inherits V1 approval policy; risk-tier ceiling Tier 5 stays |
| Real-time content streaming for text files (Layer-3 character-by-character) | Deferred to V2.5+ per §3.9; V2 ships snapshot pattern |
| Memory shared across multiple user-owned agents for the same user (e.g., Michael's EA and Michael's future Dev Agent share context) | Future additive primitive (`user_memory_blocks`) if a real need emerges; not in V2 |
| GlobalAskBar `@`-autocomplete UI | Phase 1.5 / V2.5 UX polish; V2 ships text-only `@` parsing |
| New page surfaces or new navigation primitives | Explicitly zero new mockups; reuse OpenTaskView, GlobalAskBar, run-trace renderer, EA detail page |
| Org-principal agents as a distinct ownership class for V2 routing | Not exercised by V2; existing org-scoped agents (orchestrator, heads) stay subaccount-NULL-owned |
| Bedrock AgentCore Runtime as a second ExecutionBackend adapter | Phase 3.5; candidate-list work, not V2 |

## 6. What unblocks when this ships

- **Executive Assistant becomes a Phase 3 standing autonomous operator.** Master brief §16.1 framing — "full standing operator" — is delivered in code.
- **Cross-ownership delegation is real.** Subaccount agents can call into user-owned agents whenever a task touches user-specific resources, with credentials and approval routed correctly.
- **Dev Agent (Phase 3) inherits everything.** Operator-mode + scope-aware routing + cross-ownership delegation + approval routing all work for any user-owned agent without EA-specific code branching. Dev Agent ships as a configuration + handler change, not a foundation change.
- **Live-file feel in OpenTaskView FilesTab.** Operator-mode tasks no longer feel "silent" during long runs — files appear as they're created, sizes grow as content is written, click opens current snapshot. The demo screen works for operator tasks the same as it does for native tasks.
- **The orchestrator's routing is genuinely declarative.** Routing rules emerge from capability declarations + scope + requester identity. Adding new user-owned agent types (financial assistant, research assistant, writing assistant) requires only a capability declaration + handler — no orchestrator-side branching.
- **The "PA as a sub-agent capability" pattern is proven.** Any future workflow ("schedule this meeting and make sure it fits", "send this report and CC my partner if it mentions vacation") inherits cross-ownership delegation by default.

## 7. Sequencing

**Mockups required for V2: ZERO.** Per §0.5 decision #6, V2 ships with no new mockups. Every visible surface reuses existing UI:

- Operator-mode tasks render in `OpenTaskView` (existing, unchanged) with the existing `r1-r17` operator-backend prototypes covering running / completed / failed / cancelled / fallback / chain-link / budget-exceeded states
- Run-trace events get new event types but render via the existing `RunTraceEventRenderer` (event-type variants, not new visual chrome)
- Operator mode status indicator in EA settings — a read-only field showing that operator mode is enabled (no toggle in V2; the migration enables it unconditionally for all EA instances per §3.2)
- Live file events update the existing FilesTab on OpenTaskView (no FilesTab redesign)
- Approval queue for cross-owner approvals — existing approval queue UI, displays new typed context for cross-owner items
- GlobalAskBar — orchestrator-side `@` parsing only; no UI changes
- Personal nav group + home Personal zone — unchanged from V1

If during spec authoring a genuinely new visual surface emerges, surface it explicitly to the operator before adding a mockup. Default posture: extend existing surfaces with new event types / labels / chips, not new components / pages.

**Build sequencing:**

1. Operator reviews this brief. All decisions are ratified (§4.A items 1–7; §4.B closed). Brief is ready for spec authoring.
2. Operator spawns a new Claude Code session, branch `claude/personal-assistant-v2-operator-{nonce}` off post-#291 main.
3. Session adopts `spec-coordinator`: brief intake (this doc) → spec authoring → `spec-reviewer` (Codex loop) → `chatgpt-spec-review` (manual rounds) → handoff to `feature-coordinator`.
4. Build session ships:
   - EA `controllerStyleAllowed` flip migration
   - `capability_map` `owner_user_id` axis + `computeCapabilityMapPure` extension + `verify-capability-map-shape.sh` CI gate
   - Orchestrator `RoutingContext.requester_user_id` propagation + matcher rule
   - `@PA` / `@MyAssistant` / `@<DisplayName>` intent-parser extension
   - Cross-ownership delegation routing rules + authorisation signal detection
   - Approval-owner rule + cross-owner approval queue display
   - Operator-mode EA use case handlers (use cases #1 and #2 from §3.8)
   - Live-file event emission in operator-backend runtime (tool-call interception + filesystem watcher)
   - Memory + voice profile injection into initial operator-session context
   - Doc-sync edits: `architecture.md` + master brief §5.6 (universal OpenTaskView invariant) + `docs/capabilities.md` (EA standing autonomous operator capability) + `KNOWLEDGE.md` patterns from build session
5. Phase 3 (`finalisation-coordinator`) ships the chatgpt-pr-review + MERGE_READY transition.

Estimated effort: ~2 weeks for the build session. The headline work is the cross-ownership delegation + approval-owner routing — each touches multiple service boundaries and needs careful testing. Everything else is mechanically small (single-file extensions).

**Concurrency with `iee-browser-on-e2b`:** YES, run concurrent. Conflict surface is small — V2 touches `server/config/c.ts` (EA seed flip), `server/services/capabilityMapService.ts`, orchestrator intent parser, operator-backend runtime extension, approval queue. The browser migration touches `worker/src/browser/`, new `BrowserExecutionService`, DigitalOcean decommission. Migration numbering is the only conflict surface; standard S2-sync renumber.

**V2 dependencies — all merged:**

- Spec A `execution-backend-adapter-contract` — merged inline with Spec D
- Spec B `sandbox-isolation` — merged #287
- Spec C `operator-session-identity` — merged
- Spec D `operator-backend` — merged #288
- `user-owned-agents` — merged inline with PR #291
- `personal-assistant-v1` — merged #291

No further predecessor work required. V2 is ready to build the moment the brief is ratified.

**Branch:** `claude/personal-assistant-v2-operator-{nonce}` off post-#291 main.

## End of brief
