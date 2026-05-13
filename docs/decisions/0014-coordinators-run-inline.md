# ADR-0014: Coordinators run INLINE in the main session, never dispatched as sub-agents

**Status:** accepted
**Date:** 2026-05-13
**Domain:** agent fleet, pipeline architecture
**Supersedes:** _(none)_
**Superseded by:** _(none)_

## Context

The Claude Code agent fleet has three coordinator agents — `spec-coordinator` (Phase 1: spec authoring + mockup + spec-reviewer + chatgpt-spec-review), `feature-coordinator` (Phase 2: architect + builder + pr-reviewer + branch-level review pipeline), and `finalisation-coordinator` (Phase 3: S2 sync + chatgpt-pr-review + merge) — plus `audit-runner` (codebase audits). Each coordinator's playbook dispatches multiple downstream sub-agents (architect, builder, mockup-designer, the four reviewers, chatgpt-pr-review, chatgpt-spec-review). The Claude Code runtime returns a hard error (`No such tool available: Task. Task is not available inside subagents.`) when a dispatched sub-agent attempts to dispatch a further sub-agent. Operators have repeatedly tried to launch coordinators via `Agent({subagent_type: "feature-coordinator", ...})`, breaking the pipeline at its first dispatch step. Originating KNOWLEDGE entry: `[2026-05-08] Pattern — Coordinators run INLINE in the main session, never dispatched as sub-agents` (trust-verification-layer Phase 2 launch attempt).

## Decision

We will run `spec-coordinator`, `feature-coordinator`, `finalisation-coordinator`, and `audit-runner` INLINE in the main Claude Code session. The operator's entry phrase (`launch feature coordinator`, `launch finalisation`, `spec-coordinator: <brief>`, `audit-runner: <mode>`) signals the main session to ADOPT the playbook — read the agent file at `.claude/agents/<name>.md` and execute its steps directly. It does NOT mean call `Agent({subagent_type: "<coordinator>"})`.

For the three coordinators this is a hard requirement, not a preference (without inline execution the pipeline breaks at first dispatch). For `audit-runner` it is a strong preference so the TodoWrite task list stays visible to the operator.

Two valid entry paths:
1. Fresh session: open a new Claude Code session, type the entry phrase as the first message, the main session adopts the playbook.
2. In-flight adoption: operator types the entry phrase mid-session, the current main session reads the agent file and follows it directly. Same outcome.

## Consequences

- **Positive:**
  - Coordinator dispatches issue from the main session's top-level `Agent` context — pipeline works as designed.
  - Operator sees the full TodoWrite list of the coordinator's plan, not a hidden sub-agent thread.
  - No silent breakage on Phase 2/3 launches.
- **Negative:**
  - Operator entry phrases are not first-class — they require the main session to recognise them and adopt the playbook (versus a simple `Agent` call).
  - The main session's context is consumed by the coordinator playbook for the duration of the build phase.
  - Documentation must repeat the inline rule across every coordinator file (CLAUDE.md, agent definitions, ADR) — there is no runtime enforcement.
- **Neutral:**
  - Leaf sub-agents (architect, builder, reviewers) continue to be dispatched normally from the main session.

## Alternatives considered

- **Allow coordinators as dispatched sub-agents with the runtime widening `Task` access** — rejected. The platform constraint is upstream of this codebase; we cannot change it. Even if we could, nesting coordinator dispatches loses operator visibility into the build pipeline's TodoWrite list.
- **Reshape coordinators to be single-pass (no further dispatches)** — rejected. The three-phase pipeline is the product; coordinators ARE multi-dispatch orchestrators by design.
- **Run coordinators in a separate top-level Claude Code session via inter-process channel** — rejected. Heavyweight infrastructure for a problem that the inline rule solves with zero code.

## When to revisit

When the Claude Code runtime supports `Task` inside sub-agents (i.e. removes the `No such tool available: Task. Task is not available inside subagents.` error), the inline rule can relax. Until then: permanent constraint.

## References

- Originating KNOWLEDGE entry: `KNOWLEDGE.md` `[2026-05-08] Pattern — Coordinators run INLINE in the main session, never dispatched as sub-agents`
- Agent definitions: `.claude/agents/spec-coordinator.md`, `.claude/agents/feature-coordinator.md`, `.claude/agents/finalisation-coordinator.md`, `.claude/agents/audit-runner.md`
- Fleet section: `CLAUDE.md § Local Dev Agent Fleet`, "Common invocations" sub-section
- Runtime error: `No such tool available: Task. Task is not available inside subagents.`
