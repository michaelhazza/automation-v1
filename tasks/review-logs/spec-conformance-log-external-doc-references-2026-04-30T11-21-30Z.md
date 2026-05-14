# Spec Conformance Log

**Spec:** `docs/external-document-references-spec.md`
**Spec commit at check:** untracked (working-copy)
**Branch:** `claude/agency-email-sharing-hMdTA`
**Base:** merge-base with main = `4a76ea34e743568ee81d696c749e957a7bf9f42a`
**Scope:** all-of-spec, all six phases (Phases 1–6)
**Changed-code set:** 60+ files (filtered from a 385-commit branch)
**Run at:** 2026-04-30T11:21:30Z
**Commit at finish:** 073d869392fbac09dd75516d2ce2111104a92cc0

---

## Summary

- Requirements extracted: ~80
- PASS: majority — schema, resolver core, services, UI, tests, observability
- MECHANICAL_GAP → fixed: 1
- DIRECTIONAL_GAP → deferred: 11 (REQ #C1–#C11)
- AMBIGUOUS → deferred: 0
- INFORMATIONAL → noted: 1 (REQ #C12)

**Verdict:** NON_CONFORMANT — REQ #C1 is load-bearing.

REQ #C1 prevents the feature from functioning end-to-end: documents are fetched, cached, audited, and have their state persisted, but their content is never injected into the LLM prompt.

---

## Findings by phase

### Phase 1 — Schema and Drive OAuth — PASS

- `migrations/0262_external_doc_refs_google_drive.sql` creates both new tables with named columns, RLS policies, indices, partial unique indices for idempotent failure writes (plan invariant #12) and attach idempotency, plus the CHECK constraint for `google_drive` rows. Matches §4.
- All Drizzle schemas line up with the migration.
- `rlsProtectedTables.ts`, `featureFlags.ts`, `constants.ts`, OAuth provider config, route registration in `server/index.ts` all present and correct.

### Phase 2 — Resolver service — MOSTLY PASS, two gaps

- `externalDocumentResolverTypes.ts` — `ResolvedDocument` shape matches §11.4. `checkRevision` returns enriched `{ revisionId, mimeType, name } | null` rather than spec §6.1's bare `string | null`; deliberate refinement to support §7.1 step 4 MIME check.
- `externalDocumentResolverPure.ts` — truncation (70/30 head+tail with `[TRUNCATED:]` marker), provenance header, staleness check, resolver-version check all match.
- `externalDocumentSingleFlight.ts` — Map keyed on `provider:fileId:connectionId`, bypass at 1000 entries, deletion in `finally`. Matches §7.3.
- `externalDocumentRetrySuppression.ts` — 60s window, lazy expiry. Matches plan invariant #17.
- `resolvers/googleDriveResolver.ts` — Docs/Sheets/PDF dispatch with size caps, retry-on-429 with bounded backoff, status code → `failure_reason` mapping all match §6.
- **GAP — REQ #C2:** §17.8 atomicity not honoured — cache upsert is in a tx; audit-log + `transitionState` run on module-level `db`. `params.db` accepted but unused.
- **GAP — REQ #C8:** null-revisionId TTL fallback (§7.2) not implemented — null always triggers refetch, the cache-miss loop §7.2 was written to prevent.

### Phase 3 — TaskModal attachment path — PASS with route/permission gaps

- Routes (attach/remove/rebind/policy + list), picker-token, verify-access endpoints present.
- Typed API client covers all operations.
- `DriveFilePicker.tsx` — Picker API wrapper, MIME filtering, multi-connection selector. Matches §10.3.
- `TaskModal.tsx` — cloud-storage attach buttons, reference rows with state badges + amber/red wrappers, failure-policy select, header error line + Save disabled when broken refs exist.
- **GAP — REQ #C3, C4, C5, C6:** route paths use `/api/subaccounts/:subaccountId/...` not spec's `/api/tasks/...`; permission keys use `WORKSPACE_MANAGE` not `org.tasks.manage`; picker-token + verify-access lack `requirePermission` (just `authenticate`); attach paths don't validate connection's subaccountId matches path subaccountId; spec's `invalid_connection_id` code split into `connection_not_found`/`connection_not_active`.

### Phase 4 — DataSourceManager — PASS

- `scheduledTasks.ts` and `agents.ts` accept `source_type='google_drive'` and `connection_id`; validate provider + active (subaccount scope check missing — see C5).
- `DataSourceManager.tsx` — `'google_drive'` source type, conditional file picker, Mode column header removed from table, status-badge mapping for `last_fetch_status`.

### Phase 5 — Context assembly — CRITICAL GAP

- `runContextLoader.ts` `loadExternalDocumentBlocks` correctly implements §9.4 budget algorithm, plan invariant #4 dedup, plan invariant #14 per-doc 30% cap, wall-clock check (invariant #2), failure-policy routing (§8.3).
- `runContextLoaderPure.ts` — ordering/budget/policy/fragmentation helpers match spec.
- `agentService.ts` — `'google_drive'` short-circuit branch in `fetchSourceContent`.
- **GAP — REQ #C1 (LOAD-BEARING):** `runContextData.externalDocumentBlocks` is computed but `agentExecutionService.executeRun()` never reads it. `buildSystemPrompt` only consumes `runContextData.eager`. Documents resolve and persist state, but their content never reaches the prompt — feature does not function end-to-end.
- **GAP — REQ #C10:** placeholder format for skipped refs doesn't match plan invariant #10.
- **GAP — REQ #C11:** wall-clock budget exhaustion writes no `document_fetch_events` row, violating §17.5 ("no-silent-partial-success").

### Phase 6 — Re-bind modal and UI hardening — PASS with one UI gap

- `ExternalDocumentRebindModal.tsx` — broken-doc display, connection selector, verify-access on selection, Re-attach disabled until verified, plain-English failure-reason mapper.
- TaskModal header error line + Save-disabled wired to `brokenCount`. DataSourceManager renders red badge for `last_fetch_status='error'` Drive rows.
- **GAP — REQ #C7:** rebind modal missing spec §10.5 "Remove reference instead" button.

## Mechanical fixes applied

**[FIXED] Quota error codes + `limit` fields in attach route**

  - File: `server/routes/externalDocumentReferences.ts`
  - Lines: 111–113, 129–131
  - Spec quote (§17.6): `{ "error": "per_subaccount_quota_exceeded", "limit": 100 }` and `{ "error": "per_task_quota_exceeded", "limit": 20 }`
  - Change: renamed error strings (`subaccount_quota_exceeded` → `per_subaccount_quota_exceeded`, `task_quota_exceeded` → `per_task_quota_exceeded`) and added `limit` field. Confirmed by `client/src/components/TaskModal.tsx:395-396`, which already expects the spec-canonical strings — server bug was preventing client error toasts from firing. Fix re-aligns both ends.

Qualifies as MECHANICAL: spec named exact strings verbatim, client already expects them, surgical token-edit per occurrence, no design judgment, only touches the changed-code set, re-verifiable by reading 4 lines.

The other error-code mismatch (`invalid_connection_id` vs `connection_not_found`/`connection_not_active`) was NOT auto-fixed — splitting one spec code into two server codes is a contract change, not a typo. Routed to REQ #C6.

## Directional gaps (routed to tasks/todo.md)

All 11 directional gaps live under "Deferred from spec-conformance review — external-doc-references (2026-04-30)" in `tasks/todo.md`.

| REQ | Severity | One-line description |
|---|---|---|
| C1 | **load-bearing** | `externalDocumentBlocks` never reaches the LLM prompt |
| C2 | medium | resolver-write atomicity contract (§17.8) not honoured |
| C3 | medium | route paths + permission keys diverge from spec |
| C4 | high (security) | picker-token + verify-access lack `requirePermission` |
| C5 | high (security) | `connection_id` not validated against caller's subaccount |
| C6 | low | `invalid_connection_id` code split into two codes |
| C7 | low (UI) | rebind modal missing "Remove reference instead" button |
| C8 | medium | null-revisionId TTL fallback not implemented |
| C9 | informational | plan vs spec disagreement on resolver-version constant |
| C10 | low | skipped-ref placeholder format diverges from invariant #10 |
| C11 | medium | wall-clock budget skip writes no `document_fetch_events` row |
| C12 | informational | user invocation file-path names diverge from actual paths |

C1 must land before the feature provides user value. C4 + C5 must land before production. C2, C8, C11 are correctness gaps that should land before any production rollout.

## Files modified by this run

- `server/routes/externalDocumentReferences.ts`
- `tasks/todo.md`
- this log

## Next step

**NON_CONFORMANT.** 11 directional gaps must be addressed before `pr-reviewer`. After the main session lands C1 and the security fixes (C4, C5), re-run this conformance pass and then run `pr-reviewer` against the final state.
