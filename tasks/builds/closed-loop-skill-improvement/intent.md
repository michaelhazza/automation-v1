# Intent — closed-loop-skill-improvement

**Provisional slug:** closed-loop-skill-improvement
**Class:** Major
**Date:** 2026-05-18
**Author:** Michael

---

## Problem Statement

The existing skill customisation model is fork-based: when a subaccount wants to modify an inherited skill it receives a full independent copy, severing inheritance from future system updates. There is no governed mechanism to propose, review, and track bounded behavioural improvements on top of inherited skills. When a scorecard fail occurs, operators must either fork the skill (breaking inheritance), manually update skill text, or do nothing. The correction-pattern detector surfaces failure clusters but cannot act on them. The gap between "the skill failed" and "the skill is improved" is entirely manual and untracked.

## Desired Outcome

A bounded, human-gated closed loop: scorecard fail triggers root-cause synthesis, a typed overlay amendment is drafted and peer-reviewed, queued in the existing morning review surface for operator approval, and — if accepted — stacked on the inherited skill base without forking. Rejected amendments become regression test cases. The loop is schema-validated, bounded per skill per week, anti-recursive, and gated by mandatory human approval. Accepted amendments are deterministically composed on top of the inherited skill; the system base remains authoritative.

## Non-Goals

- Upward promotion of subaccount amendments to system tier (deferred; requires ring rollout)
- Org-scoped amendments that fan out to all subaccounts in one action
- Autonomous amendment activation without human approval (prohibited by design)
- Cross-subaccount pattern detection or learning of any kind
- Prompt mutation or DSPy-style optimisation
- Automatic semantic conflict reconciliation of contradictory amendments
- Shadow-mode proposal simulation against historical runs before surfacing
- Amendment portability across subaccount clone, template, or export paths

## Affected Capability Area

Agent Runtime, Audit & Governance, Approvals

## User / Operator Impact

Subaccount admins and org admins gain a morning review section in the existing Inbox showing proposed skill improvements surfaced from overnight scorecard failures. One-click accept applies the typed overlay to the next run without touching the inherited skill text. Rejected proposals become regression cases automatically. No manual fork, no skill-text editing, no tracking required for incremental improvements on inherited skills.

## Risk Surface

server/db/schema, server/routes, agent runtime, approvals

## Assumptions

- Scorecard subsystem is operational (LLM-as-judge, immutable verdict rows, deterministic sampling)
- Correction pattern detector is operational (daily clustering by embedding similarity)
- Memory layer with typed entries and decay is operational
- `getOrgScopedDb` / `withOrgTx` are the mandatory access patterns for all new tenant-scoped tables
- No live external customers (pre-production per `docs/spec-context.md`)
- Skill resolution precedence (subaccount > org > system) continues for forked skills; amendments apply only to the inherited-skill path

## Open Questions

- None — all major design decisions resolved in the dev brief (org-inherited amendments in Phase 1 scope, dual-FK schema for system_skill_id / org_skill_id, custom subaccount skill exclusion, peer-review model choice, deduplication and freshness window parameters are empirically tunable)

## Duplication / Strategy Check

| Output | Value |
|---|---|
| Duplication assessment | clear |
| Strategic fit | clear |
| Recommendation | proceed |

**Rationale:** Three Asset Register rows share clusters with this build — `skill-system` (Agent Runtime, Mature), `trust-verification-layer` (Audit & Governance + Agent Runtime, Growth), and `human-in-the-loop` (Approvals, Mature). The `trust-verification-layer` row describes "continuously improving" as an aspiration but implements only scorecard capture and operator correction. The amendment primitive (`skill_amendments` table, typed overlay composition, automated proposal loop, morning amendment queue) does not exist in any deployed capability or in-flight spec. This build implements the mechanism by which trust-verification-layer's aspiration is realised — extension, not duplication. No in-flight intent.md or spec covers this space. Strategic fit is clear: Agent Runtime (Mature), Audit & Governance (Growth), and Approvals (Mature) are all active clusters.

---

## Grill-me Q&A

**Q1 — Proposer trigger mechanism**
Subordinate dispatch: the `scorecardJudgeJob` sends a `failure:post-mortem` pg-boss message inside the same transaction that writes the verdict row. Post-mortem job runs asynchronously with its own teamSize and retry budget. No polling.

**Q2 — Morning queue UI shape**
Band/section below existing tab content on the Needs Review tab — not a third tab. Tab pill (Briefs / Needs Review) is untouched. Consistent with Round 3–5 mockups which are the design source of truth.

**Q3 — Peer reviewer vendor**
GPT-class via OpenAI API (already configured). Spec declares the requirement (different model family, frontier-class, binary `addresses_root_cause` + one-sentence `reasoning`) and names OpenAI as the concrete integration.

**Q4 — Regression set storage**
New `skill_regression_cases` table: `skill_id`, `scorecard_judgement_id`, `amendment_id` (nullable), `tag` enum (`fix_proposed` | `fix_wrong`), `org_id`, RLS-protected. Bench infrastructure replay mechanics are callable from the regression replay job without sharing bench_runs storage schema.

**Q5 — Feature flag for Phase 1 Step 1 schema**
No feature flag. The resolver extension is data-gated: an empty `skill_amendments` table produces identical output to today. Consistent with `spec-context.md` (`feature_flags: only_for_behaviour_modes`; this is not a behaviour mode switch).

**Q6 — `learned_failure_mode` memory entry type**
Deferred to Phase 2. RCA record on the `skill_amendments` row is sufficient Phase 1 provenance. Nothing in Phase 1 reads a `learned_failure_mode` entry back into agent runtime context. Added to Deferred Items in the spec.

**Q7 — Correction-pattern-detector changes**
Modify the existing `correctionPatternDetectorJob.ts` — add `failed-check-id + entity-type` as a second clustering dimension. Amendment-proposal output is additive; existing `suggest tightening pass marks` output contract is unchanged. No new job.

**Q8 — Rollback UI trigger path**
Skill detail page only (Phase 1). The S3 expanded amendment row Retire action gains an `incident_severity` selector for rollback-class retirements. Morning queue surfaces incident alerts at tier 1 with a link to the affected skill; operator executes rollback from the skill detail page. Queue = review pending; skill detail = manage accepted stack.
