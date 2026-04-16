# Spec Review Final Report — memory-and-briefings-spec

**Spec:** `docs/memory-and-briefings-spec.md`
**Review completed:** 2026-04-16T04:22:40Z
**Total iterations:** 5 (cap reached)
**Exit condition:** Lifetime iteration cap (5) reached after iteration 5 mechanical-only pass

---

## Table of Contents

1. [Iteration Summary](#iteration-summary)
2. [All Mechanical Changes Applied](#all-mechanical-changes-applied)
3. [Rejected Findings](#rejected-findings)
4. [HITL Decisions Resolved](#hitl-decisions-resolved)
5. [Open Findings at Cap](#open-findings-at-cap)
6. [Spec Health at Exit](#spec-health-at-exit)

---

## Iteration Summary

| Iteration | Findings | Mechanical applied | Directional / HITL | Rejected | Exit |
|---|---|---|---|---|---|
| 1 | 15 | 10 | 3 (checkpoint) | 2 | HITL pause |
| 2 | 6 | 5 | 1 (checkpoint) | 0 | HITL pause |
| 3 | 13 | 7 | 4 (checkpoint) | 2 | HITL pause |
| 4 | 12 | 7 | 3 (checkpoint) | 2 | HITL pause |
| 5 | 7 | 5 | 0 | 2 | Cap reached — final report |

---

## All Mechanical Changes Applied

### Section 3 — Phasing Plan

- **Iter 4 HITL 4.10:** Pulled `portalMode` column migration to Phase 1 data layer. Phase 1 now explicitly includes "`portalMode` column on `subaccounts` (text, default `'hidden'`) — required by Phase 3 onboarding (S5 step 8 sets this column); the S16 UI, toggle grid, and per-feature activation logic remain in Phase 4."

### Section 4.1 — Entry Decay Scoring & Pruning

- **Iter 4 mechanical 4.11:** Named the HNSW re-index job as `memory-hnsw-reindex` (pg-boss, one-shot, per-subaccount).

### Section 4.3 — Belief Conflict Resolution

- **Iter 1 mechanical:** Named the conflict detection service; specified `entityKey` column semantics.
- **Iter 3 mechanical:** Clarified that `entityKey` is distinct from `beliefKey`; cross-agent conflict detection runs on `(subaccountId, entityKey)`.
- **Iter 4 mechanical 4.9:** Added phase note: S8 injection from S3 is a no-op in Phase 1; activates when S8 lands in Phase 2.

### Section 4.4 — Self-Tuning Retrieval

- **Iter 1 mechanical:** Named `memoryCitationDetector` service and contract.

### Section 5.2 — Relevance-Driven Block Retrieval

- **Iter 1 mechanical:** Named embedding backfill job; clarified draft block exclusion at query time.
- **Iter 4 mechanical 4.12:** Named the embedding backfill job: `memory-blocks-embedding-backfill` (pg-boss, scheduled on deploy in Phase 2).

### Section 5.3 — Confidence-Tiered HITL

- **Iter 1 mechanical:** Defined `memory_review_queue` schema with all columns.
- **Iter 4 mechanical 4.1:** Clarified `clarification_pending` itemType: audit/state records; real-time delivery handled by S8 WebSocket path separately.
- **Iter 4 mechanical 4.2:** Renamed high-confidence tier action from "Auto-apply" to "Auto-process with no human gate" with clearer parenthetical.

### Section 5.7 — Auto-Synthesised Memory Blocks

- **Iter 1 mechanical:** `source` and `status` column semantics clarified.
- **Iter 2 mechanical:** `status: 'draft'` vs `pending_review` state machine tightened.
- **Iter 5 mechanical 5.1:** Added reconciliation note distinguishing new `source` column (`manual | auto_synthesised`) from existing provenance fields (`sourceRunId`, `sourceReferenceId`, `lastWrittenByPlaybookSlug`, `confidence`) and from `memory_block_attachments.source`.

### Section 5.7 — Stale review artifact

- **Iter 4 mechanical 4.3:** Removed stale review artifact "See Finding 3.13 note in sequencing."

### Section 6.2 — Per-Client Portal Toggles

- **Iter 4 HITL 4.10:** Added phasing note: `portalMode` column ships in Phase 1; S16 UI ships in Phase 4.

### Section 8.7 — Onboarding as a Playbook Bundle

- **Iter 4 HITL 4.8:** Added paragraph distinguishing `modules.onboardingPlaybookSlugs` (module-level declaration) from `onboarding_bundle_configs` (org-level selection/ordering). Two-layer pull-from-registry model explicitly stated.

### Section 9.4 — Document Upload & Processing

- **Iter 4 mechanical 4.4:** Named `configDocumentParserService`; stated 0.7 auto-apply threshold; specified confidence returned inline in LLM parser's JSON output.

### Section 10.3 — Data Model

- **Iter 3 mechanical:** Clarified `deliveryChannels` JSONB placement.

### Section 11.2 — Design: Two Agency-Level Artefacts

- **Iter 2 mechanical:** Corrected the trigger timing for portfolio artefacts.
- **Iter 4 HITL 4.6:** Replaced "The org subaccount ID is available on every organisation record" (factually incorrect — no such column exists on `organisations`) with: "The org subaccount is identified by querying `subaccounts WHERE isOrgSubaccount = true AND organisationId = ?` — a unique constraint ensures exactly one result per org. No schema change required."

### Section 11.4 — Portfolio Digest Content

- **Iter 5 mechanical 5.4:** Renamed "Review queue summary" to "Memory review queue summary" and added parenthetical: "(This refers to the `memory_review_queue` from S7 — not the existing `review_items` HITL queue, which covers agent action approvals.)"

### Section 11.6 — Delivery

- **Iter 5 mechanical 5.3:** Corrected the description. Removed the incorrect statement that the server job "passes the org subaccount ID to the DeliveryChannels component." Replaced with: the job reads the org subaccount's persisted `deliveryChannels` configuration and calls `deliveryService.deliver(artefact, deliveryConfig, orgSubaccountId)`.

### Section 14 — Open Questions

- **Iter 5 mechanical 5.5:** Closed OQ8 (onboarding bundle manifest storage). Body decision is DB table `onboarding_bundle_configs` per Section 8.7.
- **Iter 5 mechanical 5.6:** Closed OQ4 (Google Docs support). Body decision is Phase 3 behind integration check per Section 9.3.
- **Iter 5 mechanical 5.7:** Closed OQ2 (belief conflict clarification routing). Body decision is: queue always; real-time S8 if run in progress (phase-gated), per Section 4.3.

---

## Rejected Findings

| Iter | Finding | Reason |
|---|---|---|
| 1 | Auto-threshold trust-builds mechanism unclear | Mechanism is sufficiently specified for a spec; implementation detail not required at spec level |
| 1 | Portfolio rollup orchestration contract missing | Fixed-time fallback already in spec; orchestration contract is implementation detail |
| 3 | Section 10.5 inbox write guard specificity | Intentionally dropped per HITL decision 3.15 — "service is the enforcement boundary" is the correct level of spec detail |
| 3 | Section 9.2 `.schema.ts` sidecar files | Already adequately named and located; S21 in Phase 3 covers their creation |
| 4 | Finding 4.5 (inbox write guard) | Same as iter 3 rejection |
| 4 | Finding 4.7 (`.schema.ts` files) | Same as iter 3 rejection |
| 5 | Finding 5.2 (delivery channel source of truth split) | The `e.g.` language in Section 10.3 is intentional: each entity stores its own `deliveryChannels` JSONB column. This is a per-entity column pattern, not competing canonical homes. No ambiguity requiring spec change. |

---

## HITL Decisions Resolved

| Iteration | Finding | Decision | Applied change |
|---|---|---|---|
| 1 | 1.6 — Portfolio Briefing cadence | apply | Cadence set as Monday by default (configurable), after individual briefings complete |
| 1 | 1.11 — Conflict detection semantics | apply-with-modification | `entityKey` clarified as cross-agent identifier distinct from `beliefKey` |
| 1 | 1.13 — Onboarding bundle defined in spec vs OQ8 | apply | Section 8.7 explicitly states DB table; OQ8 now closed |
| 2 | 2.5 — Memory block `status` state machine | apply-with-modification | Full state machine: draft → pending_review → active/rejected; passive aging path added |
| 3 | 3.7 — `portalFeatures` column placement | apply | Column stays on `subaccounts` table (not a new table) |
| 3 | 3.9 — `memory_review_queue` vs existing `review_items` | apply | New table justified; existing table has non-null `actionId` FK constraint preventing reuse |
| 3 | 3.14 — Chat-based task creation tool naming | apply | Tool name is `config_create_scheduled_task` from existing toolset |
| 4 | 4.6 — Org subaccount ID retrieval | apply-with-modification | Replaced incorrect claim with correct query: `subaccounts WHERE isOrgSubaccount = true AND organisationId = ?` |
| 4 | 4.8 — `onboarding_bundle_configs` vs `modules.onboardingPlaybookSlugs` | apply-with-modification | Added two-layer pull-from-registry explanation to Section 8.7 |
| 4 | 4.10 — `portalMode` phasing dependency | apply-with-modification | `portalMode` column moved to Phase 1 data layer; S16 UI remains Phase 4 |

---

## Open Findings at Cap

None. All iteration 5 findings were either mechanical (applied) or rejected. No directional or ambiguous findings remain unresolved.

The following open questions in Section 14 remain genuinely open (not answered by the spec body):

- OQ1 — `recall(query, k)` lazy retrieval tool: deferred by design
- OQ3 — Maximum memory block injection count: default 5, configurable in `limits.ts` (recommended default given in spec; implementer decides final value)
- OQ5 — Portfolio rollup as playbook vs background job: start as background job; migrate if agencies request customisation
- OQ7 — Client upload approval model: 5-upload threshold with trust-builds-over-time (already in spec body; OQ remains for policy confirmation)

---

## Spec Health at Exit

The spec entered review with several load-bearing claims that lacked named contracts, sequencing bugs, and factual errors. After 5 iterations:

- All sequencing bugs resolved: Phase 3 onboarding no longer depends on a Phase 4 schema column (`portalMode` moved to Phase 1)
- All factual errors corrected against codebase: org subaccount ID retrieval now matches actual schema (`isOrgSubaccount` query, not a non-existent org column)
- All meaningful unnamed primitives named: services (`configDocumentParserService`, `memoryCitationDetector`, `memoryReviewQueueService`), jobs (`memory-hnsw-reindex`, `memory-blocks-embedding-backfill`), tables (`memory_review_queue`)
- Schema overlaps explained: `source` column disambiguated from existing provenance fields; `onboarding_bundle_configs` vs `modules.onboardingPlaybookSlugs` two-layer model explained
- All open questions answered in spec body marked resolved (OQ2, OQ4, OQ8)
- Delivery path mechanism corrected: portfolio rollup job reads persisted config and calls `deliveryService.deliver()`, not "passes to DeliveryChannels component"
- Review queue ambiguity resolved: "Memory review queue summary" (`memory_review_queue` from S7) distinguished from existing `review_items` HITL queue

The spec is ready for implementation.

---

## Files Modified

- `docs/memory-and-briefings-spec.md`
- `tasks/spec-review-checkpoint-memory-and-briefings-spec-4-2026-04-16T04-11-13Z.md` (HITL decisions applied — checkpoint is now resolved)
