# chatgpt-spec-review — phase-1-showcase-mvps (manual session, second pass)

## Session Info
- Spec: `tasks/builds/phase-1-showcase-mvps/spec.md`
- Branch: `main` (spec lives on main; PR #280 already merged 2026-05-10)
- PR: [#280](https://github.com/michaelhazza/automation-v1/pull/280) (MERGED — retrospective review)
- Mode: manual
- Started: 2026-05-10T02-43-55Z
- Spec line count at start: 1394
- Predecessor sessions:
  - spec-reviewer (Codex) — 3 iterations, 30 mechanical fixes, 2 directional defers
  - chatgpt-spec-review (automated) — 3 rounds, ended CHANGES_REQUESTED. Log: `tasks/review-logs/chatgpt-spec-review-phase-1-showcase-mvps-2026-05-10T02-14-06Z.md`

## Anchor framing (constants for triage — same as prior session)
- Phase 1 MVP scoped to v1.2 brief §18.1; narrower than §16.2.
- Architecture-level spec; function signatures, full SQL, pixel-level wireframes are out of scope. Contract-alignment SQL (e.g. exact partial-index DDL) IS in scope where ambiguity would block the build.
- Predecessors `synthetos-foundation-refactor` and `support-desk-canonical` are LOCKED.

---

## Round 1 — 2026-05-10T02-43-55Z

ChatGPT verdict: CHANGES_REQUESTED (close to lock; 3 build-blocking + 3 important + 4 minor polish items). Round triggered by operator paste — fresh ChatGPT-web session, sharper findings than the predecessor automated 3-round close.

### ChatGPT Feedback (raw)

> First pass: the spec is already quite strong. The main issues I'm seeing are not direction problems, they're contract mismatches where later sections added precision but the global invariants and schema did not fully catch up.
>
> Reviewed. Overall: strong spec, close to lock, but I would not lock yet. I found 6 tightenings, with 3 that are build-blocking unless clarified.
>
> CEO summary: The spec has the right shape: Phase A file delivery first, then two parallel showcase MVPs; Support Inbox correctly stays Native Controller; and the eval + file-delivery contracts are much more mature than a typical MVP spec. The remaining risk is mostly contract drift: event names, idempotency keys, schema assumptions, and route semantics do not line up perfectly across sections.
>
> Blockers before locking
> F1. Event taxonomy drift: several emitted events are not registered in INV-16 — `phase1.macro.report_rendering_failed`, `phase1.macro.artifact_upload_failed`, `phase1.support.classify_failed`. Fix: canonical event registry table in §3.5 + update §5.6.3 / §9.2 acceptance.
>
> F2. `run_artifacts` idempotency key conflicts with the stated PDF retry contract — schema makes `(storage_provider, storage_key)` unique with a path including `{content_hash}.{ext}`, but the PDF section says the logical key is `(content_hash, agent_run_id, artifact_kind='report')`. Fix: composite partial unique index `(organisation_id, agent_run_id, artifact_kind, content_hash) WHERE agent_run_id IS NOT NULL` + storage-key path includes `{artifact_kind}/`.
>
> F3. Support Agent singleton index is underspecified and likely not implementable as written — partial index can't safely depend on a runtime placeholder UUID. Fix: pin exact SQL using a stable `applied_template_slug` column; add concurrent-install acceptance line.
>
> Important tightenings
> F4. Support run-loop idempotency relies on a `bot_handled_at` watermark that is not defined. Fix: replace with explicit event-store predicate anchored on `last_customer_message_at`.
>
> F5. Download attribution conflicts with "signed URL copy link" — `phase1.file_delivery.downloaded` only fires from a main-app download proxy, but the UI section says Download and Copy link trigger signed URLs directly. Fix: split semantics — Preview and Download via proxy (attributed); Copy link issues signed URL only (unattributed).
>
> F6. Skill count drift — the agent record lists 12 skills (11 support.* + 1 universal); the promptOverride safety section refers to a "fixed 13-skill list". Fix: change to 12 + add NG3 negative-skill grep acceptance check.
>
> Minor polish before handoff:
> M1. "Migration number assigned at build time" note on `run_artifacts`.
> M2. Explicit `withOrgTx` / RLS wording on artifact routes.
> M3. Route permission for file download / artifact listing.
> M4. Acceptance line for file-retention sweep.
>
> Recommendation: Do one more spec revision before locking. Contract-alignment pass only. After those are applied, comfortable moving to plan generation.

### Recommendations and Decisions

| ID | Title | Sev | Triage | My recommendation | Final decision | Rationale / notes |
|---|---|---|---|---|---|---|
| F1 | Event taxonomy drift — 3 missing events not in INV-16 | high | technical | apply | auto (apply) | Replaced bullet lists in §3.5 INV-16 with a 19-row canonical event registry table; added 3 missing run-rendered events; reaffirmed `phase1.file_delivery.downloaded` is proxy-only; updated §5.6.3 to enumerate 7 per-ticket renderers; added §4.6.3 file inventory entry for `MacroFailureRenderers.tsx`; expanded §9.1 / §9.2 acceptance. Pure internal contract — auto-apply. |
| F2 | `run_artifacts` idempotency key contract drift | high | technical | apply | auto (apply) | Replaced `(storage_provider, storage_key)` unique index with composite partial unique `(organisation_id, agent_run_id, artifact_kind, content_hash) WHERE agent_run_id IS NOT NULL`. Storage-key path in §6.1.1 now includes `{artifact_kind}/`. Updated 3 prose references in §4.4.4 and §6.1.2. |
| F3 | Support Agent singleton index underspecified | high | technical | apply | auto (apply) | Pinned exact SQL in §5.3.1: ALTER TABLE ADD COLUMN `applied_template_slug text` (INV-5-allowed additive), backfill UPDATE, partial unique index `WHERE is_active = true AND applied_template_slug = 'support-agent'`. Added file-inventory section listing migration + service + integration test + route. Added §9.2 acceptance line. Verified `subaccount_agents` has only `applied_template_id` today. |
| F4 | `bot_handled_at` watermark undefined | medium | technical | apply | auto (apply) | Replaced reference in §5.3.4 with explicit event-store predicate (NOT EXISTS subquery on `agent_execution_events` filtering on 3 terminal event names AND `created_at >= last_customer_message_at`). Customer-message anchor is the key — without it a one-time terminal event would silently exclude the ticket forever. |
| F5 | Download attribution vs Copy link semantics | high | technical | apply | auto (apply) | Triage: technical, not user-facing. Visible UI labels (Preview / Download / Copy link) are unchanged; what changes is internal attribution semantics (proxy = attributable; signed URL = sharable + unattributable). Split semantics in §4.5.2, §6.1.5b, §4.5.3 (added new `runArtifacts.ts` route file with both endpoints; +120 LOC). Added §9.3 acceptance line. |
| F6 | Skill count drift: 12 vs 13 | low | technical | apply | auto (apply) | Changed "13-skill list" → "12-skill list" in §5.3.6 with explicit gloss. Added §9.2 NG3 negative-skill grep acceptance check. |
| M1 | Migration number assigned at build time on `run_artifacts` | low | technical | apply | auto (apply) | Updated §6.1.6 code-changes table — same convention as existing §5.5.4 `support_eval_runs` migration. |
| M2 | Explicit `withOrgTx` / RLS wording on artifact routes | medium | technical | apply | auto (apply) | Updated §4.5.3 code-changes table for `agentRuns.ts` and the new `runArtifacts.ts` route file. Both wrap `withOrgTx`; `runArtifacts.ts` also calls `agentRunVisibility.canView(...)` before returning bytes/URLs. |
| M3 | Route permission for file download / artifact listing | low | technical | apply (modified) | auto (apply) | Rejected ChatGPT's literal "add new permission" framing as scope expansion. Applied the spirit: added explicit "Permissions posture (artifact access)" paragraph to §4.5.3 stating no new `files.*` permission tile in Phase 1; artifact access follows existing `agentRunVisibility` model. Net: spec is explicit about the permission model without inventing a new tile. |
| M4 | Acceptance line for file-retention sweep | low | technical | apply | auto (apply) | Added §9.3 acceptance line: daily sweeper hard-deletes expired rows + S3 objects, emits `phase1.file_delivery.expired`, `listForRun` no longer returns swept artifacts. |
| IC-1 | (Integrity check) §4.4.4 line "the unique index ensures we never get a duplicate row" was generic | low | technical | apply | auto (apply) | Sharpened to reference the composite index `run_artifacts_run_kind_hash_unique` by name. |
| IC-2 | (Integrity check) Install migration referenced in §5.3.1 prose but absent from any code-changes table | medium | technical | apply | auto (apply) | Added "File inventory addition (Support Agent install flow)" sub-table in §5.3.1 listing migration, schema update, install service, integration test, route handler (+303 LOC subtotal). |

### Applied (auto-applied technical)

- [auto] §3.5 INV-16: replaced bullet lists with 19-row canonical event registry table (F1)
- [auto] §4.4.4: idempotency-key prose now references composite index by name (F2 + IC-1)
- [auto] §4.5.2: split Preview/Download (proxy, attributed) vs Copy link (signed URL, unattributed) (F5)
- [auto] §4.5.3: extended code-changes table with new `runArtifacts.ts` route file + explicit `withOrgTx` / `agentRunVisibility.canView` wording + permissions-posture paragraph (M2 + M3)
- [auto] §4.6.3: added `MacroFailureRenderers.tsx` file inventory entry (F1 follow-on)
- [auto] §5.3.1: pinned exact SQL for additive `applied_template_slug` column + backfill UPDATE + partial unique singleton index; added install-flow file inventory sub-table (F3 + IC-2)
- [auto] §5.3.4: replaced `bot_handled_at` reference with explicit event-store predicate anchored on `last_customer_message_at` (F4)
- [auto] §5.3.6: changed "13-skill list" → "12-skill list" with explicit gloss (F6)
- [auto] §5.6.3: enumerated 7 per-ticket events (added `phase1.support.classify_failed`); added 42 Macro failure-renderers paragraph (F1 follow-on)
- [auto] §5.6.4: updated `SupportEventRenderers.tsx` row to cover 7 event types (+25 LOC delta) (F1 follow-on)
- [auto] §6.1.1: storage-key path now includes `{artifact_kind}/` (F2)
- [auto] §6.1.2: replaced storage-key unique index with composite partial unique index + comment explaining why partial on `agent_run_id IS NOT NULL`; updated idempotency-posture line; updated drift-handling promotion-step idempotency description (F2)
- [auto] §6.1.5b: clarified signed-URL mint vs download-proxy attribution trade-off; tied to §4.5.2 (F5)
- [auto] §6.1.6: migration filename uses `<next-available>` placeholder + explicit "do not pin"; routes counted in §4.5.3 to avoid double-count (M1)
- [auto] §9.1: added failure-path renderer acceptance line (F1 follow-on)
- [auto] §9.2: added NG3 negative-skill grep acceptance + concurrent-install acceptance + classify-failure escalation acceptance + updated to "7 Run Trace event types" (F3, F6, F1 follow-on)
- [auto] §9.3: added download-proxy attribution acceptance + retention-sweep acceptance + composite-index acceptance (F5, M4, F2)

Net: 19 surgical edits across 12 sections. Spec line count 1394 → 1485 (+91).

### Integrity check
- 0 forward references unresolved
- 0 contradictions detected after sweep
- 2 mechanical IC items applied (above)
- All 19 events in the §3.5 registry have a referenced emitter and at least one acceptance gate
- Verified post-edit: no remaining matches for `storage_provider, storage_key`, `bot_handled_at`, `13-skill`, `the 5 per-ticket`, `6 Run Trace event` (all stale references replaced)

### Top themes (Round 1)
- **Contract alignment** — schema constraints, event names, idempotency keys, and route semantics now line up across §3.5 / §4 / §5 / §6 / §9.
- **Make implicit explicit** — pinned SQL for the singleton index; pinned event-store predicate for the run-loop idempotency boundary.
- **Attribution honesty** — the spec now explicitly admits Copy-link downloads are unattributable rather than promising attribution it can't deliver.

---

## Round 2 — 2026-05-10T02-58-00Z

ChatGPT verdict: "mostly clean, implementation-ready after 2 small tightenings". Two technical findings + one optional polish item; no direction changes.

### ChatGPT Feedback (raw)

> Round 2 verdict: mostly clean, implementation-ready after 2 small tightenings.
>
> The Round 1 fixes landed well. The updated spec now resolves the main contract drift: canonical event registry, artifact idempotency, singleton install race, support-ticket re-eligibility, download attribution, skill-count consistency, route permissions, and retention acceptance are all materially better.
>
> Remaining tightenings:
>
> F1. `phase1.file_delivery.uploaded` payload still drifts from the retry prose — PDF retry section says duplicate invocation emits `phase1.file_delivery.uploaded` with `wasReplay: true`, but the file-delivery payload contract shown later does not include `wasReplay`. Fix: add `wasReplay: boolean` to the payload contract, default false. Acceptance addition: duplicate upload returns existing row id and emits `phase1.file_delivery.uploaded` with `wasReplay: true`.
>
> F2. Support terminal-event predicate needs provider/customer-message anchoring to be explicit — predicate assumes `canonical_tickets.last_customer_message_at` is always present and reliably updated. Fix: add COALESCE fallback to `created_at`; document Teamwork ingestion obligation; add pure test fixtures for null-timestamp degenerate cases. This prevents `e.created_at >= NULL` evaluating to UNKNOWN and accidentally re-processing old tickets forever.
>
> Optional polish (not blocking): `applied_template_slug` stability note — future system-agent renames must not rewrite historical slugs. Treat as stable install discriminator, not display copy.
>
> Recommendation: Apply F1 and F2, then lock. Round 3 only needed if those edits introduce new schema or event names.

### Recommendations and Decisions

| ID | Title | Sev | Triage | My recommendation | Final decision | Rationale / notes |
|---|---|---|---|---|---|---|
| F1 | `wasReplay` field missing from `phase1.file_delivery.uploaded` payload contract | low | technical | apply | auto (apply) | Real contract drift between §4.4.4 retry prose and §6.1.5b payload table. Added `wasReplay: boolean` to the §6.1.5b payload schema with explicit `false` for first upload, `true` for subsequent retries hitting the existing row via the §6.1.2 composite unique index. Added §9.3 acceptance line: duplicate upload returns existing `artifactId` + emits `wasReplay: true`. |
| F2 | Null-safety on `last_customer_message_at` in run-loop terminal-event predicate | medium | technical | apply | auto (apply) | Real correctness bug. `e.created_at >= NULL` evaluates to UNKNOWN, so NOT EXISTS returns TRUE, so old tickets with terminal events get reprocessed forever. Wrapped the column in `COALESCE(last_customer_message_at, created_at)` to pin the lower bound to a safe degenerate floor. Added "Null-safety" prose paragraph + "Ingestion contract (canonical layer obligation)" paragraph naming `connectorPollingService` and `webhookAdapterService` as the writers. Expanded test fixtures from 1 to 4 cases including both null-timestamp degenerate scenarios. |
| Polish | `applied_template_slug` stability note | low | technical | apply | auto (apply) | Added "Slug stability invariant" paragraph to §5.3.1 stating slug is identity (partial unique index keys on it), not display copy. Future system-agent renames must NOT rewrite historical slugs; if a successor identifier is needed, it's a deliberate corrective migration per §6 rule 5. Tiny addition that prevents a class of silent breakage. |

### Applied (auto-applied technical)

- [auto] §3.5 / §6.1.5b: `phase1.file_delivery.uploaded` payload now includes `wasReplay: boolean` with explicit semantics; emit-point updated to clarify it fires on both fresh and replayed inserts (F1)
- [auto] §5.3.4: terminal-event predicate now uses `COALESCE(last_customer_message_at, created_at)` to handle null timestamps; added ingestion-contract obligation + 4 test fixtures (was 1) (F2)
- [auto] §5.3.1: added "Slug stability invariant" paragraph naming `applied_template_slug` as install discriminator, not display copy (Polish)
- [auto] §9.3: added duplicate-upload `wasReplay` acceptance line (F1 follow-on)

Net: 4 surgical edits across 4 sections. Spec line count 1485 → 1498 (+13).

### Integrity check
- 0 forward references unresolved
- 0 contradictions detected after sweep
- Verified post-edit: zero remaining bare `>= last_customer_message_at` references (all wrapped in COALESCE)
- All 4 wasReplay references and all COALESCE references resolve to the same target

### Top themes (Round 2)
- **Payload-contract honesty** — the registry's authority depends on every payload being declared; `wasReplay` added.
- **Null-safety on optional canonical columns** — the terminal-event predicate now degrades safely when ingestion lags.
- **Identity vs display copy** — `applied_template_slug` is now explicitly an install discriminator, not a renamable label.

---

## Final Summary (pending — awaiting operator "done" signal)

ChatGPT recommended lock after Round 2. Operator decides whether to:
- Say `done` to finalise (run consistency check, implementation-readiness checklist, doc-sync sweep, deferred-backlog routing)
- Run a Round 3 pressure-test (recommended only if Round 2's small additions warrant another pass — they shouldn't, per ChatGPT)
