# Brief — Overnight Digest (per-org morning synthesis)

**Status:** DRAFT v1 (2026-05-18) — operator-captured from LinkedIn trend analysis + post-merge gap re-assessment
**Type:** Decision / scope brief — NOT an implementation spec
**Build slug:** `overnight-digest`
**Class:** Significant (UI-touching; mockup round required before spec authoring)
**Source pattern:** mnemo-cortex (https://github.com/GuyMannDude/mnemo-cortex) 5-bucket nightly synthesis prompt; localmem (https://github.com/jordanaftermidnight/localmem) consolidation cadence and "never drop named entities" preservation rule. Pattern lift only — no code adoption.
**Surfaces validated against main:** commit `6e48183` (2026-05-19). All referenced schemas (`taskDeliverables`, `skillAmendments`, `systemIncidents`, `workspaceMemoryEntryTierTransitions`), services (`correctionPatternDetectorJob`, `taskApprovalService`), and event types (`memory.block.promoted`, `memory.retrieved`) confirmed extant.

## Table of contents

1. Problem
2. Goal
3. Non-goals
4. Proposed approach (architect locks at spec)
5. Operational constraints
6. Rollout & rollback
7. Files in scope
8. Out of scope
9. Success criteria
10. What unblocks when this ships
11. Concurrent safety note
12. Mockup round
13. Provenance
14. How to start

---

## Problem

SynthetOS now produces all the raw material required to tell an operator "here's what your business learned overnight":

- `closed-loop-skill-improvement` (PR #353, merged 2026-05-18) — morning queue of amendment proposals per skill, peer-reviewed
- `memory-tiered-consolidation` (PR #351, merged 2026-05-18) — `memory.block.promoted` events as blocks crystallise from episodic to semantic / procedural
- `systemIncidents` — opened, escalated, resolved overnight, with agent diagnoses attached
- `tasks` + `taskDeliverables` — closed tasks and the work produced
- `approvals` — granted, rejected, or expired since yesterday
- `correctionPatternDetector` — daily failure clusters
- `agentExecutionEvents` — durable timeline per run

Nothing rolls these up. Operators wake up to a list of unread amendment proposals in one queue, scattered incident notifications in another, silent memory promotions in a third, and a Kanban board that doesn't distinguish "completed last night" from "completed last Tuesday." No single artefact answers the obvious question: **what did my agents figure out, fail at, decide, and ship overnight?**

The LinkedIn pitch ("woke up to 537→548 patterns, 1360→1419 links, new lessons captured while I was sleeping") describes exactly the narrative surface we lack. Our underlying data is richer than the OP's; our operator-readable output is poorer.

## Goal

Add a per-org nightly digest. One LLM call per org per night, synthesising the prior 24h into five buckets:

1. **Shipped** — closed tasks and the deliverables produced
2. **Decided** — approvals granted / rejected; skill amendments accepted / rejected
3. **Blocked** — open incidents; escalated tasks; rejected amendments; cost-ceiling terminations
4. **Cross-subaccount patterns** — failure clusters and amendment patterns appearing across multiple clients within the same org
5. **Lessons learned** — new memory promotions (especially `semantic → procedural`); new regression cases registered

Surface as a "Morning Digest" card on the org admin landing; also writeable to a per-org archive for trending. Defaults OFF behind a feature flag; flag-on per org via org settings.

## Non-goals

- **DO NOT** ship per-subaccount digests in v1. Org-level only. Per-subaccount roll-up is a follow-up trigger.
- **DO NOT** ship real-time or streaming digests. Nightly batch only.
- **DO NOT** do cross-tenant pattern detection (same non-goal as `closed-loop-skill-improvement`).
- **DO NOT** become a second writer of agent memory. Digest is read-only over existing tables.
- **DO NOT** ship push / email / Slack delivery in v1. In-app card + archive only.
- **DO NOT** add action affordances inside the digest. Deep-links to existing surfaces (amendment queue, incident detail, task board) only. The digest is a glanceable summary, not an action centre.
- **DO NOT** include LLM cost or token spend in the buckets. Spend dashboards exist; digest is operations-facing, not finance-facing.

## Proposed approach (architect locks at spec)

### Job and synthesis
- New pg-boss job `org-digest:nightly`, fires once per org per night per local-business-hours window (architect locks timezone handling)
- Idempotent per `(org_id, digest_date)` — re-running for the same org+date is a no-op or returns existing row
- Reader service fans out parallel reads from: `tasks`, `taskDeliverables` (schema: `taskDeliverables.ts`), `taskApprovalService`-decided actions (architect locks the exact decision-row source; `actions` and approval flow tables candidate), `skill_amendments` (schema: `skillAmendments.ts`), `system_incidents` (schema: `systemIncidents.ts`), `workspace_memory_entry_tier_transitions` (schema: `workspaceMemoryEntryTierTransitions.ts` — the canonical promotion audit trail per memory-tiered-consolidation §10.3), output of `correctionPatternDetectorJob`, and the `memory.block.promoted` / `memory.retrieved` event stream on `agentExecutionEvents`.
- LLM synthesis via `llmRouter.routeCall(taskType=org_digest_synthesis)`, frontier-class model, structured 5-bucket prompt
- **Preservation rule (lifted from mnemo-cortex, verbatim):** *"Preserve key facts, decisions, tool results, and action items. Compress aggressively but never drop named entities, URLs, agent names, skill names, error messages, or numeric IDs."*

### Persistence
- New `org_digests` table — `org_id`, `digest_date`, `summary_json` (5 buckets, structured), `model`, `config_version`, `generated_at`, `source_window_start`, `source_window_end`. Org-scoped, RLS-protected.
- Append-only; never updated in place. Re-runs for the same date are idempotent no-ops.

### UI surface
- New "Morning Digest" card on the org admin landing page — collapsed glanceable summary, expand to read the 5 buckets in full
- New archive page to browse prior digests (calendar-style)
- Deep-links from each digest item into the existing surface (amendment review drawer, incident detail, task detail)

## Operational constraints

- Digest synthesis is a single bounded LLM call per org per night. Bounded cost ceiling — architect locks the per-call budget.
- If the synthesis call fails (router exhaustion, timeout), the digest is marked `degraded` with the raw 5-bucket counts but no narrative summary. Operators still see structure; the digest is never silently absent.
- Tenant isolation: every read must filter by `organisation_id` at SQL. RLS enforcement.
- p95 page-load latency for the landing card must not regress beyond the existing org landing baseline.

## Rollout & rollback

- Feature flag `ORG_DIGEST_ENABLED`, default OFF in every environment
- Flag-on per org via org settings (architect locks whether platform_admin enables, or org_admin opt-in)
- Flag-off behaviour: no nightly job fires, no digests written, landing page card hidden — exact pre-build state
- Rollback: flip flag OFF. Existing digest rows remain in place for audit but are unreferenced.

## Files in scope (architect locks at spec authoring; mockup round runs first)

- Mockup: `prototypes/overnight-digest/` (landing card, expanded view, archive index, digest detail)
- New job: `server/jobs/orgDigestNightlyJob.ts`
- New service: `server/services/orgDigestReaderService.ts` + `*Pure.ts`
- New service: `server/services/orgDigestSynthesisService.ts` + `*Pure.ts`
- New schema: `server/db/schema/orgDigests.ts`; migration under `server/db/migrations/`
- Update `server/db/schema/index.ts`, `rlsProtectedTables.ts`
- New routes: `GET /api/orgs/:orgId/digests/latest`, `GET /api/orgs/:orgId/digests/:date`, `GET /api/orgs/:orgId/digests` (paginated archive)
- New client surfaces: `MorningDigestCard.tsx` on `OrgLandingPage.tsx`; new `OrgDigestArchivePage.tsx`; new `OrgDigestDetailPage.tsx`
- New permission key: `view_org_digest` (granted to `org_admin`, `platform_admin`)
- Feature flag: `ORG_DIGEST_ENABLED` in `server/config/featureFlags.ts`
- Tests: pure reader fan-out shape, pure synthesis prompt assembly, idempotency contract, RLS isolation across orgs, degraded-mode behaviour

## Out of scope

- Per-subaccount digests (deferred trigger: operator demand after v1 ships)
- Email / Slack / push delivery
- Cost or token-spend buckets
- Action affordances inside the digest beyond deep-links
- Cross-org / platform-level digests
- Digest scheduling beyond daily (no hourly, no weekly roll-up in v1)
- Digest customisation per operator (one shape per org in v1)

## Success criteria

1. An org admin opens the landing page and sees a single readable digest summarising the previous 24h of agent activity within the existing landing-page p95 latency budget.
2. Digest never crosses `organisation_id`. RLS fuzz tests pass.
3. Digest is idempotent — re-running for the same `(org_id, digest_date)` returns the same row and never duplicates.
4. Digest synthesis completes within its per-call cost ceiling.
5. Degraded-mode digests render the structural buckets (counts + key entities) when the synthesis LLM call fails; never silently absent.
6. Flag-off behaviour: no nightly job fires, no digests written, no landing card visible — bit-identical to pre-build state.

## What unblocks when this ships

- "While you slept" narrative becomes deliverable in marketing and sales conversations, anchored in real production data.
- Operators get a single morning surface to triage instead of three separate queues.
- Foundation for per-subaccount roll-up (Phase 2) and push delivery (Phase 3).
- Cross-subaccount pattern bucket creates demand signal for the cross-tenant archetype work (currently a deferred speculative bet).
- A consolidated nightly artefact becomes the natural input for the `memory-outcome-feedback` build — outcome verdicts in the digest can be referenced by future memory-feedback work.

## Concurrent safety note

Read-only over existing tables; one new table; one new nightly job; one new landing card. No file overlap with `task-preview-mode`, `browser-vision-grounding`, `browser-hardening-primitives`. Composes cleanly with the already-merged `memory-tiered-consolidation` (consumes `memory.block.promoted` events) and `closed-loop-skill-improvement` (consumes amendment accept / reject events). Safe to run concurrent with all in-flight pattern-lift builds.

## Mockup round

UI-touching. Mockup round runs BEFORE spec authoring. Mockup-designer should produce hi-fi clickable prototypes covering:

1. Org landing page with the collapsed Morning Digest card visible
2. Expanded digest view showing all five buckets
3. Archive index (calendar of prior digests)
4. Digest detail page for a specific past date
5. Degraded-mode digest (synthesis failed, structural buckets only)

The card must be glanceable in under 5 seconds and link out cleanly without becoming an action centre itself. Apply the five frontend hard rules: start from the operator's primary morning task, default to hidden, one primary affordance per bucket (the deep-link), inline state beats dashboards, non-technical-operator readable.

## Provenance

LinkedIn trend analysis 2026-05-18 (operator-anchored deep dive on persistent-memory / overnight-agent post + 5 linked repos). After `closed-loop-skill-improvement` (PR #353) and `memory-tiered-consolidation` (PR #351) closed the prior two gaps, this remains the highest-leverage gap from that analysis.

External pattern provenance: 5-bucket synthesis structure from mnemo-cortex's `mnemo-dream.py`; "never drop named entities" preservation rule lifted verbatim. No external code adoption; pattern lift only.

## How to start (paste into a new Claude Code session)

```
launch spec-coordinator from tasks/builds/overnight-digest/brief.md
```
