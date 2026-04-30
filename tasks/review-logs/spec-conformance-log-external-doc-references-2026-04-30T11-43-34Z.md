# Spec Conformance Log

**Spec:** `docs/external-document-references-spec.md`
**Spec commit at check:** untracked (working-copy)
**Branch:** `claude/agency-email-sharing-hMdTA`
**Base:** merge-base with main = `4a76ea34e743568ee81d696c749e957a7bf9f42a`
**Branch HEAD at start:** `39cb8c6e090bb97f5a417a786a84df5e103873fd`
**Scope:** targeted re-verification of 8 previously-deferred gaps (C1, C2, C4, C5, C7, C8, C10, C11). C3, C6, C9, C12 explicitly excluded by caller (intentional deferrals / informational).
**Changed-code set:** 8 files in scope for verification (all already in branch diff)
**Run at:** 2026-04-30T11:43:34Z
**Prior run:** `tasks/review-logs/spec-conformance-log-external-doc-references-2026-04-30T11-21-30Z.md`

---

## Table of Contents

1. Summary
2. Re-verification details
   - C1 — `externalDocumentBlocks` injected via `buildSystemPrompt` 5th param
   - C2 — state-transition + audit-log inside transaction
   - C4 — `requireOrgPermission(WORKSPACE_MANAGE)` on picker-token and verify-access
   - C5 — `conn.subaccountId` validation on attach and rebind
   - C7 — "Remove reference instead" button in `ExternalDocumentRebindModal`
   - C8 — `EXTERNAL_DOC_NULL_REVISION_TTL_MINUTES` fallback in resolver
   - C10 — placeholder format `[External reference unavailable — ...]`
   - C11 — `document_fetch_events` row on wall-clock budget exhaustion
3. Mechanical fixes applied
4. Directional / ambiguous gaps (routed to tasks/todo.md)
5. Files modified by this run
6. Next step

---

## 1. Summary

- Requirements re-verified:    8 (C1, C2, C4, C5, C7, C8, C10, C11)
- PASS:                        8
- MECHANICAL_GAP → fixed:      0
- DIRECTIONAL_GAP → deferred:  0
- AMBIGUOUS → deferred:        0
- OUT_OF_SCOPE → skipped:      4 (C3, C6, C9, C12 — caller-excluded)

**Verdict:** CONFORMANT (for the targeted scope)

All eight previously-deferred gaps are closed. The feature is now end-to-end functional for the spec contracts named in this re-verification pass. Three deferred items (C3 route paths, C6 error-code split) and one informational item (C9 resolver-version constant) remain outstanding by design.

---

## 2. Re-verification details

### REQ #C1 — `externalDocumentBlocks` injected via `buildSystemPrompt` 5th param — PASS

- **Spec section:** §9.1, §9.3 — external references inject into `## Your Knowledge Base` block.
- **Evidence — caller:** `server/services/agentExecutionService.ts:792-798` — `buildSystemPrompt(effectiveMasterPrompt, dataSourceContents, orgProcesses, undefined, runContextData.externalDocumentBlocks)`.
- **Evidence — signature:** `server/services/llmService.ts:260-266` — `buildSystemPrompt` 5th param `externalDocBlocks: string[] = []`.
- **Evidence — injection:** `server/services/llmService.ts:269` and `287-289` — knowledge-base block opens when either `dataSourceContents.length > 0 || externalDocBlocks.length > 0`; blocks joined with `\n\n` and pushed into prompt.
- **Evidence — producer:** `server/services/runContextLoader.ts:120,525,530` — `externalDocumentBlocks` field on `RunContextData` is populated by `loadExternalDocumentBlocks(...)`.
- The load-bearing gap is closed: documents resolved by the resolver pipeline now reach the LLM prompt.

### REQ #C2 — state-transition + audit-log inside transaction — PASS

- **Spec section:** §17.8 — "the three DB writes inside `externalDocumentResolverService.resolve()` — `document_cache` upsert, `document_fetch_events` append, and `reference_documents.attachment_state` update — must execute within a single transaction scope."
- **Evidence:** `server/services/externalDocumentResolverService.ts:177-250` — `db.transaction(async (tx) => withAdvisoryLock(tx, ..., async () => { ... }))` wraps:
  - cache upsert (`tx.insert(documentCache)…onConflictDoUpdate`, lines 201-224)
  - state transition (`tx.update(referenceDocuments).set({ attachmentState: 'active' })`, lines 227-231; gated on `referenceType === 'reference_document'` per spec §8.2)
  - audit-log append (`tx.insert(documentFetchEvents)`, lines 234-248)
- The advisory-lock + double-check pattern (lines 178-199) handles cross-instance concurrent fetch races without breaking atomicity.
- **Note:** the cache-hit / degraded / failure paths (`serveCacheAsActive`, `serveCacheAsDegraded`, `emitFailure` at lines 285-441) write state-transition + audit-log on module-level `db` rather than a single tx. Strict reading of §17.8 references "the three DB writes" — those paths perform two writes (no cache upsert), so the literal three-write contract is satisfied. A broader "every resolve() write set is atomic" interpretation would still flag those paths, but it lies outside the original C2 description and the user's explicit scope. Not raising as a new finding.

### REQ #C4 — `requireOrgPermission(WORKSPACE_MANAGE)` on picker-token and verify-access — PASS

- **Spec section:** §5.4, §12.2 — picker-token and verify-access guarded by `authenticate` + `requirePermission(...)`.
- **Evidence — picker-token:** `server/routes/integrations/googleDrive.ts:12-15` — chain `authenticate, requireOrgPermission(ORG_PERMISSIONS.WORKSPACE_MANAGE)`.
- **Evidence — verify-access:** `server/routes/integrations/googleDrive.ts:42-45` — same chain.
- **Note:** the spec literally says `org.integrations.manage`. The implementation uses `WORKSPACE_MANAGE` (consistent with the C3 route-path / permission-key divergence the prior log catalogued and the user has explicitly deferred). The targeted gap was "is the route guarded with a permission requirement at all", not "which permission key." The route is now guarded.

### REQ #C5 — `conn.subaccountId` validation on attach and rebind — PASS (within scope)

- **Spec section:** §5.3 — connections subaccount-scoped; cross-subaccount access prohibited.
- **Evidence — attach (POST):** `server/routes/externalDocumentReferences.ts:95-97` — `if (conn.subaccountId !== null && conn.subaccountId !== subaccountId) return res.status(403).json({ error: 'connection_not_accessible' });`.
- **Evidence — rebind (PATCH):** `server/routes/externalDocumentReferences.ts:281-283` — same check.
- **Note (out-of-scope observation, not raised as a new gap):** the underlying helper `integrationConnectionService.getOrgConnectionWithToken(id, organisationId)` filters with `isNull(integrationConnections.subaccountId)` (`server/services/integrationConnectionService.ts:96`), so `conn.subaccountId` returned by this helper is always null in practice. The C5 check therefore short-circuits via the null branch and the 403 is unreachable as long as Drive connections continue to be persisted at the org level. The check is correct as written and harmless when subaccount-scoped Drive connections eventually land — it just does not currently fire. This is consistent with the broader spec-vs-implementation drift the prior log noted (Drive connections appear to live at org-level, contrary to spec §5.3). Tracking this would be a new directional finding about connection-storage scope rather than C5; it lies outside the user-listed targets and outside the deferred set, so noted for the record only.
- **Note (also out-of-scope):** the DataSourceManager paths (`server/routes/scheduledTasks.ts:209-238`, `server/routes/agents.ts:88-113`) accept `connection_id` for `google_drive` source types and validate provider+active, but do not perform a `conn.subaccountId` cross-check against the path `:subaccountId`. Same null-helper caveat applies. The user's stated scope for this run was "attach and rebind" (the externalDocumentReferences.ts routes). Not raising as a new finding.

### REQ #C7 — "Remove reference instead" button in `ExternalDocumentRebindModal` — PASS

- **Spec section:** §10.5 — re-attach modal shows a "Remove reference instead" text button.
- **Evidence — button:** `client/src/components/ExternalDocumentRebindModal.tsx:86-92` — text-style red button with `onClick={() => { onRemove(); onClose(); }}` and label "Remove reference instead".
- **Evidence — wiring:** `client/src/components/TaskModal.tsx:811,822` — `<ExternalDocumentRebindModal onRemove={() => handleRemoveDriveRef(rebindReference!.id)} ... />`.

### REQ #C8 — `EXTERNAL_DOC_NULL_REVISION_TTL_MINUTES` fallback in resolver — PASS

- **Spec section:** §7.2 "Null revisionId path" — when `checkRevision()` returns null, fall back to TTL strategy to prevent permanent cache-miss loop.
- **Evidence — constant:** `server/lib/constants.ts:21` — `EXTERNAL_DOC_NULL_REVISION_TTL_MINUTES = 5`.
- **Evidence — usage:** `server/services/externalDocumentResolverService.ts:118-125` — when revision did not match and provider returned `null` for `revisionId`, the resolver computes `isPastStalenessBoundary(cacheRow.fetchedAt, fetchStart, EXTERNAL_DOC_NULL_REVISION_TTL_MINUTES)` and treats the cache as fresh (`revisionMatches = true`) when within window.
- **Note:** the constant value (5 minutes) is more conservative than the §7.2 ambient `cache_ttl_minutes` default (60 minutes). The spec frames the null path as falling back to "the TTL-based strategy above" without binding it to the same numeric default; a separate, tighter null-revision TTL is a reasonable implementation choice and prevents the permanent cache-miss loop the spec calls out. PASS within spec intent.

### REQ #C10 — placeholder format `[External reference unavailable — ...]` — PASS

- **Spec section:** plan invariant #10 — failure-policy skip injects a fixed-format placeholder so the model can reason about absence.
- **Evidence — failure-policy skip path:** `server/services/runContextLoader.ts:370` — pushes ``[External reference unavailable — ${resolved.failureReason}. This document was attached but could not be fetched.]``.
- **Evidence — wall-clock budget path:** `server/services/runContextLoader.ts:306` — pushes ``[External reference unavailable — budget_exceeded. This document was attached but could not be fetched.]``.
- **Note (not in scope):** the over-quota path at line 398 uses a different format (`[External document "..." skipped: quota exceeded (max ${EXTERNAL_DOC_MAX_REFS_PER_RUN} per run)]`). C10 was scoped to the failure-policy/budget skip placeholders, which match. Over-quota is a separate code path with its own message. Not raising as a new finding.

### REQ #C11 — `document_fetch_events` row on wall-clock budget exhaustion — PASS

- **Spec section:** §17.5 "no-silent-partial-success" — every failure path produces a visible audit trace.
- **Evidence:** `server/services/runContextLoader.ts:305-327` — when `Date.now() - wallClockStart >= EXTERNAL_DOC_MAX_TOTAL_RESOLVER_MS`, the loader inserts a `document_fetch_events` row with `failureReason: 'budget_exceeded'`, `cacheHit: false`, `tokensUsed: 0` for the skipped reference, before pushing the placeholder block and `continue`-ing.
- The insert is fire-and-forget (`.catch((err) => console.error(...))`) so a failed audit write does not break the run, but the audit trace is produced on the happy path.
- **Note (not in scope):** the over-quota path at line 397-399 does not currently write per-reference `document_fetch_events` rows, which would be a strict reading of §17.5 for that case as well. Not in scope for C11 (which was specifically about wall-clock exhaustion).

---

## 3. Mechanical fixes applied

None. All eight targeted requirements were already satisfied by the prior commits in the branch (`64871c3d`, `7c248c26`, `ac54b368`, `e9479648`, `cb7db8cd`, `0d96452c`, `543190f6`, `39cb8c6e`).

---

## 4. Directional / ambiguous gaps (routed to tasks/todo.md)

None this run. No new gaps surfaced. `tasks/todo.md` already carries the original C3 / C6 directional items from the prior run; those remain deferred by user direction and were not re-evaluated here.

The two `Note (out-of-scope observation)` items above (`getOrgConnectionWithToken` returning org-level rows only; DataSourceManager subaccount cross-check absent on `scheduledTasks.ts` / `agents.ts`) are observations about the broader connection-scope contract, surfaced to the human for awareness without being routed as new directional gaps. They originate from the same root cause as the prior C5 / C3 cluster the user has explicitly deferred. If the deferred items are re-opened later, these notes should be considered alongside them.

---

## 5. Files modified by this run

- `tasks/review-logs/spec-conformance-log-external-doc-references-2026-04-30T11-43-34Z.md` — this log

(No production code modified — verification-only run.)

---

## 6. Next step

**CONFORMANT** for the targeted scope. The original NON_CONFORMANT verdict's load-bearing item (C1) and security items (C4, C5) and correctness items (C2, C8, C11) and UI item (C7) and placeholder-format item (C10) are all closed.

Outstanding directional items remain on `tasks/todo.md` by user direction:

- **C3** — route paths use `/api/subaccounts/:subaccountId/...` not spec's `/api/tasks/...` (deferred — directional).
- **C6** — `invalid_connection_id` split into `connection_not_found` / `connection_not_active` (deferred — directional).
- **C9** — plan vs spec disagreement on resolver-version constant (informational).
- **C12** — invocation file-path naming (informational).

Recommended next action: proceed to `pr-reviewer` for the full code review pass on the branch.
