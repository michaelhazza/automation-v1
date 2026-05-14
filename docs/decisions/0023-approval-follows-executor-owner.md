# ADR-0023: Approval ownership follows the executor's data boundary, not the request origin

**Status:** accepted
**Date:** 2026-05-13
**Domain:** agent delegation, approvals, personal assistant

## Context

The personal-assistant-v2-operator build introduced cross-owner delegation: an agent owned by one user (e.g., Sarah's Orchestrator) can delegate a sub-step to an agent owned by another user (e.g., Michael's Executive Assistant). When the delegated agent proposes an action that requires approval, a choice must be made: whose approval queue does the proposal land in?

Two options exist: (A) route to the initiating user (Sarah), because she triggered the parent task; (B) route to the executor's owner (Michael), because the proposed action uses Michael's credentials and touches Michael's data.

The spec (`tasks/builds/personal-assistant-v2-operator/spec.md`) settled this in Appendix B item 8 after spec-reviewer rounds 1-5 and adversarial-reviewer review: approval follows the executor's data boundary.

## Decision

For cross-owner action proposals inside a delegated sub-run, `actions.approver_user_id` is set to `executor_agent.owner_user_id` (Michael), not the initiating user (Sarah). Same-owner runs preserve the V1 default: `approver_user_id = NULL`, which resolves to the initiator-defaulted path unchanged.

Implemented in `crossOwnerDelegationAuthorisationPure.ts`. The column is set at proposal-write time; no post-write mutation is permitted (same single-writer invariant as V1 approvals).

## Consequences

- **Positive:**
  - Michael sees and approves actions against his own data — correct data stewardship.
  - Sarah cannot accidentally approve actions that consume Michael's credentials.
  - The approval queue ownership is consistent with the credential ownership boundary (credentials follow the executor's owner — V1 invariant, unchanged).
- **Negative:**
  - Sarah (the task initiator) has no direct visibility into whether Michael's approval is pending or blocked. She sees a `cross_owner_substep.awaiting_initiator_decision` event with status only, not source data.
  - Operator education needed: initiators must understand that cross-owner sub-steps can stall if the executor's owner is unavailable.
- **Neutral:**
  - `actions.approver_user_id` is nullable in V1; this decision adds a non-null write path for cross-owner cases without a schema change.

## Alternatives considered

- **Route to initiator (Sarah)** — rejected. Sarah has no access to Michael's data or credentials; approving on Michael's behalf would be a privilege escalation. The executor's data boundary must control approval.
- **Dual approval (both Sarah and Michael must approve)** — rejected. Adds coordination complexity for the common case where Michael simply delegates to the EA for convenience. Revisit if a "co-approval" product requirement surfaces.
- **Inherit initiator approval policy** — rejected. Initiator policy may allow actions that executor's owner has explicitly restricted (e.g., Michael has a lower approval threshold for calendar writes than Sarah's org default).

## When to revisit

- When a "co-approval" workflow is requested (both initiator and executor's owner must approve).
- When a delegated sub-step involves shared resources owned by neither the initiator nor the executor.

## References

- Spec: `tasks/builds/personal-assistant-v2-operator/spec.md` Appendix B item 8
- Implementation: `server/services/crossOwnerDelegationAuthorisationPure.ts`
- Related ADR: `0011-operator-backend-chain-resume-model.md`
