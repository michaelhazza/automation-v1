# Phase 2 — Bundles + attachment + suggestion

**Spec anchors:** §10 Phase 2 · §3.6.3–§3.6.5 UX flows · §5.3–§5.5, §5.12 · §6.2 · §7.2
**Migrations:** 0212 (`bundle_suggestion_dismissals` only — bundle tables landed in Phase 1)
**Pre-condition:** Phase 1 merged; all seven base tables exist; `referenceDocumentService` works.

## Purpose

Ship the bundle service + attach/detach routes + bundle-suggestion flow + unnamed-bundle lifecycle + multi-file upload's `attachTo` auto-attach path. After Phase 2, users can attach documents to agents/tasks/scheduled-tasks, promote unnamed bundles to named bundles, see the post-save suggestion, and dismiss it. Register the `bundleUtilizationJob` (but do not enable its schedule until Phase 6).

Exit state: end-to-end attach flow works against real subjects (existing `agents` / `tasks` / `scheduled_tasks` tables). Unnamed bundle dedup across identical doc sets works. Post-save suggestion fires correctly per the §3.6.4 truth table. The engine hasn't been built yet, so runs don't yet consume bundles — that wires up in Phase 4.

## Chunked deliverables

- Chunk 2.1 — Migration 0212 + schema `bundle_suggestion_dismissals`
- Chunk 2.2 — `documentBundleServicePure` + shared types stub
- Chunk 2.3 — `documentBundleService` stateful
- Chunk 2.4 — Routes `server/routes/documentBundles.ts`
- Chunk 2.5 — Subject-listing route modifications
- Chunk 2.6 — Wire `attachTo` into bulk upload
- Chunk 2.7 — `bundleUtilizationJob` registration (schedule disabled until Phase 6)
- Chunk 2.8 — Pure tests

### Chunk 2.1 — Migration 0212 + schema `bundle_suggestion_dismissals`

- Create `migrations/0212_bundle_suggestion_dismissals.sql` per §5.12.
- Create `server/db/schema/bundleSuggestionDismissals.ts` with unique `(user_id, doc_set_hash)` + user index + org index.
- RLS: custom policy enforcing `user_id = current_setting('app.current_user_id')::uuid` on the read path (user-scoped, not just org-scoped). On write path: `organisation_id = current_setting('app.current_organisation_id')::uuid AND user_id = current_setting('app.current_user_id')::uuid`. Document the shape in the migration.
- Manifest entry in `server/config/rlsProtectedTables.ts`.
- No permission keys — dismissals are scoped by user identity, not by permission.

### Chunk 2.2 — `documentBundleServicePure` + shared types stub

- Create `server/services/documentBundleServicePure.ts`:
  - `computeDocSetHash(documentIds: string[]): string` — sorts IDs ascending, hashes the sorted sequence with SHA-256. Must produce the same value as `contextAssemblyEnginePure.computePrefixHash`'s `orderedDocumentIds` sub-hash (verified in Phase 3 via shared fixture).
- Create `shared/types/cachedContext.ts` (stubbed — Phase 3 fills in the rest):
  - `AttachmentSubjectType = 'agent' | 'task' | 'scheduled_task'`.
  - `AttachmentMode = 'always_load' | 'available_on_demand'`.
  - `ReferenceDocumentSourceType = 'manual' | 'external'`.
  - `ReferenceDocumentChangeSource = 'manual_upload' | 'manual_edit' | 'external_sync'`.
  - `BundleSuggestion = { suggest: false } | { suggest: true; alsoUsedOn: number; docSetHash: string; unnamedBundleId: string }`.
  - `BundleSuggestionDismissal` interface.
  - TODO-comment the Phase 3 exports (`ResolvedExecutionBudget`, `ContextAssemblyResult`, `PrefixHashComponents`, `HitlBudgetBlockPayload`, `RunOutcome`).

### Chunk 2.3 — `documentBundleService` stateful

Create `server/services/documentBundleService.ts` per §6.2. Full surface:

- `create` — explicit named-bundle creation (retained for API completeness, not UI-exposed).
- `findOrCreateUnnamedBundle` — canonical-hash lookup within `(org, subaccount)`; insert on miss with `ON CONFLICT DO NOTHING` + re-select pattern. Transaction: create `document_bundles` row with `is_auto_created=true`, `name=null`, insert members.
- `promoteToNamedBundle` — single UPDATE `SET is_auto_created=false, name=:name, updated_at=now() WHERE id=:bundleId AND is_auto_created=true`. 0 rows updated → `CACHED_CONTEXT_BUNDLE_ALREADY_NAMED`. Partial unique index on `(org, name) WHERE deleted_at IS NULL AND name IS NOT NULL` catches name collisions. Validate `name.trim().length > 0` first.
- `suggestBundle` — three indexed-lookup queries per §6.2 invariant #9. Must NOT scan `document_bundle_attachments` without an index-backed predicate.
- `dismissBundleSuggestion` — `INSERT ... ON CONFLICT (user_id, doc_set_hash) DO UPDATE SET dismissed_at = excluded.dismissed_at RETURNING *`. Idempotent.
- `addMember` / `removeMember` — each bumps `document_bundles.currentVersion` in the same transaction. Add creates a fresh row even if a prior soft-deleted row exists.
- `attach` — polymorphic subject existence check. Service-enforced `subjectOrgId === bundleOrgId`. Idempotent: re-attach against a live row returns the existing row. Re-attach after soft-delete inserts fresh.
- `detach` — soft-delete the attachment row.
- `listBundles` — named-only (`is_auto_created=false`).
- `listAllBundles` — admin-only; includes unnamed.
- `getBundleWithMembers` — bundle row + joined `reference_documents`.
- `listAttachmentsForSubject` — returns rows with `chipKind` discrimination (`bundle` for named, `document` for unnamed + expanded docs).
- `softDelete` — wrapper-only removal per §6.2 (no cascade to members, snapshots, runs, or documents).

Error codes per §6.2: `CACHED_CONTEXT_BUNDLE_NAME_TAKEN`, `_ALREADY_NAMED`, `_NOT_FOUND`, `_DOC_CANT_ADD_DEPRECATED`, `_BUNDLE_SUBJECT_NOT_FOUND`, `_BUNDLE_SUBJECT_ORG_MISMATCH`, `_BUNDLE_NAME_EMPTY`.

### Chunk 2.4 — Routes `server/routes/documentBundles.ts`

Thin handlers per §7.2. User-facing:

- `GET /api/document-bundles/bundles` — named-only list.
- `GET /api/document-bundles/:id` — getBundleWithMembers.
- `PATCH /api/document-bundles/:id` — rename + description (reject unnamed with 409).
- `POST /api/document-bundles/:id/members` — addMember.
- `DELETE /api/document-bundles/:id/members/:docId` — removeMember.
- `POST /api/document-bundles/:id/attach` — attach to a subject.
- `DELETE /api/document-bundles/:id/attach/:subjectType/:subjectId` — detach.
- `DELETE /api/document-bundles/:id` — soft delete (named; unnamed GC deferred).
- `POST /api/document-bundles/attach-documents` — §7.2 contract. Idempotent.
- `POST /api/document-bundles/:id/promote` — promote.
- `GET /api/document-bundles/suggest-bundle` — query params `documentIds`, `excludeSubjectType`, `excludeSubjectId`.
- `POST /api/bundle-suggestion-dismissals` — server computes `docSetHash`; never trusts client.

Admin-only:

- `GET /api/document-bundles/admin/all` — listAllBundles.
- `GET /api/document-bundles/admin/:id/utilization` — reads `utilization_by_model_family` JSONB.

Middleware chain per §8.3. Admin routes gain a platform-admin role guard. Mount in `server/index.ts`.

### Chunk 2.5 — Subject-listing route modifications

- `server/routes/agents.ts`: `GET /api/agents/:id/attached-bundles` → `listAttachmentsForSubject('agent', :id)`.
- `server/routes/tasks.ts`: `GET /api/tasks/:id/attached-bundles`.
- `server/routes/scheduledTasks.ts`: `GET /api/scheduled-tasks/:id/attached-bundles`.
- Response shape per §7.2 (distinguishes bundle chips from document chips via `chipKind`).

### Chunk 2.6 — Wire `attachTo` into bulk upload

- Update `POST /api/reference-documents/bulk-upload` handler to call `findOrCreateUnnamedBundle` + `attach` when `attachTo` is present. When `bundleName` is ALSO present, call `promoteToNamedBundle` on the just-created unnamed bundle. Same transaction as the document inserts.
- Remove the `501 NOT_IMPLEMENTED_UNTIL_PHASE_2` stub from Phase 1.

### Chunk 2.7 — `bundleUtilizationJob` registration

- Create `server/jobs/bundleUtilizationJob.ts` per §6.7. Header comment documenting the §8.6 carve-out.
- Register in `server/jobs/index.ts` but DO NOT enable the schedule — cron slot stays disabled until Phase 6. Rationale: no snapshots until Phase 4, so running early writes empty metrics.
- Add `server/jobs/bundleUtilizationJob.ts` to `scripts/gates/rls-bypass-allowlist.txt` with inline justification matching existing allow-listed entries.

### Chunk 2.8 — Pure tests

- Append to `documentBundleServicePure.test.ts` (new): `computeDocSetHash` is stable under input re-ordering; produces SHA-256 over the sorted sequence; matches a golden fixture.
- TODO comment: cross-check against `contextAssemblyEnginePure.computePrefixHash` lands in Phase 3 Chunk 3.3.

## Acceptance (Phase 2 complete)

- [ ] Migration 0212 applies cleanly.
- [ ] `verify-rls-coverage.sh` and `verify-rls-contract-compliance.sh` green.
- [ ] `documentBundleServicePure.test.ts` passes.
- [ ] Manual smoke: attach a doc set to a task via `POST /attach-documents`; attach the same doc set to an agent; `GET /suggest-bundle` returns `{ suggest: true, alsoUsedOn: 1 }`; promote to named bundle; `GET /:id/attached-bundles` returns the bundle; dismiss a suggestion; second dismissal is a no-op.
- [ ] Bulk-upload with `attachTo` + `bundleName` produces a named bundle with attachments in one transaction.
- [ ] `npm run typecheck` + `npm run lint` green.
- [ ] `spec-conformance` + `pr-reviewer` clean.

## Out of scope for Phase 2

- Bundle resolution (Phase 4).
- Budget resolver / assembly engine (Phase 3).
- `bundleUtilizationJob` actually running on schedule (Phase 6).
- Cache attribution on `llm_requests` (Phase 5).
