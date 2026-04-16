# Deferred AI-First Features

> **Purpose:** Capture everything out of v1 scope so nothing is lost. This is a **queue, not a commitment.** Items here have been deliberately excluded from the current build to keep v1 shippable; promotion to active scope requires a fresh decision.
>
> **v1 scope (for reference):** three anchor features — The Pulse, Ingestive Onboarding (Phase 1), Demonstration-to-DAG. Everything else lives here.
>
> **Maintenance:** append new deferrals as they surface during v1 build. Do not edit or remove existing entries — if an item ships, mark it shipped with a date and the PR link, don't delete it. If an item is rejected outright, mark it rejected with the reason.

---

## Section 1 — Pieces cut from the three v1 features

These are explicit trims from the anchor features, documented so we know exactly what "Phase 2" of each looks like.

### Pulse — deferred

- **System scope.** v1 is Org + Subaccount only. System scope supervises platform-managed skills; different audience (platform operators, not agency staff). Add once the customer-facing surface is validated.
- **Per-user read state** (archive / mark-read / snooze / unread dots). Items leave lanes only when their underlying state changes in v1. Read state multiplies complexity (per-user tables, cross-device sync, "mark all read" semantics) without clear pull pre-launch.
- **Feed ranking engine** (personalised priority, ML-driven ordering). v1 uses deterministic lane + chronological ordering. A ranker needs signal we won't have until there's usage data.
- **Cross-subaccount unified lane** ("one Pulse across all my clients"). v1 is per-subaccount or org-summary. Merging lanes across subaccounts raises isolation and attribution questions better answered once the per-subaccount surface is in use.
- **Mobile-first approval UX.** Pulse v1 is responsive but desktop-shaped. Dedicated mobile approval flow (swipe-to-approve, push notifications, voice notes on rejection) is Phase 2.
- **Bulk actions beyond approve/reject** (bulk edit, bulk snooze, bulk reassign).
- **Lane-level SLAs and escalation** (auto-escalate items sitting in a lane too long).

### Ingestive Onboarding — deferred

- **Agency-signup entry.** Phase 2 extends the conversational intake to first-ever login; v1 triggers only on first-client-added. Agency-signup is tangled with billing, org setup, and user seeding — unrelated surface to the core value.
- **Real integration dry-run** for the first sandboxed run. v1 uses simulation with synthesised evidence against real integration metadata. Real dry-run needs per-integration read-only modes (sandbox accounts, rate-limit-safe stubs) that don't exist yet.
- **Intent-layer abstraction.** v1 compiles the conversation directly to a Playbook draft. An intermediate Intent object is speculative without a second consumer; extract if Demo-to-DAG or a third feature pulls in the same direction.
- **More than 3 precision checkpoints.** v1 locks to intent → data sources → approval rules. Additional checkpoints (tone-of-voice, brand voice, compliance constraints, budget ceilings) are Phase 2 when we know which ones users actually need pinned.
- **Multi-turn refinement after the first run.** v1 produces a Playbook, runs it once in simulation, then drops the user into Pulse. Iterative "now change this, re-simulate" loops are Phase 2.

### Demonstration-to-DAG — deferred

- **Real replay engine** for simulation preview. v1 uses static estimation (cost from skill metadata, time from historical runtimes, touchpoints from DAG actions). Real replay needs a historical-data harness we don't have.
- **"Turn this skill into a flow" entry from skill pages.** v1 has one entry: "describe the outcome." Additional entry points expand surface without demonstrated pull.
- **Multi-variant flow generation** ("show me three approaches"). v1 produces a single Playbook draft. Multi-variant adds compiler complexity (diverging strategies, variant scoring) without clear demand.
- **Importing an external demo video / recording** and compiling to a DAG. Out of v1 — focus stays on typed/spoken outcome descriptions.
- **Compiling live agent conversations** (Slack / chat transcripts) into Playbooks. Interesting but requires conversation-mining machinery outside v1.

---

## Section 2 — Ideas from the research brief not in v1

The research brief surfaced five top ideas and a long tail. Three were absorbed into v1 (Pulse, Ingestive Onboarding, Demo-to-DAG). The rest are parked here.

### Absorbed into v1
- **Default-state inversion** — every page opens with an AI-generated draft. Pulse and Onboarding both embody this.
- **Outcome-first entry** — users start from "what should happen," not "which tool." Demo-to-DAG.
- **Conversational operations at entry** — structured extraction at checkpoints. Onboarding.

### Deferred

- **Embedded simulation & replay as a first-class surface.** v1 has simulation only as a one-shot preview in Onboarding and static estimation in Demo-to-DAG. A full simulation workbench — inspect, modify, re-run any Playbook against historical data — is Phase 2.
- **Autonomous continuous-improvement loop.** Agent observes its own approval/rejection patterns, proposes Playbook edits, seeks approval, re-deploys. High leverage but needs baseline usage data and an approval UI that can handle "the agent is proposing a change to itself."
- **Cross-client pattern mining.** "Three of your clients approved a similar Playbook last month; want me to propose it for the others?" Needs a pattern-extraction service and explicit opt-in for cross-tenant learning.
- **Auto-compose Playbooks from recurring manual patterns.** Watch what operators do repeatedly, propose a Playbook that captures it. Needs operator-activity capture we don't have.
- **AI-generated runbooks.** When an agent fails a skill repeatedly, synthesise a runbook for human operators. Observability Phase 2.
- **Continuous eval harness.** Automated golden-path regression across Playbooks with AI-graded outputs. Requires eval-dataset curation.
- **Forecasting before commit.** Predicted outcomes, not just costs, before approving a Playbook run ("this will likely create 4 deals worth £x based on similar past runs"). Needs outcome attribution we're not tracking yet.
- **Voice-first interfaces.** Onboarding via voice, approval queue via voice, status via voice. Attractive but stretches the v1 surface.
- **Agent-to-agent negotiation / delegation.** One agent hands a subtask to another, negotiates scope. The three-tier agent model supports it architecturally; the UX doesn't exist.
- **Proactive alerting beyond thresholds.** AI detects anomalies in Pulse signals and surfaces them without a configured rule. Pulse v1 shows what happened; v2 could predict what's about to.
- **AI-driven cost optimisation.** Agent reviews its own model routing and suggests cheaper routes per skill with evidence. Ties into the model-agnostic positioning.
- **Customer-facing agent transparency.** End-client-facing view into what the agent did on their behalf (with agency-controlled redaction). Touches Client Health surface area — keep them aligned.
- **Audit / compliance automation.** Agent assembles compliance evidence packs (who approved what, when, under which policy). Valuable for enterprise tiers; out of v1.
- **Skill marketplace / library.** Agencies publish and share skills with attribution and revenue share. Platform play, not v1.
- **Long-context memory across runs.** Persistent agent memory beyond a single Playbook run. Infrastructure-heavy and risks cross-tenant leakage without careful scoping.
- **Brand-voice tuning per subaccount.** Style transfer on every customer-facing output, tuned from a sample of approved artifacts. Useful, not blocking.
- **Natural-language Pulse filters.** "Show me everything from clients in the lapsed pipeline that cost over £10 to produce." v1 uses structured filters via ColHeader.

---

## Section 3 — Horizon bets (not yet shaped)

Longer-horizon ideas that need more definition before they can be specced. Recorded here so we don't forget them.

- **Agent teams with internal roles.** Multi-agent composition where agents have specialised roles (researcher / writer / reviewer) and hand off internally. Related to `tasks/agent-teams-plan.md`.
- **Agent-initiated client-facing messages with liability framing.** Clear audit trail and agency-owned authorisation chain.
- **Zero-integration mode.** Agent operates entirely via email and chat for clients without CRM integrations.
- **Agency-operator analytics.** Which human operators approve fastest, which reject most, which edit before approving — closes the loop on HITL effectiveness.
- **Model-choice transparency per skill** with justification ("used the cheap model because this skill has a 99% success rate on it"). Ties to model-agnostic positioning.
- **Structural moat hardening.** Explicit investments in the moats listed in `docs/capabilities.md` — three-tier isolation, HITL gates, agency economics, playbook engine — that lift the floor without shipping a feature.

---

## Section 4 — Rejected / downgraded (with reason)

Items considered and declined, with reasoning preserved so we don't re-litigate.

- *(none yet — populate as things are explicitly rejected rather than just deferred)*

---

## How to use this document

- **Before adding a v1 scope creep:** check here first. If the item is already deferred, the decision has been made; re-open explicitly if the situation has changed.
- **After shipping any v1 feature:** scan Section 1 for the next Phase 2 increment. That's the natural next slice.
- **When a stakeholder raises an AI-first idea:** add it to the appropriate section with one-line rationale. Do not promote to v1 without explicit re-scoping.
- **When an item graduates to active scope:** move it to a dedicated spec doc; leave a one-line pointer here with the date and spec path.
