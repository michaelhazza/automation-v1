# Dual Review Log — external-doc-references

**Files reviewed:** all changed code on branch `claude/agency-email-sharing-hMdTA` since `main` (full Drive external-document-references feature)
**Iterations run:** 3/3
**Timestamp:** 2026-04-30T20:27:36Z
**Commit at finish:** c5ec25a64bab51caae09bfb4291d34da84baa4cb

---

## Iteration 1

Codex output: 5 findings (3 P1, 2 P2). Run: `codex review --base main`.

[ACCEPT] P1#1 — `server/services/externalDocumentResolverService.ts:60-64`: Resolver passes run's `subaccountId` to `getDecryptedConnection`, which filters on subaccount equality. Combined with P1#2 it fails for the connection's actual scope. Final fix delivered in iteration 3 once route-side scope was widened.

[ACCEPT] P1#2 — `client/src/components/TaskModal.tsx:245-250` + `server/routes/externalDocumentReferences.ts:104` + 5 sibling sites: TaskModal lists subaccount-scoped connections; every Drive route validated via `getOrgConnectionWithToken`, which returns rows with `subaccount_id IS NULL` only. Subaccount-scoped Drive connections are unreachable through every attach / picker / verify-access path. Spec §5.3 pins Drive on subaccount scope. Fix: add `getConnectionWithToken(id, orgId)` to `integrationConnectionService` (no subaccount filter); replace `getOrgConnectionWithToken` in 6 Drive sites; keep the post-lookup `subaccountId !== null && subaccountId !== :subaccountId` check.

[ACCEPT] P1#3 — `client/src/components/DataSourceManager.tsx:200-202`: Drive data-source create sends `contentType: form.contentType` (default `'auto'`), not `pickedFile.mimeType`. Resolver reads `agentDataSources.contentType` as `expectedMimeType` and rejects `'auto'` as `unsupported_content` on first run. Fix: send `pickedFile.mimeType` for the `google_drive` branch.

[ACCEPT] P2#1 — `server/routes/externalDocumentReferences.ts:327-331`: Rebind PATCH returns the raw `referenceDocuments` row, but the client typed `rebindExternalReference` as `ExternalDocumentReference` view-model. Client immediately replaces the row with the wrong shape. Fix: enrich with latest `documentFetchEvents` row, return `toExternalDocumentViewModel(...)`.

[REJECT → deferred] P2#2 — `client/src/components/DriveFilePicker.tsx:4-7`: PDF in picker but `pdf-parse` not declared. Real per spec §9.3, but `package.json` is HITL-protected (`config-protection.js` hook); dual-reviewer is autonomous and cannot prompt. Alternative (drop PDF from picker) contradicts the spec. Logged a deferred item in `tasks/todo.md` with both options.

## Iteration 2

Codex output: 4 findings (1 P1, 3 P2). Run: `codex review --base main`.

[ACCEPT] P1 — `server/routes/externalDocumentReferences.ts:263-270` (DELETE): Reference deletion only verifies org+subaccount membership, not bundle membership for `:taskId`. Cross-task tampering: any reference in the same subaccount can be soft-deleted via any task URL. Fix: verify reference is a member of the task's bundle before remove/soft-delete. Same fix applied to PATCH (rebind) — identical class of bug, identical surgical fix.

[REJECT] P2#1 — `client/src/components/TaskModal.tsx:247`: TaskModal loads only subaccount-scoped connections.
  Reason: Spec §5.3 explicitly says Drive connections are subaccount-scoped; `CredentialsTab.connectProvider` uses `scope: subaccountId ? 'subaccount' : 'org'`; the post-connect infobox reads "Shared across this subaccount". Surfacing org-level Drive connections in the task modal would expand UI behavior beyond spec. The route accepts both scopes (defensive); the UI follows the spec's primary model.

[ACCEPT] P2#2 — `client/src/components/DriveFilePicker.tsx:38-40`: Lazy initializer runs once at mount with empty `connections`; when one connection arrives later, selection stays `null`, the `length > 1` chooser branch isn't shown, modal hangs on "Opening picker...". Fix: effect that auto-selects when `connections.length === 1`, clears on 0.

[REJECT] P2#3 — PDF dependency re-flag. Already deferred in iteration 1.

## Iteration 3

Codex output: 4 findings (1 P1, 3 P2). Run: `codex review --base main`.

[ACCEPT] P1 — `server/services/externalDocumentResolverService.ts:60-64`: After widening route-side scope (iteration 1), the resolver still passes the run's `p.subaccountId` to `getDecryptedConnection`, which filters on subaccount equality. Org-level connections (`subaccount_id IS NULL`) never match → every org-level reference resolves as `auth_revoked`. Fix: look up the connection row first via `getConnectionWithToken(connectionId, orgId)`, pass row's actual `subaccountId` (which may be null) to `getDecryptedConnection`. Verify provider type before proceeding.

[ACCEPT] P2#1 — `server/routes/externalDocumentReferences.ts:88-91` and 4 sibling endpoints: Routes only call `resolveSubaccount(:subaccountId)` and never check `tasks.subaccountId === :subaccountId`. `documentBundleService.listAttachmentsForSubject` is org-scoped, not subaccount-scoped, so a caller can pass a foreign subaccount's `taskId` and read or mutate references under the wrong subaccount. Matches DEVELOPMENT_GUIDELINES.md §9 "Cross-entity ID verified". Fix: small `isTaskInSubaccount(taskId, orgId, subaccountId)` helper; gate every list/attach/delete/rebind/bundle-attachment handler on it (404 if false).

[ACCEPT] P2#2 — `server/services/runContextLoader.ts:408-410`: `enforceRunBudget` return value is discarded; the comment self-flags as "Informational run-budget enforcement (does not mutate blocks)". Multiple large Drive refs each contributing up to 30% of `tokenBudget` can inject far beyond run budget. Spec §9.4 line 633-635 requires skipping refs when budget exceeded and writing a `budget_exceeded` audit row. Fix: track `meta.id → block index` for successful injections; after `enforceRunBudget`, replace skipped block contents with `budget_exceeded` placeholder and write a `documentFetchEvents` row for each. Failure-policy interaction (synthetic-failure routing) deferred — the simpler fix satisfies Codex's recommendation and aligns with §17.5 no-silent-partial-success without expanding scope.

[REJECT] P2#3 — PDF dependency re-flag. Already deferred in iteration 1.

---

## Changes Made

- `server/services/integrationConnectionService.ts` — added `getConnectionWithToken(id, organisationId)` (no subaccount filter)
- `server/routes/externalDocumentReferences.ts` — switched to `getConnectionWithToken` in attach + rebind; rebind returns view-model via `toExternalDocumentViewModel`; DELETE + PATCH verify reference is a member of the task's bundle; all 5 endpoints verify `tasks.subaccountId === :subaccountId` via new `isTaskInSubaccount` helper
- `server/routes/integrations/googleDrive.ts` — picker-token + verify-access use `getConnectionWithToken`; `getDecryptedConnection` now passed the connection row's actual `subaccountId` (not hard-coded `null`)
- `server/routes/agents.ts` — agent data-sources use `getConnectionWithToken`
- `server/routes/scheduledTasks.ts` — scheduled-task data-sources use `getConnectionWithToken` + explicit `conn.subaccountId === :subaccountId` check
- `server/services/externalDocumentResolverService.ts` — looks up connection scope first; passes row's real `subaccountId` (incl. `null`) to `getDecryptedConnection`
- `server/services/runContextLoader.ts` — `enforceRunBudget` result applied: over-budget blocks replaced with `budget_exceeded` placeholder, audit row written
- `client/src/components/DataSourceManager.tsx` — Drive data-source send uses `pickedFile.mimeType`
- `client/src/components/DriveFilePicker.tsx` — effect re-evaluates selection when `connections` arrives async
- `tasks/todo.md` — deferred PDF dependency item appended

## Rejected Recommendations

- **PDF parser dependency** (flagged 3x). Real bug per spec §9.3, but the spec-aligned fix (declare `pdf-parse` in `package.json`) requires HITL approval for protected config; alternative (drop PDF from picker) contradicts spec. Deferred to `tasks/todo.md` with both options for the next manual session.
- **Iteration 2 P2#1 (org-level connections in TaskModal).** Spec §5.3 pins Drive on subaccount scope; existing UI matches the spec's primary model. Route layer accepts both scopes defensively, but the UI need not surface org-level Drive connections that exist as side-effects of the permissive OAuth flow.

---

**Verdict:** APPROVED (3 iterations; 8 of 9 distinct accepted findings fully resolved in-branch; 1 deferred to `tasks/todo.md` because the only spec-aligned fix requires HITL approval for `package.json`)
