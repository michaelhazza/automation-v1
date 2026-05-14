# Decisions (ADRs)

Architecture Decision Records — the "why" behind durable choices.

## Why this is separate from KNOWLEDGE.md

`KNOWLEDGE.md` is an append-only stream of patterns, gotchas, and corrections. Most entries are observations: "this trips up a future session, here's the trap." That's useful but not the same as an architectural decision with rationale and trade-offs.

This directory captures the durable decisions: "we chose X over Y, here's why, here's what we'd reconsider if Z." Future sessions retrieve them by domain, not by date.

Lightweight ADR format inspired by Michael Nygard's original. Each ADR is one file, dated, immutable once accepted.

## Convention

- File naming: `NNNN-<short-slug>.md` where `NNNN` is sequential (`0001-`, `0002-`, ...) and `<short-slug>` is kebab-case. Pad to 4 digits.
- Status: `proposed` → `accepted` → `superseded by NNNN`. Once accepted, the file is immutable. Superseding is via a new ADR that points back.
- One decision per ADR. If a decision needs to be reconsidered, write a new ADR — do not edit the existing one.
- Keep them short. ≤300 lines. If it's longer, the decision belongs in a spec or in `architecture.md` and the ADR points there.

## Template

See [`_template.md`](./_template.md). Copy it for each new ADR.

## When to write an ADR vs a KNOWLEDGE entry

| Write an ADR | Write a KNOWLEDGE entry |
|---|---|
| Choosing between architectural options | Discovering a non-obvious codebase pattern |
| Locking in a contract or invariant the system depends on | Finding a gotcha that traps future sessions |
| Adopting / rejecting a primitive, library, or service | A user correction (always KNOWLEDGE) |
| Setting a policy (rate-limit, retention, security) | A learned convention you'd otherwise rediscover |
| The "why" matters for years | The "what" matters for next session |

When in doubt: KNOWLEDGE first, ADR if the decision keeps coming up.

## Discoverability

Future sessions retrieve ADRs by:
1. **Index.** [`README.md`](./README.md) below lists every ADR by domain.
2. **Grep by slug.** ADR slugs follow the same kebab-case convention as build slugs and review-log slugs.
3. **Cross-link from architecture.md.** When an architecture rule has an ADR backing it, link to the ADR file inline in `architecture.md`.

---

## Index

Update when adding ADRs.

| ADR | Title | Status | Domain |
|-----|-------|--------|--------|
| [0001](./0001-mixed-mode-review-agents.md) | Mixed-mode review agents (auto-fix mechanical, route directional) | accepted | review fleet |
| [0002](./0002-interactive-vs-walkaway-review-agents.md) | Interactive vs walk-away review agent classification | accepted | review fleet |
| [0003](./0003-workspace-identity-canonical-pattern.md) | Workspace identity uses canonical pattern, one workspace per subaccount | accepted | workspace identity |
| [0004](./0004-geo-skills-as-methodology-skills.md) | GEO skills implemented as methodology skills, not intelligence skills | accepted | skill system |
| [0005](./0005-risk-class-split-rollout-pattern.md) | Risk-class split rollout for read-vs-write enforcement gaps | accepted | rollout / enforcement |
| [0006](./0006-ghl-oauth-nonce-single-instance-constraint.md) | GHL OAuth nonce verifier — single-instance constraint | accepted | auth |
| [0007](./0007-consolidation-build-page-retirement.md) | Consolidation build page retirement | accepted | UI consolidation |
| [0008](./0008-sse-stream-token-auth.md) | SSE auth via short-lived signed stream-token (not long-lived JWT in URL) | accepted | auth |
| [0009](./0009-support-desk-canonical-not-conversations.md) | Support tickets use dedicated canonical tables, not `canonical_conversations` | accepted | support desk, data model |
| [0011](./0011-operator-backend-chain-resume-model.md) | Operator Backend — chain-resume and persistent profile required in V1 | accepted | operator backend, execution infrastructure |
| [0012](./0012-tagged-log-as-metric-convention.md) | Tagged-log-as-metric is the project's metrics convention | accepted | observability, metrics, logging |
| [0013](./0013-suppression-is-success.md) | Suppression is success under single-writer invariants | accepted | routes, services, single-writer invariants, observability |
| [0014](./0014-coordinators-run-inline.md) | Coordinators run INLINE in the main session, never dispatched as sub-agents | accepted | agent fleet, pipeline architecture |
| [0015](./0015-chatgpt-review-discipline.md) | ChatGPT review loops — convergence and diff-misreading discipline | accepted | review pipeline, chatgpt-pr-review, chatgpt-spec-review |
| [0016](./0016-frontend-consumer-simple-principle.md) | Frontend-first design principle — consumer-simple over capability-mapped dashboards | accepted | frontend, product design, UX |
| [0017](./0017-retrieval-ranker-v1-simplified.md) | Retrieval / ranker architecture — v1-simplified | accepted | retrieval / agents |
| [0018](./0018-overlay-stack-ownership.md) | Overlay stack ownership — central manager | accepted | frontend |
| [0019](./0019-job-result-and-review-loop-contracts.md) | Job result and review-loop state-machine contracts | accepted | workflow-engine / tooling |
| [0020](./0020-test-conventions-vitest-and-test-folder.md) | Test conventions — Vitest only, `__tests__/` folder, `.js` relative imports | accepted | tests / tooling |
| [0021](./0021-workflows-v1-v2-boundary.md) | Workflows V1 → V2 boundary contract | accepted | workflow-engine |
| [0022](./0022-workspace-inbound-webhook-db-exception.md) | Direct DB access in workspaceInboundWebhook route | accepted | auth, routes |
| [0023](./0023-approval-follows-executor-owner.md) | Approval ownership follows the executor's data boundary, not the request origin | accepted | agent delegation, approvals, personal assistant |
| [0024](./0024-service-layer-extraction-for-routes-touching-db.md) | Service-layer extraction for routes touching `db/schema/` — type imports via `shared/types/`, queries via services, new baselines require ADR sign-off | accepted | routes, services, layer architecture |

ADRs 0001-0005 were extracted from KNOWLEDGE.md historical "Decision" entries on 2026-05-03. The remaining 6 historical Decision entries stay in KNOWLEDGE.md as observations — they're either implementation patterns (not durable choices) or research notes (no decision to defend). Promote them to ADRs only if they keep being cited.
