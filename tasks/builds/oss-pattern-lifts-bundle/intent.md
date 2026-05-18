# Intent — oss-pattern-lifts-bundle

**Provisional slug:** oss-pattern-lifts-bundle
**Brief source:** docs/oss-pattern-lifts-bundle-brief.md
**Date:** 2026-05-18
**Scope class:** Significant

---

## Problem Statement

We have two hand-rolled implementations of the same pattern — "pause a long-running job, wait for an external event, resume cleanly" — in `agentResumeService.ts` (OAuth integration-required gate) and `dispatch.ts` (workflow approval gate). Every new long-running pattern reinvents this by hand. The spec covers the generalised waitpoint primitive only; the pre-merge prompt-eval suite is deferred until the skip criterion in the brief is triggered.

## Desired Outcome

A single, generalised `waitpoints` table + `waitpointService` that any long-running pattern can use to pause, wait for an external event (approval, OAuth, external API callback, etc.), and resume cleanly. Both existing call sites — `agentResumeService` (OAuth) and `dispatch.ts` (approval gate) — migrate to the primitive within this build, gated by a single `WAITPOINT_PRIMITIVE_ENABLED` env var for rollback safety. Future patterns (data-prep gates, compliance review waits, vendor turnaround) use the same primitive without reinventing the wheel.

## Non-Goals

- Full Trigger.dev adoption (second runtime alongside pg-boss).
- Full promptfoo adoption or pre-merge prompt-eval suite (deferred — skip criterion not triggered; separate Standard build when it is).
- Composio adoption or connector build (deferred — no product-pull today).
- Any new UI surfaces or operator-facing screens for waitpoints (headless primitive only in V1).
- Retention or archival strategy for completed/expired waitpoints (deferred to V2).
- Staged rollout — `WAITPOINT_PRIMITIVE_ENABLED` is a migration safety switch, removed in the follow-up cleanup PR once production confirms both sites work.

## Affected Capability Area

Agent Runtime, Audit & Governance

## User / Operator Impact

Platform-internal primitive — no direct operator surface in V1. Operators using OAuth integration flows and approval-gated workflows get more consistent, auditable resume behaviour as a side effect of the call-site migrations.

## Risk Surface

server/db/schema, server/routes, RLS migrations, agent runtime

## Assumptions

- `agentResumeService.ts` OAuth resume path and `dispatch.ts` approval resume path are the only two existing call sites; no third hidden implementation exists.
- `sendWithTx` (`server/lib/pgBossTxSend.ts`) covers transactional enqueue — `completeWaitpoint` uses it to atomically write `status: 'completed'` and enqueue the resume job in one DB transaction.
- `deriveTokenHash` (sha256 via `crypto.createHash`) from `agentResumeService.ts` is reused by `waitpointService` — no new cryptography library.
- `bound_run_id` is required for all V1 use cases (both OAuth and approval bind to a run); nullable column is future-proofing for system-level waits only.

## Open Questions

None — all resolved in grill-me.

## Duplication / Strategy Check

| Output | Value |
|---|---|
| Duplication assessment | clear |
| Strategic fit | clear |
| Recommendation | proceed |

**Reasoning:** No Asset Register row or in-flight spec covers a generalised waitpoint primitive. `execution-infrastructure` (Agent Runtime, Mature) and `trust-verification-layer` (Audit & Governance, Growth) are the closest existing capabilities — this build extends both rather than duplicating. Both clusters have active Mature/Growth rows; Strategic fit = clear via the multi-cluster most-conservative-wins rule.

---

## Grill-me Q&A

*Conducted 2026-05-18. Operator decisions in bold.*

**Q1 — Scope: prompt-eval suite in or out?**
Skip criterion not triggered — no production regression found by clients before us. Prompt-eval suite is deferred to a separate Standard build when the criterion is met.
**Decision: Out of scope.**

**Q2 — Migration scope: primitive only, or also migrate both call sites in V1?**
Both migrations land in the same PR as the primitive, gated by `WAITPOINT_PRIMITIVE_ENABLED`. Original paths remain until confirmed working in production.
**Decision: Both call sites migrate in V1.**

**Q3 — `completeWaitpoint` authority model: token-only or session+permission-key?**
Token is the credential for all kinds. Authority check happens at the route layer before calling the service. `waitpointService` never touches the permission system directly.
**Decision: Unified token-only model.**

**Q4 — Expiry race: hard cut-off or grace window?**
Hard cut-off matches current OAuth behaviour. TTL set generously; legitimate completions should not land in the final seconds. If they do, the caller retries with a new waitpoint.
**Decision: Hard cut-off, no grace window.**

**Q5 — Tenant scope: org-only RLS or dual-GUC?**
Waitpoints are infrastructure primitives bound to org-scoped runs. `subaccount_id` is a metadata column, not an RLS predicate.
**Decision: Org-scoped RLS only (`app.organisation_id` GUC).**

**Q6 — Resume dispatch: unified queue-based or split?**
All kinds enqueue to `resume_queue` via `sendWithTx`. OAuth kind gets a new `agent-run-resume-from-waitpoint` pg-boss job. Completion atomicity guaranteed: status write + job enqueue in one transaction.
**Decision: Unified queue-based for all kinds.**

**Q7 — Stale bound run at expiry?**
Expiry sweep checks if bound run exists before emitting. If gone: log `waitpoint.expired_no_run`, skip, continue.
**Decision: Silent discard with a log line.**

**Q8 — Feature flag granularity?**
Single `WAITPOINT_PRIMITIVE_ENABLED` env var. Both call sites switch together. Removed in a follow-up cleanup PR after production confirmation.
**Decision: Single env var.**
