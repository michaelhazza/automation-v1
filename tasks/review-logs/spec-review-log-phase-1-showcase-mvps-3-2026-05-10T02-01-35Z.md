# Iteration 3 — phase-1-showcase-mvps

- Spec commit at start: `37196392` (after iter 2)
- Codex output: `tasks/review-logs/_codex_phase-1-showcase-mvps_iter3_2026-05-10T02-01-35Z.txt`

## Findings

- iter3-1 §5.4.2/INV-10 — `support.approve_draft` gate semantics block assisted-mode human approval — mechanical, accept
- iter3-2 §6.1.1/§6.1.4/§6.1.5b — file-delivery ownership inconsistency — mechanical, accept (separate from Open Decision 11.2)
- iter3-3 §6.1.2/§6.1.5b — `expired` event references non-existent deletion state on `run_artifacts` — mechanical, accept (chose hard-delete)
- iter3-4 INV-16 vs §5.6.3 — `phase1.support.eval_drift_detected` routing contradicts INV-16's "every event is also event_type" claim — mechanical, accept
- iter3-5 §4.4.3 / §9.1 — PDF byte-determinism asserted without backing mechanism — mechanical, accept

## Counts

- Mechanical accepted: 5
- Mechanical rejected: 0
- Directional / ambiguous: 0
- Reclassified → directional: 0

## Applied changes

- §5.4.2 (iter3-1): two distinct approval paths now explicit. `support.approve_draft` (agent-callable) is Tier 6 / blocked unless inbox `mode=autonomous`. Human approval in assisted mode flows through the existing review-queue / Slack Block Kit / `reviewItems` / `reviewAuditRecords` path which `supportDraftDispatchService` consumes directly — NOT via `support.approve_draft`. Both modes hit the same three-phase dispatch downstream.
- §6.1.4 (iter3-2): "single contract, two physical paths" clarified. Row insertion + event emission ALWAYS happen in the main app; the worker's only role is to hand bytes to the contract. Option A (worker direct upload + main-app finalize endpoint) and Option B (main-app proxy upload) bind to the same logical contract; Open Decision 11.2 chooses physical transit only, not the row/event model.
- §6.1.5b (iter3-2): emitter column updated — every event now explicitly emits from the main app; download proxy at `GET /api/run-artifacts/:id/download` is the canonical attribution point.
- §6.1.2b (iter3-3): NEW retention sweep subsection — Phase 1 hard-deletes expired artifacts. No soft-delete columns added. Sweeper deletes S3 object, deletes row, emits `phase1.file_delivery.expired`. Phase 2 may add tombstone columns if download attribution after expiry becomes a customer requirement.
- §3.5 INV-16 (iter3-4): split into "run-rendered events" (emitted from agent runs; appear as `agent_execution_events.event_type`) and "log-only events" (emitted from non-run paths; structured logs + Activity feed only). The eval drift event and all four file_delivery events move to the log-only list. Run Trace discriminator promise narrowed to "1:1 for events emitted from agent runs" rather than "1:1 for every listed event".
- §4.4.3 (iter3-5): determinism contract added — pin `@react-pdf/renderer` exact version; post-render normalization (zero `/CreationDate` + `/ModDate`, sort xref, strip `/ID`); the hash and the uploaded bytes are both the normalised bytes. §9.1 acceptance criterion updated to reference the normalization step.
